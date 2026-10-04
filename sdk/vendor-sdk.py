#!/usr/bin/env python3
"""Fetch the vendor SDKs xclang cross-compiles against, from the vendors.

xclang never redistributes them: this downloads them from Apple's and
Microsoft's own servers, checks each download against a pinned sha256, and
unpacks them on any host, with Python's standard library only.

  vendor-sdk.py macos catalog
      list the SDK packages in Apple's software update catalog
  vendor-sdk.py macos fetch --accept-license [--version 26.5] --out DIR
      Apple's macOS SDK, from the Command Line Tools package
      (xar -> pbzx -> cpio):  clang --target=arm64-apple-macos -isysroot DIR

  vendor-sdk.py windows list
      the MSVC and Windows SDK versions Microsoft offers now
  vendor-sdk.py windows fetch --accept-license [--arch x86_64,aarch64] --out DIR
      the MSVC C/C++ runtime and standard library (Visual Studio's .vsix
      packages) and the Windows SDK (its NuGet packages), as a /winsysroot:
      clang-cl --target=x86_64-pc-windows-msvc /winsysroot DIR
      clang --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root DIR
"""

import argparse
import bisect
import concurrent.futures
import gzip
import hashlib
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

CDN = "https://swcdn.apple.com/content/downloads"

# version -> (package URL, sha256 of the package, size in bytes). The same
# URLs Nixpkgs pins (pkgs/by-name/ap/apple-sdk/metadata/versions.json).
SDKS = {
    "26.5": (
        f"{CDN}/09/08/047-91568-A_Y1CFZWQCD4/4xekpyz43i26dbp4enxfro8eb1q7wiujh5/CLTools_macOSNMOS_SDK.pkg",
        "5f044578cd78a3a9b9c965a42d56bad609ee5d252e1d4e6aa7c42fc3f35fee7b",
        61622368,
    ),
    "27.0": (
        f"{CDN}/58/48/082-83364-A_KCEBOO2NJS/0d2rj4y5ucjlkgcvqt6f6a4pergug5tu2b/CLTools_macOSNMOS_SDK.pkg",
        "d55351824fd17742fd6e1e7a252fa1028698f32147ee48be9a6b75442bf30575",
        70553676,
    ),
}
DEFAULT = "26.5"

# What compiling and linking never read, as Nixpkgs leaves out too: man pages
# (some named like APR::Base64.3pm, which Windows refuses), tools, Perl.
SKIP = ("usr/bin/", "usr/share/", "System/Library/Perl/")

CATALOG = (
    "https://swscan.apple.com/content/catalogs/others/index-27-26-15-14-13-12-10.16-10.15-10.14-10.13-"
    "10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz"
)

MS_LICENSE = """\
The MSVC C/C++ runtime and standard library are Microsoft's, under the
Visual Studio Build Tools license
(https://go.microsoft.com/fwlink/?LinkId=2179911), and the Windows SDK under
its own (https://aka.ms/WinSDKLicenseURL). xclang does not distribute them:
this downloads them from Microsoft's servers for you. Pass --accept-license
to confirm that you have read and accept both."""

VS_CHANNEL = "https://aka.ms/vs/17/release/channel"
VS = "https://download.visualstudio.microsoft.com/download/pr"
NUGET = "https://api.nuget.org/v3-flatcontainer"
MSVC = "14.44.17.14"
WINSDK = "10.0.26100.9169"

# name -> (URL, sha256, size). MSVC's from Visual Studio 17.14.41's
# VisualStudio.vsman (`windows list`): its headers, and per architecture the
# Desktop package (static runtime) and the Store one, which has the import
# libraries of the DLL runtime too (msvcrt, msvcprt, vcruntime, oldnames).
# The Windows SDK's from nuget.org: headers, and libraries per architecture.
WINDOWS = {
    "crt": (
        f"{VS}/c610cd8c-801b-44b8-a80a-82cc382aeb43/852382a9aa73502b7849c1bcadfb603ba7175c4e8b60e6aba03c7de711d4ece5/Microsoft.VC.{MSVC}.CRT.Headers.base.vsix",
        "852382a9aa73502b7849c1bcadfb603ba7175c4e8b60e6aba03c7de711d4ece5",
        2128977,
    ),
    "crt-x86_64-desktop": (
        f"{VS}/67cf767c-5e71-47c2-a54a-cd5631e28942/f01f701a7bcd9587a340898c851424f6a52bb913a70c185ff0d5bf0288c5831a/Microsoft.VC.{MSVC}.CRT.x64.Desktop.base.vsix",
        "f01f701a7bcd9587a340898c851424f6a52bb913a70c185ff0d5bf0288c5831a",
        51521199,
    ),
    "crt-x86_64-store": (
        f"{VS}/67cf767c-5e71-47c2-a54a-cd5631e28942/9135b03c0df53c7a0aa9bef7230a1c2ff4263a0ee7baa7e419d034f484f6bb56/Microsoft.VC.{MSVC}.CRT.x64.Store.base.vsix",
        "9135b03c0df53c7a0aa9bef7230a1c2ff4263a0ee7baa7e419d034f484f6bb56",
        28032384,
    ),
    "crt-aarch64-desktop": (
        f"{VS}/67cf767c-5e71-47c2-a54a-cd5631e28942/ba1aeca6d6470d2b3b318ec7bffb3e61f9a736cfb76d8a7d18e004a8e7c26651/Microsoft.VC.{MSVC}.CRT.ARM64.Desktop.base.vsix",
        "ba1aeca6d6470d2b3b318ec7bffb3e61f9a736cfb76d8a7d18e004a8e7c26651",
        49166761,
    ),
    "crt-aarch64-store": (
        f"{VS}/67cf767c-5e71-47c2-a54a-cd5631e28942/57ece91747be72fdd9ed0c39b83225011c8afba6b6f616a23ace54d0522f79e9/Microsoft.VC.{MSVC}.CRT.ARM64.Store.base.vsix",
        "57ece91747be72fdd9ed0c39b83225011c8afba6b6f616a23ace54d0522f79e9",
        61763419,
    ),
    "sdk": (
        f"{NUGET}/microsoft.windows.sdk.cpp/{WINSDK}/microsoft.windows.sdk.cpp.{WINSDK}.nupkg",
        "475269434dcd808a67853773272f972c3229c0e10c3ddc821290e70cc0f6904d",
        160512239,
    ),
    "sdk-x86_64": (
        f"{NUGET}/microsoft.windows.sdk.cpp.x64/{WINSDK}/microsoft.windows.sdk.cpp.x64.{WINSDK}.nupkg",
        "df6226a051e320942abfbd57848b43d18772996ecd66beadad240f2a56ed2f7b",
        53001499,
    ),
    "sdk-aarch64": (
        f"{NUGET}/microsoft.windows.sdk.cpp.arm64/{WINSDK}/microsoft.windows.sdk.cpp.arm64.{WINSDK}.nupkg",
        "b5eb594aaf0e98c381d5852e45b42f375920ca6268870c151ec3405b63676542",
        105809054,
    ),
}


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
    sdks = re.compile(r"^(?:\./)?Library/Developer/CommandLineTools/SDKs/([^/]+\.sdk)/(.+)$")
    with open(pkg, "rb") as f:
        entries = cpio(pbzx(Xar(f).read("Payload")))
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
    url, sha256, size = SDKS[a.version]
    pkg = a.pkg or os.path.join(a.cache, f"CLTools_macOSNMOS_SDK-{a.version}.pkg")
    if os.path.exists(pkg):
        got = sha256_file(pkg)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(pkg)), exist_ok=True)
        log(f"downloading {url}")
        got = download(url, pkg, size)
    log(f"sha256 {got}")
    if sha256 and got != sha256 and not a.unpinned:
        raise SystemExit(f"sha256 mismatch: expected {sha256}")
    if not sha256 and not a.unpinned:
        raise SystemExit("no sha256 pinned for this version (--unpinned: unpack without checking)")
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(a.out)
    start = time.monotonic()
    links = a.links or ("junction" if os.name == "nt" else "symlink")
    sdk = extract(pkg, a.out, links)
    log(f"unpacked {sdk} into {a.out} in {time.monotonic() - start:.1f} s")
    return 0


def macos_catalog(a):
    with urllib.request.urlopen(a.catalog, timeout=60) as r:
        data = r.read()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    rows = []
    for pid, product in plistlib.loads(data)["Products"].items():
        for p in product.get("Packages", []):
            if re.search(r"/CLTools_macOS[NL]MOS_SDK\.pkg$", p["URL"]):
                rows.append((product["PostDate"], pid, p))
    rows.sort(key=lambda r: r[0])
    for date, pid, p in rows[-a.last :]:
        with urllib.request.urlopen(p["MetadataURL"], timeout=60) as r:
            info = ET.fromstring(r.read())
        if info.tag != "pkg-info":
            info = info.find(".//pkg-info")
        version = info.get("version") if info is not None else "?"
        print(f"{date:%Y-%m-%d} {pid} {version:28} {p['Size']:>9} {p['URL']}")
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
        m = re.match(r"Contents/(VC/Tools/MSVC/[^/]+/(?:include/.+|lib/(?:x64|arm64)/[^/]+\.(?:lib|obj)))$", member)
        return m and m.group(1)
    m = re.match(r"c/Include/[^/]+/((?:um|shared|ucrt|winrt|cppwinrt)/.+)$", member)
    if m:
        return f"Windows Kits/10/Include/{version}/{m.group(1)}"
    m = re.match(r"c/(um|ucrt)/(x64|arm64)/([^/]+)$", member)
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


def windows_fetch(a):
    if not a.accept_license:
        log(MS_LICENSE)
        return 1
    archs = a.arch.split(",")
    names = ["crt", "sdk"] + [f"{k}-{x}{s}" for x in archs for k, s in (("crt", "-desktop"), ("crt", "-store"), ("sdk", ""))]
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        jobs = {n: pool.submit(fetch_pinned, *WINDOWS[n], os.path.join(a.cache, WINDOWS[n][0].rsplit("/", 1)[1])) for n in names}
        paths = {n: j.result() for n, j in jobs.items()}
    total = sum(WINDOWS[n][2] for n in names)
    log(f"{len(names)} packages, {total / 1e6:.1f} MB, in {time.monotonic() - start:.1f} s")

    start = time.monotonic()
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(a.out)
    version = ".".join(WINSDK.split(".")[:3]) + ".0"
    files, size, seen = 0, 0, {}
    for n in names:
        with zipfile.ZipFile(paths[n]) as z:
            for info in z.infolist():
                rel = windows_member(n, info.filename, version)
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
        msvc = os.path.join(a.out, "VC", "Tools", "MSVC")
        msvc = os.path.join(msvc, os.listdir(msvc)[0])
        kits = os.path.join(a.out, "Windows Kits", "10")
        includes = [os.path.join(msvc, "include")] + [
            os.path.join(kits, "Include", version, d) for d in ("ucrt", "um", "shared", "winrt", "cppwinrt")
        ]
        ms = {"x86_64": "x64", "aarch64": "arm64"}
        libs = [os.path.join(msvc, "lib", ms[x]) for x in archs] + [
            os.path.join(kits, "Lib", version, d, ms[x]) for x in archs for d in ("um", "ucrt")
        ]
        made = fix_case(includes, libs)
        log(f"case-sensitive file system: {made} links in {time.monotonic() - start:.1f} s")
    return 0


def windows_list(a):
    with urllib.request.urlopen(VS_CHANNEL, timeout=60) as r:
        channel = json.load(r)
    print(f"Visual Studio {channel['info']['productDisplayVersion']} ({r.url})")
    item = next(i for i in channel["channelItems"] if i["id"] == "Microsoft.VisualStudio.Manifests.VisualStudio")
    payload = item["payloads"][0]
    with urllib.request.urlopen(payload["url"], timeout=120) as r:
        vsman = json.load(r)
    print(f"  {payload['url']}  sha256 {payload['sha256']}")
    wanted = re.compile(r"Microsoft\.VC\.([\d.]+)\.CRT\.(Headers|x64\.Desktop|x64\.Store|ARM64\.Desktop|ARM64\.Store)\.base$")
    for p in vsman["packages"]:
        if wanted.match(p["id"]):
            pl = p["payloads"][0]
            print(f"  {p['id']}  {pl['size']}  {pl['url']}  sha256 {pl['sha256']}")
    for pkg in ("microsoft.windows.sdk.cpp", "microsoft.windows.sdk.cpp.x64", "microsoft.windows.sdk.cpp.arm64"):
        with urllib.request.urlopen(f"{NUGET}/{pkg}/index.json", timeout=60) as r:
            versions = [v for v in json.load(r)["versions"] if "-" not in v]
        print(f"{pkg}: {' '.join(versions[-6:])}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    vendors = p.add_subparsers(dest="vendor", required=True)
    mac = vendors.add_parser("macos", help="Apple's macOS SDK").add_subparsers(dest="cmd", required=True)
    f = mac.add_parser("fetch", help="download and unpack a pinned SDK")
    f.add_argument("--accept-license", action="store_true")
    f.add_argument("--version", default=DEFAULT, choices=sorted(SDKS))
    f.add_argument("--out", required=True, help="the SDK directory to create")
    f.add_argument("--pkg", help="a package already downloaded")
    f.add_argument("--cache", default=".", help="where the package is downloaded to")
    f.add_argument("--links", choices=["symlink", "junction", "copy"], help="default: junction on Windows")
    f.add_argument("--unpinned", action="store_true", help=argparse.SUPPRESS)
    f.set_defaults(run=macos_fetch)
    c = mac.add_parser("catalog", help="list SDK packages in Apple's catalog")
    c.add_argument("--catalog", default=CATALOG)
    c.add_argument("--last", type=int, default=8)
    c.set_defaults(run=macos_catalog)
    win = vendors.add_parser("windows", help="the MSVC runtime and the Windows SDK").add_subparsers(dest="cmd", required=True)
    f = win.add_parser("fetch", help="download the pinned packages and unpack them as a /winsysroot")
    f.add_argument("--accept-license", action="store_true")
    f.add_argument("--arch", default="x86_64,aarch64", help="x86_64, aarch64 or both, comma-separated")
    f.add_argument("--out", required=True, help="the /winsysroot directory to create")
    f.add_argument("--cache", default=".", help="where the packages are downloaded to")
    f.set_defaults(run=windows_fetch)
    win.add_parser("list", help="what Microsoft offers now").set_defaults(run=windows_list)
    a = p.parse_args()
    return a.run(a)


if __name__ == "__main__":
    sys.exit(main())
