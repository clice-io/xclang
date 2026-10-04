#!/usr/bin/env python3
"""Add every SDK version the vendors offer now to versions.json.

What is in the table never changes; a run only appends what is new. The
table says where each package is, its size and its sha256, and nothing from
inside the packages but the version of the macOS SDK a Command Line Tools
package carries. The sha256s Visual Studio's manifests list are taken from
them; the others are computed by downloading the packages (nuget.org gives
SHA-512 only), some 15 GB the first time.

  update-versions.py [--table sdk/versions.json] [--jobs 8]
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import importlib.util
import json
import os
import plistlib
import re
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("vendor_sdk", os.path.join(HERE, "vendor-sdk.py"))
vendor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vendor)
log = vendor.log

# Visual Studio's stable channels, newest first: a toolset several of them
# carry (each signs its own copy) comes from the newest.
CHANNELS = ["vs/18/stable", "vs/17/release", "vs/16/release"]
# Per architecture, the CRT packages xclang's /winsysroot takes.
MSVC_ARCHS = {"x86_64": "x64", "aarch64": "ARM64", "x86": "x86"}
MSVC_PARTS = {"desktop": "Desktop", "store": "Store", "desktop-debug": "Desktop.debug"}

NUGET = "https://api.nuget.org/v3-flatcontainer"
NUGET_PACKAGES = {
    "headers": "microsoft.windows.sdk.cpp",
    "x86_64": "microsoft.windows.sdk.cpp.x64",
    "aarch64": "microsoft.windows.sdk.cpp.arm64",
    "x86": "microsoft.windows.sdk.cpp.x86",
}

# Apple's software update catalogs, one per macOS release: each lists the
# Command Line Tools for that release and those before it.
CATALOG_TAIL = "10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz"
CATALOGS = [
    f"https://swscan.apple.com/content/catalogs/others/index-{head}{CATALOG_TAIL}"
    for head in ["27-26-15-14-13-12-", "26-15-14-13-12-", "15-14-13-12-", "14-13-12-", "13-12-", "12-", ""]
] + [
    "https://swscan.apple.com/content/catalogs/others/index-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
    "https://swscan.apple.com/content/catalogs/others/index-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
]
# An SDK package, not the empty ones that remove an old SDK.
MACOS_PACKAGE = re.compile(r"/CLTools_[^/]*SDK[^/]*\.pkg$")


def version_key(v):
    return [int(x) for x in re.findall(r"\d+", v)]


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read(), r.url


def hash_url(url, keep=None):
    """Size and sha256 of what url serves, streamed; written to keep too."""
    h, size = hashlib.sha256(), 0
    with urllib.request.urlopen(url, timeout=120) as r, open(keep or os.devnull, "wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def content_length(url):
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
        return int(r.headers["Content-Length"])


def package(url, size, sha256):
    return {"url": url, "size": size, "sha256": sha256}


def update_msvc(table, pool):
    windows = table.setdefault("windows", {})
    manifests = windows.setdefault("manifests", {})
    msvc = windows.setdefault("msvc", {})
    for channel in CHANNELS:
        raw, url = fetch(f"https://aka.ms/{channel}/channel")
        info = json.loads(raw)["info"]
        name = f"{info['manifestName']} {info['productDisplayVersion'].split()[0]}"
        item = next(i for i in json.loads(raw)["channelItems"] if i["id"] == "Microsoft.VisualStudio.Manifests.VisualStudio")
        vsman = item["payloads"][0]
        # The CDN serves the vsman smaller than the size and sha256 the
        # channel manifest lists for it, whatever the request: it is pinned
        # by what it serves. The packages the vsman lists match their sha256.
        data, _ = fetch(vsman["url"])
        packages = {p["id"].lower(): p for p in json.loads(data)["packages"]}
        versions = {m.group(1) for i in packages if (m := re.match(r"microsoft\.vc\.(\d+(?:\.\d+){3})\.crt\.headers\.base$", i))}
        log(f"{name}: MSVC {' '.join(sorted(versions, key=version_key))}")

        def vsix(version, part):
            p = packages.get(f"microsoft.vc.{version}.crt.{part}.base".lower())
            if not p:
                return None
            payload = next(x for x in p["payloads"] if x["fileName"].endswith(".vsix"))
            # The vsman's size is not always the download's.
            return package(payload["url"], pool.submit(content_length, payload["url"]), payload["sha256"])

        for version in sorted(versions - set(msvc), key=version_key):
            entry = {"manifest": name, "headers": vsix(version, "Headers")}
            for arch, ms in MSVC_ARCHS.items():
                parts = {k: vsix(version, f"{ms}.{v}") for k, v in MSVC_PARTS.items()}
                if parts["desktop"] and parts["store"]:
                    entry[arch] = {k: v for k, v in parts.items() if v}
            for p in [entry["headers"]] + [q for arch in MSVC_ARCHS if arch in entry for q in entry[arch].values()]:
                p["size"] = p["size"].result()
            msvc[version] = entry
            if name not in manifests:
                manifests[name] = {
                    "channel": f"https://aka.ms/{channel}/channel",
                    **package(url, len(raw), hashlib.sha256(raw).hexdigest()),
                    "vsman": {
                        **package(vsman["url"], len(data), hashlib.sha256(data).hexdigest()),
                        "listed": {"size": vsman["size"], "sha256": vsman["sha256"]},
                    },
                }
            log(f"  + MSVC {version}")
    windows["msvc"] = dict(sorted(msvc.items(), key=lambda kv: version_key(kv[0])))


def update_winsdk(table, pool):
    sdk = table.setdefault("windows", {}).setdefault("sdk", {})
    offered = {}
    for part, pkg in NUGET_PACKAGES.items():
        data, _ = fetch(f"{NUGET}/{pkg}/index.json")
        offered[part] = {v for v in json.loads(data)["versions"] if "-" not in v}
    new = sorted(offered["headers"] - set(sdk), key=version_key)
    jobs = {}
    for v in new:
        for part, pkg in NUGET_PACKAGES.items():
            if v in offered[part]:
                url = f"{NUGET}/{pkg}/{v}/{pkg}.{v}.nupkg"
                jobs[(v, part)] = (url, pool.submit(hash_url, url))
    for v in new:
        sdk[v] = {part: package(url, *job.result()) for (w, part), (url, job) in jobs.items() if w == v}
        log(f"  + Windows SDK {v}")
    table["windows"]["sdk"] = dict(sorted(sdk.items(), key=lambda kv: version_key(kv[0])))


def update_macos(table, pool):
    packages = table.setdefault("macos", {}).setdefault("packages", [])
    known = {p["url"] for p in packages}
    found = {}
    for url in CATALOGS:
        try:
            data, _ = fetch(url)
        except OSError as e:
            log(f"{url}: {e}")
            continue
        for pid, product in plistlib.loads(gzip.decompress(data))["Products"].items():
            for p in product.get("Packages", []):
                url = re.sub(r"^http:", "https:", p["URL"])
                if MACOS_PACKAGE.search(url) and p["Size"] > 1 << 20 and url not in known:
                    found.setdefault(url, (product["PostDate"], pid))

    def examine(url):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = os.path.join(tmp, "sdk.pkg")
            size, sha256 = hash_url(url, pkg)
            return size, sha256, vendor.sdk_version(pkg)

    jobs = {url: pool.submit(examine, url) for url in found}
    shas = {p["sha256"] for p in packages}
    # Newest first: the first package of a version is the one the tool takes.
    for url in sorted(found, key=lambda u: found[u], reverse=True):
        size, sha256, version = jobs[url].result()
        posted, pid = found[url]
        if sha256 in shas:
            continue
        shas.add(sha256)
        packages.append({"sdk": version, "product": pid, "posted": f"{posted:%Y-%m-%d}", **package(url, size, sha256)})
        log(f"  + macOS SDK {version} ({pid}, {url.rsplit('/', 1)[1]})")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--table", default=os.path.join(HERE, "versions.json"))
    p.add_argument("--jobs", type=int, default=8)
    a = p.parse_args()
    table = {}
    if os.path.exists(a.table):
        with open(a.table) as f:
            table = json.load(f)
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        update_msvc(table, pool)
        update_winsdk(table, pool)
        update_macos(table, pool)
    with open(a.table, "w") as f:
        json.dump(table, f, indent=1)
        f.write("\n")
    w = table["windows"]
    log(f"{len(w['sdk'])} Windows SDKs, {len(w['msvc'])} MSVC toolsets, {len(table['macos']['packages'])} macOS SDK packages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
