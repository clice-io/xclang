#!/usr/bin/env python3
"""Check the packages of versions.json: each downloads, has its size and
sha256, and holds what vendor-sdk.py takes from it where it expects it.

  check-versions.py [--shard I --shards N] [--table sdk/versions.json]

Packages are spread over N shards by URL; this checks shard I. Prints a
line per package and exits 1 if one failed.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("vendor_sdk", os.path.join(HERE, "vendor-sdk.py"))
vendor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vendor)
MS = {"x86_64": "x64", "aarch64": "arm64", "x86": "x86"}


def packages(table):
    """(what, package, check) for every package of the table."""
    w = table["windows"]
    for name, m in w["manifests"].items():
        yield f"VS manifest {name}", m, None
        yield f"VS manifest {name} vsman", m["vsman"], None
    for v, e in w["sdk"].items():
        yield f"Windows SDK {v} headers", e["headers"], ("sdk", None)
        for arch in MS:
            if arch in e:
                yield f"Windows SDK {v} {arch}", e[arch], ("sdk", arch)
    for v, e in w["msvc"].items():
        yield f"MSVC {v} headers", e["headers"], ("crt", None)
        for arch in MS:
            for part, p in e.get(arch, {}).items():
                yield f"MSVC {v} {arch} {part}", p, ("crt", (arch, part))
    for p in table["macos"]["packages"]:
        yield f"macOS SDK {p['sdk']} ({p['product']}, {p['url'].rsplit('/', 1)[1]})", p, ("macos", p["sdk"])


def expected(check, names):
    """What is missing from a package's member names, case aside."""
    kind, what = check
    lower = {n.lower() for n in names}

    def has(pattern):
        r = re.compile(pattern, re.I)
        return any(r.fullmatch(n) for n in lower)

    want = []
    if kind == "sdk" and what is None:
        want = [r"c/include/[^/]+/um/windows\.h", r"c/include/[^/]+/ucrt/stdio\.h", r"c/include/[^/]+/shared/basetsd\.h"]
    elif kind == "sdk":
        want = [rf"c/um/{MS[what]}/kernel32\.lib", rf"c/ucrt/{MS[what]}/ucrt\.lib"]
    elif kind == "crt" and what is None:
        want = [r"contents/vc/tools/msvc/[^/]+/include/vcruntime\.h", r"contents/vc/tools/msvc/[^/]+/include/vector"]
    else:
        arch, part = what
        lib = {"desktop": "libcmt.lib", "desktop-debug": "libcmtd.lib", "store": "msvcrt.lib"}[part]
        want = [rf"contents/vc/tools/msvc/[^/]+/lib/{MS[arch]}/{re.escape(lib)}"]
    return [p for p in want if not has(p)]


def download(url, path):
    h, size = hashlib.sha256(), 0
    with urllib.request.urlopen(url, timeout=120) as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def check_one(what, p, check, tmp):
    path = os.path.join(tmp, "package")
    # A download now and then comes short: three tries.
    for attempt in range(3):
        size, sha256 = download(p["url"], path)
        if size == p["size"] and sha256 == p["sha256"]:
            break
        print(f"  {what}: {size} bytes, sha256 {sha256}", flush=True)
    else:
        return f"{size} bytes, sha256 {sha256}; the table has {p['size']}, {p['sha256']}"
    if check is None:
        return None
    if check[0] == "macos":
        out = os.path.join(tmp, "sdk")
        vendor.extract(path, out, "symlink")
        with open(os.path.join(out, "SDKSettings.json")) as f:
            version = json.load(f)["Version"]
        missing = [x for x in ("usr/include/stdio.h", "usr/lib/libSystem.tbd", "System/Library/Frameworks/CoreFoundation.framework") if not os.path.exists(os.path.join(out, x))]
        if version != check[1] or missing:
            return f"SDK {version}, missing {missing}"
        return None
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            return f"{bad} is damaged"
        missing = expected(check, z.namelist())
    return f"missing {missing}" if missing else None


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--table", default=os.path.join(HERE, "versions.json"))
    a.add_argument("--shard", type=int, default=0)
    a.add_argument("--shards", type=int, default=1)
    a = a.parse_args()
    with open(a.table) as f:
        table = json.load(f)
    todo = sorted(packages(table), key=lambda x: x[1]["url"])[a.shard :: a.shards]
    failed = 0
    for what, p, check in todo:
        start = time.monotonic()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                problem = check_one(what, p, check, tmp)
            except Exception as e:  # a package that does not unpack
                problem = f"{type(e).__name__}: {e}"
        failed += problem is not None
        print(f"{'FAIL' if problem else 'PASS'} {what}: {p['size'] / 1e6:.1f} MB, {time.monotonic() - start:.1f} s{', ' + problem if problem else ''}", flush=True)
    print(f"{len(todo) - failed} of {len(todo)} packages good")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
