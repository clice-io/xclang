#!/usr/bin/env python3
"""Add every SDK version the vendors offer now to versions.json, and the
presets of GitHub's runner images.

What is in the table never changes; a run only appends what is new. Only
the presets, which follow the images, are made anew. The
table says where each package is, its size and its sha256, and nothing from
inside the packages but the version of the macOS SDK a Command Line Tools
package carries. The sha256s Visual Studio's manifests list are taken from
them; the others are computed by downloading the packages (nuget.org gives
SHA-512 only), some 15 GB the first time.

  update-versions.py [--table sdk/versions.json] [--jobs 8]
"""

import argparse
import concurrent.futures
import datetime
import gzip
import hashlib
import importlib.util
import json
import os
import plistlib
import re
import sys
import tempfile

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
    with vendor.urlopen(url, timeout=120) as r:
        return r.read(), r.url


def hash_url(url, keep=None):
    """Size and sha256 of what url serves, streamed; written to keep too."""
    h, size = hashlib.sha256(), 0
    with vendor.urlopen(url, timeout=120) as r, open(keep or os.devnull, "wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def content_length(url):
    with vendor.urlopen(url, method="HEAD") as r:
        return int(r.headers["Content-Length"])


def package(url, size, sha256):
    return {"url": url, "size": size, "sha256": sha256}


def default_msvc(packages):
    """The MSVC a Visual Studio installs with its C++ tools: the CRT headers
    the VC.Tools.x86.x64 component comes to, breadth first."""
    todo, seen = ["microsoft.visualstudio.component.vc.tools.x86.x64"], set()
    while todo:
        i = todo.pop(0)
        if (m := re.match(r"microsoft\.vc\.(\d+\.\d+(?:\.\d+\.\d+)?)\.crt\.headers\.base$", i)):
            return m.group(1)
        if i not in seen:
            seen.add(i)
            todo += [d.lower() for d in (packages.get(i, {}).get("dependencies") or {})]
    return None


def update_msvc(table, pool, defaults):
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
        packages = {}
        for p in json.loads(data)["packages"]:
            packages.setdefault(p["id"].lower(), p)
        # 14.44.17.14, or since Visual Studio 2026 14.51.
        versions = {m.group(1) for i in packages if (m := re.match(r"microsoft\.vc\.(\d+\.\d+(?:\.\d+\.\d+)?)\.crt\.headers\.base$", i))}
        default = default_msvc(packages)
        log(f"{name}: MSVC {' '.join(sorted(versions, key=version_key))}, {default} by default")
        defaults[channel] = (name, default)

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


RUNNER_IMAGES = "https://raw.githubusercontent.com/actions/runner-images/main"
# Visual Studio's major version -> the channel of its toolsets.
VS_CHANNELS = {"16": "vs/16/release", "17": "vs/17/release", "18": "vs/18/stable"}


def update_presets(table, defaults):
    """Presets: what GitHub's Windows and macOS runner images (not
    deprecated ones) build with, from actions/runner-images' software lists.
    Unlike the versions they point to, they follow the images: each says
    which image, of which version, it mirrors, and when that was read."""
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    readme, _ = fetch(f"{RUNNER_IMAGES}/README.md")
    readme = readme.decode()
    links = dict(re.findall(r"^\[([^\]]+)\]: https://github\.com/actions/runner-images/blob/main/(\S+)$", readme, re.M))
    msvc = table["windows"]["msvc"]
    sdks = table["windows"]["sdk"]
    macos = {p["sdk"] for p in table["macos"]["packages"]}
    presets = {}
    for row in re.findall(r"^\|(.+)\|$", readme, re.M):
        cells = [c.strip() for c in row.split("|")]
        if len(cells) < 4 or "deprecated" in cells[0] or not cells[3].startswith("["):
            continue
        key = cells[3].strip("[]")
        labels = re.findall(r"`([^`]+)`", cells[2])
        path = links.get(key)
        if not path or not labels or not re.match(r"images/(windows|macos)/", path):
            continue
        text = fetch(f"{RUNNER_IMAGES}/{path}")[0].decode()
        image = {"image": key, "labels": labels, "readme": f"https://github.com/actions/runner-images/blob/main/{path}"}
        if m := re.search(r"Image Version: (\S+)", text):
            image["image-version"] = m.group(1)
        if path.startswith("images/windows/"):
            vs = re.search(r"^\| Visual Studio \w+ (\d{4}) \| (\d+)\.([\d.]+) \|", text, re.M)
            kit = re.search(r"^\| Windows Software Development Kit\s*\| 10\.1\.([\d.]+)", text, re.M)
            if not vs or not kit:
                log(f"{key}: no Visual Studio or Windows SDK in its software list")
                continue
            image["visual-studio"] = f"{vs.group(1)} {vs.group(2)}.{vs.group(3)}"
            image["msvc"] = defaults.get(VS_CHANNELS.get(vs.group(2)), (None, None))[1]
            image["sdk"] = f"10.0.{kit.group(1)}"
            missing = [v for v, known in ((image["msvc"], msvc), (image["sdk"], sdks)) if v not in known]
        else:
            xcode = re.search(r"^\| ([\d.]+) \(default\)", text, re.M)
            # Installed SDKs: | macOS 15.5 | macosx15.5 | 16.4 |, the Xcodes last.
            sdk = xcode and next(
                (m.group(1) for m in re.finditer(r"^\| macOS ([\d.]+)\s*\| macosx[\d.]+\s*\| ([^|]+)\|", text, re.M)
                 if xcode.group(1) in [x.strip() for x in m.group(2).split(",")]),
                None,
            )
            if not sdk:
                log(f"{key}: no default Xcode's macOS SDK in its software list")
                continue
            image["xcode"] = xcode.group(1)
            image["sdk"] = sdk
            missing = [sdk] if sdk not in macos else []
        if missing:
            log(f"{key}: {missing} not in the table")
            continue
        # When it was read: the day it last changed.
        before = {k: v for k, v in table.get("presets", {}).get(key, {}).items() if k != "read"}
        image["read"] = table["presets"][key].get("read", today) if before == image else today
        presets[key] = image
        log(f"  preset {key} ({', '.join(labels)}): " + ", ".join(f"{k} {image[k]}" for k in ("visual-studio", "xcode", "msvc", "sdk") if k in image))
    table["presets"] = presets


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--table", default=os.path.join(HERE, "versions.json"))
    p.add_argument("--jobs", type=int, default=8)
    a = p.parse_args()
    table = {}
    if os.path.exists(a.table):
        with open(a.table) as f:
            table = json.load(f)
    defaults = {}
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        update_msvc(table, pool, defaults)
        update_winsdk(table, pool)
        update_macos(table, pool)
    update_presets(table, defaults)
    with open(a.table, "w") as f:
        json.dump(table, f, indent=1)
        f.write("\n")
    w = table["windows"]
    log(f"{len(w['sdk'])} Windows SDKs, {len(w['msvc'])} MSVC toolsets, {len(table['macos']['packages'])} macOS SDK packages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
