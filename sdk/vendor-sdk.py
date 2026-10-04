#!/usr/bin/env python3
"""Fetch the vendor SDKs xclang cross-compiles against, from the vendors.

xclang never redistributes them: this downloads them from Apple's and
Microsoft's own servers, checks each download against the sha256 the
version table (versions.json, made by update-versions.py) pins, and unpacks
them on any host, with Python's standard library only.

  vendor-sdk.py macos list | windows list
      the versions the table has, the default marked
  vendor-sdk.py macos fetch --accept-license [--version 26.5] --out DIR
      Apple's macOS SDK, from a Command Line Tools package
      (xar -> pbzx -> cpio):  clang --target=arm64-apple-macos -isysroot DIR
  vendor-sdk.py windows fetch --accept-license [--sdk-version 10.0.26100]
          [--msvc-version 14.44] [--arch x86_64,aarch64,x86] --out DIR
      the MSVC C/C++ runtime and standard library (Visual Studio's .vsix
      packages) and the Windows SDK (its NuGet packages), as a /winsysroot:
      clang-cl --target=x86_64-pc-windows-msvc /winsysroot DIR
      clang --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root DIR

A version may be given in part (26, 10.0.26100, 14.44): the newest that
matches is taken. The default is the newest xclang works with.
"""

import argparse
import bisect
import concurrent.futures
import hashlib
import itertools
import json
import lzma
import os
import plistlib
import re
import shutil
import stat
import struct
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib

APPLE_LICENSE = """\
The macOS SDK is Apple's, under the Xcode and Apple SDKs Agreement
(https://www.apple.com/legal/sla/docs/xcode.pdf), which among other things
allows its use only on Apple-branded computers. xclang does not distribute
it: this downloads it from Apple's servers for you. Pass --accept-license
to confirm that you have read and accept that agreement."""

TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "versions.json")


def version_key(v):
    return [int(x) for x in re.findall(r"\d+", v)]


# What xclang 23.1.2.5 cannot use, which the defaults pass over: the macOS
# 27 SDK's .tbd files list arm64e.x1, which its ld64.lld rejects
# (llvm#222721).
def macos_broken(version):
    return version_key(version) >= [27]


def windows_sdk_broken(version):
    return False


def msvc_broken(version):
    return False


def pick(versions, want, broken, what):
    """The version of versions want names (whole or in part), or the newest
    that is not broken."""
    known = sorted(versions, key=version_key)
    if want:
        matches = [v for v in known if v == want or v.startswith(want + ".")]
        if not matches:
            raise SystemExit(f"no {what} {want} in the table; it has: {' '.join(known)}")
        return matches[-1]
    return [v for v in known if not broken(v)][-1]


def load_table(path):
    with open(path) as f:
        return json.load(f)


def macos_versions(table):
    """SDK version -> its package: the first the table lists."""
    out = {}
    for p in table["macos"]["packages"]:
        out.setdefault(p["sdk"], p)
    return out


# What compiling and linking never read, as Nixpkgs leaves out too: man pages
# (some named like APR::Base64.3pm, which Windows refuses), tools, Perl.
SKIP = ("usr/bin/", "usr/share/", "System/Library/Perl/")

MS_LICENSE = """\
The MSVC C/C++ runtime and standard library are Microsoft's, under the
Visual Studio Build Tools license
(https://go.microsoft.com/fwlink/?LinkId=2179911), and the Windows SDK under
its own (https://aka.ms/WinSDKLicenseURL). xclang does not distribute them:
this downloads them from Microsoft's servers for you. Pass --accept-license
to confirm that you have read and accept both."""

def log(*args):
    print(*args, file=sys.stderr, flush=True)


def download(url, dest, size=None):
    """Stream url to dest; returns the sha256 of what was written."""
    h = hashlib.sha256()
    start, done, last = time.monotonic(), 0, 0.0
    with urllib.request.urlopen(url, timeout=60) as r, open(dest + ".part", "wb") as f:
        total = size or int(r.headers.get("Content-Length") or 0)
        while chunk := r.read(1 << 20):
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            now = time.monotonic()
            if now - last > 5:
                last = now
                log(f"  {done / 1e6:.1f} / {total / 1e6:.1f} MB")
    os.replace(dest + ".part", dest)
    log(f"downloaded {done / 1e6:.1f} MB in {time.monotonic() - start:.1f} s")
    return h.hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


class Xar:
    """A xar archive (a flat .pkg): its table of contents and file data."""

    def __init__(self, f):
        self.f = f
        magic, size, _version, toc_len, _toc_raw, _cksum = struct.unpack(">4sHHQQI", f.read(28))
        if magic != b"xar!":
            raise SystemExit("not a xar archive (.pkg)")
        f.seek(size)
        self.toc = ET.fromstring(zlib.decompress(f.read(toc_len)))
        self.heap = size + toc_len

    def member(self, name):
        for node in self.toc.iter("file"):
            if node.findtext("name") == name and node.find("data") is not None:
                data = node.find("data")
                style = data.find("encoding").get("style")
                return int(data.findtext("offset")), int(data.findtext("length")), style
        raise SystemExit(f"{name} not found in the package")

    def read(self, name):
        """The member's bytes, in pieces; encodings other than stored are decoded."""
        offset, length, style = self.member(name)
        self.f.seek(self.heap + offset)
        dec = None
        if style == "application/x-gzip":
            dec = zlib.decompressobj()
        elif style == "application/x-bzip2":
            import bz2

            dec = bz2.BZ2Decompressor()
        elif style != "application/octet-stream":
            raise SystemExit(f"unknown xar encoding {style}")
        while length:
            chunk = self.f.read(min(length, 1 << 20))
            length -= len(chunk)
            yield dec.decompress(chunk) if dec else chunk


class Stream:
    """Exact reads over an iterator of byte pieces."""

    def __init__(self, pieces):
        self.pieces = pieces
        self.buf = bytearray()
        self.pos = 0

    def read(self, n):
        while len(self.buf) - self.pos < n:
            piece = next(self.pieces, None)
            if piece is None:
                raise SystemExit("unexpected end of data")
            del self.buf[: self.pos]
            self.pos = 0
            self.buf += piece
        out = bytes(self.buf[self.pos : self.pos + n])
        self.pos += n
        return out


def pbzx(pieces):
    """Apple's pbzx stream: a header, then chunks of xz (or stored) data."""
    s = Stream(pieces)
    if s.read(4) != b"pbzx":
        raise SystemExit("Payload is not a pbzx stream")
    (flags,) = struct.unpack(">Q", s.read(8))
    while flags & 0x01000000:
        flags, size = struct.unpack(">QQ", s.read(16))
        chunk = s.read(size)
        yield lzma.decompress(chunk) if chunk.startswith(b"\xfd7zXZ\x00") else chunk


def payload(pieces):
    """A package's Payload as a cpio stream: pbzx (since macOS 10.10's
    packages), gzip (older ones) or stored."""
    first = next(pieces, b"")
    pieces = itertools.chain([first], pieces)
    if first.startswith(b"pbzx"):
        return pbzx(pieces)
    if first.startswith(b"\x1f\x8b"):
        gz = zlib.decompressobj(31)
        return (gz.decompress(piece) for piece in pieces)
    return pieces


SDK_PATH = re.compile(r"^(?:\./)?Library/Developer/CommandLineTools/SDKs/([^/]+\.sdk)/(.+)$")


def sdk_version(pkg):
    """The version of the SDK a Command Line Tools package carries (26.5),
    from the SDKSettings near the start of its payload: older packages name
    the SDK's directory MacOSX.sdk."""
    with open(pkg, "rb") as f:
        for name, mode, _, _, data in cpio(payload(Xar(f).read("Payload"))):
            m = SDK_PATH.match(name)
            if m and stat.S_ISREG(mode) and m.group(2) == "SDKSettings.json":
                return json.loads(data)["Version"]
            if m and stat.S_ISREG(mode) and m.group(2) == "SDKSettings.plist":
                return plistlib.loads(data)["Version"]
    raise SystemExit(f"{pkg}: no SDK in the package")


def cpio(pieces):
    """Entries of an odc ("070707") cpio stream: (name, mode, nlink, inode, data)."""
    s = Stream(pieces)
    while True:
        h = s.read(76)
        if h[:6] != b"070707":
            raise SystemExit(f"bad cpio header {h[:6]!r}")
        dev, ino, mode, _uid, _gid, nlink = (int(h[6 + 6 * i : 12 + 6 * i], 8) for i in range(6))
        namesize, filesize = int(h[59:65], 8), int(h[65:76], 8)
        name = s.read(namesize)[:-1].decode()
        if name == "TRAILER!!!":
            return
        yield name, mode, nlink, (dev, ino), s.read(filesize)


def extract(pkg, out, links):
    """Unpack the SDK directory of the package into out."""
    sdks = SDK_PATH
    with open(pkg, "rb") as f:
        entries = cpio(payload(Xar(f).read("Payload")))
        sdk, files, size, pending, inodes, empties, others = None, 0, 0, [], {}, {}, set()
        for name, mode, nlink, inode, data in entries:
            m = sdks.match(name)
            if not m:
                continue
            if sdk is None:
                sdk = m.group(1)
                log(f"unpacking {sdk}")
            elif m.group(1) != sdk:
                if m.group(1) not in others:
                    others.add(m.group(1))
                    log(f"skipping {m.group(1)}")
                continue
            if m.group(2).startswith(SKIP):
                continue
            path = os.path.join(out, *m.group(2).split("/"))
            kind = stat.S_IFMT(mode)
            if kind == stat.S_IFDIR:
                os.makedirs(path, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            if kind == stat.S_IFLNK:
                target = data.decode()
                if links == "symlink":
                    os.symlink(target, path)
                else:
                    pending.append((path, target))
            elif kind == stat.S_IFREG:
                # A hard link's data may come with one of its names only.
                if nlink > 1 and not data and inode in inodes:
                    shutil.copyfile(inodes[inode], path)
                else:
                    for p in [path] + (empties.pop(inode, []) if data else []):
                        with open(p, "wb") as g:
                            g.write(data)
                    if nlink > 1:
                        if data:
                            inodes[inode] = path
                        else:
                            empties.setdefault(inode, []).append(path)
                os.chmod(path, mode & 0o755 | 0o644)
                files += 1
                size += len(data)
    if sdk is None:
        raise SystemExit("no SDK in the package")
    # Without symlinks (Windows, where they need a privilege), a link to a
    # directory becomes a junction and a link to a file a hard link; with
    # --links copy, a copy, made once no link under its target is still to be
    # made, so that it is whole. Links to links resolve over several rounds.
    pending = [(os.path.normpath(p), t) for p, t in pending]
    while pending:
        paths = sorted(p for p, _ in pending)
        left = []
        for path, target in pending:
            src = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if links == "copy":
                if (path + os.sep).startswith(src + os.sep):
                    continue  # a link to a directory above it (ruby/ruby -> .)
                i = bisect.bisect_left(paths, src + os.sep)
                if i < len(paths) and paths[i].startswith(src + os.sep):
                    left.append((path, target))
                elif os.path.isdir(src):
                    shutil.copytree(src, path)
                elif os.path.isfile(src):
                    shutil.copyfile(src, path)
                else:
                    left.append((path, target))
            elif os.path.isdir(src):
                import _winapi

                _winapi.CreateJunction(os.path.abspath(src), path)
            elif os.path.isfile(src):
                os.link(src, path)
            else:
                left.append((path, target))
        if len(left) == len(pending):
            log(f"{len(left)} links point nowhere, left out: {left[:3]}")
            break
        pending = left
    log(f"{files} files, {size / 1e6:.1f} MB")
    return sdk


def macos_fetch(a):
    if not a.accept_license:
        log(APPLE_LICENSE)
        return 1
    versions = macos_versions(load_table(a.table))
    version = pick(versions, a.version, macos_broken, "macOS SDK")
    entry = versions[version]
    url, sha256, size = entry["url"], entry["sha256"], entry["size"]
    log(f"macOS SDK {version}: {url}")
    pkg = a.pkg or os.path.join(a.cache, f"{entry['product']}-{url.rsplit('/', 1)[1]}")
    start = time.monotonic()
    if a.unpinned:
        got = sha256_file(pkg)
    else:
        fetch_pinned(url, sha256, size, pkg)
        got = sha256
    log(f"sha256 {got}, {size / 1e6:.1f} MB in {time.monotonic() - start:.1f} s")
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(a.out)
    start = time.monotonic()
    links = a.links or ("junction" if os.name == "nt" else "symlink")
    sdk = extract(pkg, a.out, links)
    log(f"unpacked {sdk} into {a.out} in {time.monotonic() - start:.1f} s")
    return 0


def macos_list(a):
    versions = macos_versions(load_table(a.table))
    default = pick(versions, None, macos_broken, "macOS SDK")
    for v in sorted(versions, key=version_key):
        p = versions[v]
        mark = " (default)" if v == default else " (xclang cannot use it)" if macos_broken(v) else ""
        print(f"{v:8} {p['posted']} {p['size'] / 1e6:6.1f} MB  {p['url']}{mark}")
    return 0


def fetch_pinned(url, sha256, size, path):
    """The file at path if it has the pinned sha256, else downloaded anew."""
    if os.path.exists(path) and sha256_file(path) == sha256:
        return path
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    got = download(url, path, size)
    if got != sha256:
        raise SystemExit(f"{url}: sha256 {got}, expected {sha256}")
    return path


def windows_member(name, member, version):
    """Where a member of a package goes in the /winsysroot tree, or None."""
    if name.startswith("crt"):
        # Headers, and an architecture's own libraries and link-option objects
        # (setargv.obj, ...), not those for Store apps, UWP or enclaves; no
        # debug symbols.
        m = re.match(r"Contents/(VC/Tools/MSVC/[^/]+/(?:include/.+|lib/(?:x64|arm64|x86)/[^/]+\.(?:lib|obj)))$", member)
        return m and m.group(1)
    m = re.match(r"c/Include/[^/]+/((?:um|shared|ucrt|winrt|cppwinrt)/.+)$", member)
    if m:
        return f"Windows Kits/10/Include/{version}/{m.group(1)}"
    m = re.match(r"c/(um|ucrt)/(x64|arm64|x86)/([^/]+)$", member)
    if m:
        return f"Windows Kits/10/Lib/{version}/{m.group(1)}/{m.group(2)}/{m.group(3)}"
    return None


# Spellings in use that no header writes, Microsoft's documentation's (xwin
# links them too).
KNOWN_HEADERS = ["BaseTsd.h", "Mstcpip.h"]
KNOWN_LIBS = ["Kernel32.lib", "Iphlpapi.lib"]

INCLUDE = re.compile(rb'^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\r\n]+)[>"]', re.M)
PRAGMA_LIB = re.compile(rb'#[ \t]*pragma[ \t]+comment[ \t]*\([ \t]*lib[ \t]*,[ \t]*"([^"]+)"', re.I)


def fix_case(includes, libs):
    """Links for the names Windows finds whatever their case: every file's
    in lower case, every library's in upper case too (LIBCMT.lib, as objects
    MSVC built ask for), the paths of each #include and #pragma comment(lib)
    of the headers as they are written (<Windows.h> includes <winbase.h>,
    which is WinBase.h), and a few known spellings. Returns how many links
    were made."""
    dirs = {}

    def entries(d):
        if d not in dirs:
            names = sorted(os.listdir(d)) if os.path.isdir(d) else []
            dirs[d] = (set(names), {n.lower(): n for n in reversed(names)})
        return dirs[d]

    made = 0

    def link(d, want, have):
        nonlocal made
        if want not in entries(d)[0]:
            os.symlink(have, os.path.join(d, want))
            entries(d)[0].add(want)
            made += 1

    def resolve(base, parts):
        d, plan = base, []
        for part in parts:
            if part in ("", "."):
                continue
            if part == "..":
                d = os.path.dirname(d)
                continue
            exact, lower = entries(d)
            if part not in exact:
                have = lower.get(part.lower())
                if have is None:
                    return False
                plan.append((d, part, have))
                part = have
            d = os.path.join(d, part)
        for step in plan:
            link(*step)
        return True

    headers = [os.path.join(d, f) for root in includes for d, _, fs in os.walk(root) for f in fs]
    files = headers + [os.path.join(d, f) for d in libs for f in os.listdir(d)]
    for path in files:
        d, n = os.path.split(path)
        link(d, n.lower(), n)
        stem, ext = os.path.splitext(n)
        if ext.lower() == ".lib":
            link(d, stem.upper() + ".lib", n)
    for name in KNOWN_HEADERS:
        any(resolve(d, [name]) for d in includes)
    for name in KNOWN_LIBS:
        any(resolve(d, [name]) for d in libs)
    for h in headers:
        with open(h, "rb") as f:
            text = f.read()
        for m in INCLUDE.finditer(text):
            parts = m.group(1).decode("latin-1").strip().replace("\\", "/").split("/")
            for base in [os.path.dirname(h)] + includes:
                if resolve(base, parts):
                    break
        for m in PRAGMA_LIB.finditer(text):
            lib = m.group(1).decode("latin-1")
            if not lib.lower().endswith(".lib"):
                lib += ".lib"
            for d in libs:
                if resolve(d, [lib]):
                    break
    return made


MS_ARCH = {"x86_64": "x64", "aarch64": "arm64", "x86": "x86"}


def windows_fetch(a):
    if not a.accept_license:
        log(MS_LICENSE)
        return 1
    table = load_table(a.table)["windows"]
    sdk_version = pick(table["sdk"], a.sdk_version, windows_sdk_broken, "Windows SDK")
    msvc_version = pick(table["msvc"], a.msvc_version, msvc_broken, "MSVC")
    sdk, msvc = table["sdk"][sdk_version], table["msvc"][msvc_version]
    log(f"MSVC {msvc_version} ({msvc['manifest']}), Windows SDK {sdk_version}")
    archs = a.arch.split(",")
    for arch in archs:
        if arch not in MS_ARCH:
            raise SystemExit(f"unknown architecture {arch}: x86_64, aarch64 or x86")
        for what, entry in ((f"MSVC {msvc_version}", msvc), (f"Windows SDK {sdk_version}", sdk)):
            if arch not in entry:
                raise SystemExit(f"{what} has no {arch} packages")
    packages = [("crt", msvc["headers"]), ("sdk", sdk["headers"])]
    packages += [("crt", part) for x in archs for part in msvc[x].values()]
    packages += [("sdk", sdk[x]) for x in archs]
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        jobs = [
            (kind, pool.submit(fetch_pinned, p["url"], p["sha256"], p["size"], os.path.join(a.cache, p["url"].rsplit("/", 1)[1])))
            for kind, p in packages
        ]
        paths = [(kind, j.result()) for kind, j in jobs]
    total = sum(p["size"] for _, p in packages)
    log(f"{len(packages)} packages, {total / 1e6:.1f} MB, in {time.monotonic() - start:.1f} s")

    start = time.monotonic()
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(a.out)
    # The SDK's own version, which names its directories (10.0.26100.0).
    with zipfile.ZipFile(paths[1][1]) as z:
        version = next(m.group(1) for n in z.namelist() if (m := re.match(r"c/Include/([^/]+)/um/", n)))
    files, size, seen = 0, 0, {}
    for kind, path in paths:
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                rel = windows_member(kind, info.filename, version)
                if not rel or info.is_dir():
                    continue
                if seen.setdefault(rel.lower(), rel) != rel:
                    log(f"{rel} and {seen[rel.lower()]} differ only in case")
                dest = os.path.join(a.out, *rel.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(info) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
                files += 1
                size += info.file_size
    log(f"{files} files, {size / 1e6:.1f} MB, unpacked in {time.monotonic() - start:.1f} s")

    probe = os.path.join(a.out, "CaseProbe")
    open(probe, "w").close()
    insensitive = os.path.exists(os.path.join(a.out, "caseprobe"))
    os.remove(probe)
    if insensitive:
        log("case-insensitive file system: no links needed")
    else:
        start = time.monotonic()
        tools = os.path.join(a.out, "VC", "Tools", "MSVC")
        tools = os.path.join(tools, os.listdir(tools)[0])
        kits = os.path.join(a.out, "Windows Kits", "10")
        includes = [os.path.join(tools, "include")] + [
            os.path.join(kits, "Include", version, d) for d in ("ucrt", "um", "shared", "winrt", "cppwinrt")
        ]
        libs = [os.path.join(tools, "lib", MS_ARCH[x]) for x in archs] + [
            os.path.join(kits, "Lib", version, d, MS_ARCH[x]) for x in archs for d in ("um", "ucrt")
        ]
        made = fix_case([d for d in includes if os.path.isdir(d)], [d for d in libs if os.path.isdir(d)])
        log(f"case-sensitive file system: {made} links in {time.monotonic() - start:.1f} s")
    return 0


def windows_list(a):
    table = load_table(a.table)["windows"]
    for what, versions, broken in (("Windows SDK", table["sdk"], windows_sdk_broken), ("MSVC", table["msvc"], msvc_broken)):
        default = pick(versions, None, broken, what)
        print(f"{what}:")
        for v in sorted(versions, key=version_key):
            e = versions[v]
            archs = [x for x in MS_ARCH if x in e]
            mark = " (default)" if v == default else " (xclang cannot use it)" if broken(v) else ""
            source = e.get("manifest", "nuget.org")
            print(f"  {v:18} {' '.join(archs):22} {source}{mark}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--table", default=TABLE, help=argparse.SUPPRESS)
    vendors = p.add_subparsers(dest="vendor", required=True)
    mac = vendors.add_parser("macos", help="Apple's macOS SDK").add_subparsers(dest="cmd", required=True)
    f = mac.add_parser("fetch", help="download and unpack an SDK")
    f.add_argument("--accept-license", action="store_true")
    f.add_argument("--version", help="the SDK's version, whole or in part (default: the newest xclang works with)")
    f.add_argument("--out", required=True, help="the SDK directory to create")
    f.add_argument("--pkg", help="a package already downloaded")
    f.add_argument("--cache", default=".", help="where the package is downloaded to")
    f.add_argument("--links", choices=["symlink", "junction", "copy"], help="default: junction on Windows")
    f.add_argument("--unpinned", action="store_true", help=argparse.SUPPRESS)
    f.set_defaults(run=macos_fetch)
    mac.add_parser("list", help="the SDK versions the table has").set_defaults(run=macos_list)
    win = vendors.add_parser("windows", help="the MSVC runtime and the Windows SDK").add_subparsers(dest="cmd", required=True)
    f = win.add_parser("fetch", help="download and unpack them as a /winsysroot")
    f.add_argument("--accept-license", action="store_true")
    f.add_argument("--sdk-version", help="the Windows SDK's version, whole or in part (10.0.26100)")
    f.add_argument("--msvc-version", help="MSVC's version, whole or in part (14.44)")
    f.add_argument("--arch", default="x86_64,aarch64", help="x86_64, aarch64, x86, comma-separated")
    f.add_argument("--out", required=True, help="the /winsysroot directory to create")
    f.add_argument("--cache", default=".", help="where the packages are downloaded to")
    f.set_defaults(run=windows_fetch)
    win.add_parser("list", help="the versions the table has").set_defaults(run=windows_list)
    a = p.parse_args()
    return a.run(a)


if __name__ == "__main__":
    sys.exit(main())
