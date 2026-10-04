#!/usr/bin/env python3
"""Fetch Apple's macOS SDK from Apple's software update CDN and unpack it.

xclang never redistributes the SDK: this downloads the Command Line Tools
SDK package (CLTools_macOSNMOS_SDK.pkg) from swcdn.apple.com, checks it
against a pinned sha256, and unpacks the SDK directory from it on any host
(xar -> pbzx -> cpio, with the standard library only).

  macos-sdk.py catalog [--catalog URL]
      list the SDK packages in Apple's software update catalog
  macos-sdk.py fetch --accept-license [--version 26.5] --out DIR
      download (or reuse --pkg FILE) and unpack the SDK into DIR

Then: clang --target=arm64-apple-macos -isysroot DIR ...
"""

import argparse
import bisect
import gzip
import hashlib
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
import zlib

LICENSE = """\
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
    # Without symlinks (Windows), each link becomes a copy of its target, made
    # once no link under the target is still to be made, so that the copy is
    # whole; links to links resolve over several rounds.
    pending = [(os.path.normpath(p), t) for p, t in pending]
    while pending:
        paths = sorted(p for p, _ in pending)
        left = []
        for path, target in pending:
            src = os.path.normpath(os.path.join(os.path.dirname(path), target))
            i = bisect.bisect_left(paths, src + os.sep)
            if i < len(paths) and paths[i].startswith(src + os.sep):
                left.append((path, target))
            elif os.path.isdir(src):
                shutil.copytree(src, path)
            elif os.path.isfile(src):
                shutil.copyfile(src, path)
            else:
                left.append((path, target))
        if len(left) == len(pending):
            log(f"{len(left)} links point nowhere, left out: {left[:3]}")
            break
        pending = left
    log(f"{files} files, {size / 1e6:.1f} MB")
    return sdk


def cmd_fetch(a):
    if not a.accept_license:
        log(LICENSE)
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
    links = a.links or ("copy" if os.name == "nt" else "symlink")
    sdk = extract(pkg, a.out, links)
    log(f"unpacked {sdk} into {a.out} in {time.monotonic() - start:.1f} s")
    return 0


def cmd_catalog(a):
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


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download and unpack a pinned SDK")
    f.add_argument("--accept-license", action="store_true")
    f.add_argument("--version", default=DEFAULT, choices=sorted(SDKS))
    f.add_argument("--out", required=True, help="the SDK directory to create")
    f.add_argument("--pkg", help="a package already downloaded")
    f.add_argument("--cache", default=".", help="where the package is downloaded to")
    f.add_argument("--links", choices=["symlink", "copy"], help="default: copy on Windows")
    f.add_argument("--unpinned", action="store_true", help=argparse.SUPPRESS)
    c = sub.add_parser("catalog", help="list SDK packages in Apple's catalog")
    c.add_argument("--catalog", default=CATALOG)
    c.add_argument("--last", type=int, default=8)
    a = p.parse_args()
    return cmd_fetch(a) if a.cmd == "fetch" else cmd_catalog(a)


if __name__ == "__main__":
    sys.exit(main())
