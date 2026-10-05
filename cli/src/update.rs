//! `xclang sdk update-table` (the maintainer feature): adds every SDK
//! version the vendors offer now to the version table, and the presets of
//! GitHub's runner images.
//!
//! What is in the table never changes; a run only appends what is new. Only
//! the presets, which follow the images, are made anew. The sha256s Visual
//! Studio's manifests list are taken from them; the others are computed by
//! downloading the packages (nuget.org gives SHA-512 only), some 15 GB the
//! first time.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use regex_lite::Regex;
use serde_json::Value;
use ureq::ResponseExt;

use crate::table::{
    Listed, MacPackage, Manifest, Msvc, Package, Preset, Table, VecMap, Vsman, WinSdk, version_cmp,
};
use crate::{Context, Result, bail, http, xml};

/// Visual Studio's stable channels, newest first: a toolset several of them
/// carry (each signs its own copy) comes from the newest.
const CHANNELS: [&str; 3] = ["vs/18/stable", "vs/17/release", "vs/16/release"];
/// Per architecture, the CRT packages the /winsysroot takes.
const MSVC_ARCHS: [(&str, &str); 3] = [("x86_64", "x64"), ("aarch64", "ARM64"), ("x86", "x86")];
const MSVC_PARTS: [(&str, &str); 3] = [
    ("desktop", "Desktop"),
    ("store", "Store"),
    ("desktop-debug", "Desktop.debug"),
];

const NUGET: &str = "https://api.nuget.org/v3-flatcontainer";
const NUGET_PACKAGES: [(&str, &str); 4] = [
    ("headers", "microsoft.windows.sdk.cpp"),
    ("x86_64", "microsoft.windows.sdk.cpp.x64"),
    ("aarch64", "microsoft.windows.sdk.cpp.arm64"),
    ("x86", "microsoft.windows.sdk.cpp.x86"),
];

/// Apple's software update catalogs, one per macOS release: each lists the
/// Command Line Tools for that release and those before it.
const CATALOG_TAIL: &str = "10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz";
const CATALOG_HEADS: [&str; 7] = [
    "27-26-15-14-13-12-",
    "26-15-14-13-12-",
    "15-14-13-12-",
    "14-13-12-",
    "13-12-",
    "12-",
    "",
];
const OLD_CATALOGS: [&str; 2] = [
    "https://swscan.apple.com/content/catalogs/others/index-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
    "https://swscan.apple.com/content/catalogs/others/index-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
];

const RUNNER_IMAGES: &str = "https://raw.githubusercontent.com/actions/runner-images/main";
/// Visual Studio's major version -> the channel of its toolsets.
const VS_CHANNELS: [(&str, &str); 3] = [
    ("16", "vs/16/release"),
    ("17", "vs/17/release"),
    ("18", "vs/18/stable"),
];

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}

/// A document and the URL it came from after redirects.
fn fetch(url: &str) -> Result<(Vec<u8>, String)> {
    let response = http::agent().get(url).call().context(url)?;
    let final_url = response.get_uri().to_string();
    let mut data = vec![];
    response
        .into_body()
        .into_reader()
        .read_to_end(&mut data)
        .context(url)?;
    Ok((data, final_url))
}

fn sha256(data: &[u8]) -> String {
    http::hex(ring::digest::digest(&ring::digest::SHA256, data).as_ref())
}

/// Size and sha256 of what url serves, streamed; written to keep too.
fn hash_url(url: &str, keep: Option<&Path>) -> Result<(u64, String)> {
    let mut body = http::open(url)?;
    let mut out = keep.map(File::create).transpose()?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let (mut buf, mut size) = (vec![0; 1 << 20], 0u64);
    loop {
        let n = body.reader.read(&mut buf).context(url)?;
        if n == 0 {
            break;
        }
        ctx.update(&buf[..n]);
        if let Some(f) = &mut out {
            f.write_all(&buf[..n])?;
        }
        size += n as u64;
    }
    Ok((size, http::hex(ctx.finish().as_ref())))
}

fn content_length(url: &str) -> Result<u64> {
    let response = http::agent().head(url).call().context(url)?;
    let length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok()?.parse().ok());
    length.ok_or_else(|| crate::Error(format!("{url}: no Content-Length")))
}

pub fn run(file: &str, jobs: usize) -> Result<()> {
    let mut table = Table::load(Some(file))?;
    let mut defaults = HashMap::new();
    update_msvc(&mut table, jobs, &mut defaults)?;
    update_winsdk(&mut table, jobs)?;
    update_macos(&mut table, jobs)?;
    update_presets(&mut table, &defaults)?;
    std::fs::write(file, table.to_json()?).context(file)?;
    let w = &table.windows;
    eprintln!(
        "{} Windows SDKs, {} MSVC toolsets, {} macOS SDK packages",
        w.sdk.0.len(),
        w.msvc.0.len(),
        table.macos.packages.len()
    );
    Ok(())
}

/// The MSVC a Visual Studio installs with its C++ tools: the CRT headers the
/// VC.Tools.x86.x64 component comes to, breadth first.
fn default_msvc(packages: &HashMap<String, &Value>, headers: &Regex) -> Option<String> {
    let mut todo =
        VecDeque::from(["microsoft.visualstudio.component.vc.tools.x86.x64".to_string()]);
    let mut seen = HashSet::new();
    while let Some(id) = todo.pop_front() {
        if let Some(m) = headers.captures(&id) {
            return Some(m[1].to_string());
        }
        if seen.insert(id.clone())
            && let Some(deps) = packages
                .get(&id)
                .and_then(|p| p["dependencies"].as_object())
        {
            todo.extend(deps.keys().map(|d| d.to_lowercase()));
        }
    }
    None
}

fn update_msvc(
    table: &mut Table,
    jobs: usize,
    defaults: &mut HashMap<String, (String, Option<String>)>,
) -> Result<()> {
    let headers = re(r"^microsoft\.vc\.(\d+\.\d+(?:\.\d+\.\d+)?)\.crt\.headers\.base$");
    for channel in CHANNELS {
        let (raw, url) = fetch(&format!("https://aka.ms/{channel}/channel"))?;
        let manifest: Value = serde_json::from_slice(&raw)?;
        let info = &manifest["info"];
        let display = info["productDisplayVersion"].as_str().unwrap_or_default();
        let name = format!(
            "{} {}",
            info["manifestName"].as_str().unwrap_or_default(),
            display.split_whitespace().next().unwrap_or_default()
        );
        let Some(item) = manifest["channelItems"].as_array().and_then(|items| {
            items
                .iter()
                .find(|i| i["id"] == "Microsoft.VisualStudio.Manifests.VisualStudio")
        }) else {
            bail!("{channel}: no VisualStudio manifest")
        };
        let vsman = &item["payloads"][0];
        let vsman_url = vsman["url"].as_str().unwrap_or_default();
        // The CDN serves the vsman smaller than the size and sha256 the
        // channel manifest lists for it, whatever the request: it is pinned
        // by what it serves. The packages it lists match their sha256.
        let (data, _) = fetch(vsman_url)?;
        let doc: Value = serde_json::from_slice(&data)?;
        let mut packages: HashMap<String, &Value> = HashMap::new();
        for p in doc["packages"].as_array().into_iter().flatten() {
            packages
                .entry(p["id"].as_str().unwrap_or_default().to_lowercase())
                .or_insert(p);
        }
        // 14.44.17.14, or since Visual Studio 2026 14.51.
        let mut versions: Vec<String> = packages
            .keys()
            .filter_map(|i| Some(headers.captures(i)?[1].to_string()))
            .collect();
        versions.sort_by(|a, b| version_cmp(a, b));
        let default = default_msvc(&packages, &headers);
        eprintln!(
            "{name}: MSVC {}, {} by default",
            versions.join(" "),
            default.as_deref().unwrap_or("none")
        );
        defaults.insert(channel.to_string(), (name.clone(), default));

        let vsix = |version: &str, part: &str| -> Option<(String, String)> {
            let p =
                packages.get(&format!("microsoft.vc.{version}.crt.{part}.base").to_lowercase())?;
            let payload = p["payloads"]
                .as_array()?
                .iter()
                .find(|x| x["fileName"].as_str().is_some_and(|f| f.ends_with(".vsix")))?;
            Some((
                payload["url"].as_str()?.to_string(),
                payload["sha256"].as_str()?.to_lowercase(),
            ))
        };
        let new: Vec<String> = versions
            .into_iter()
            .filter(|v| !table.windows.msvc.contains(v))
            .collect();
        // (version, arch or "", part) of every package, then their sizes:
        // the vsman's size is not always the download's.
        let mut slots: Vec<(String, &str, &str, String, String)> = vec![];
        for version in &new {
            let Some((url, sha)) = vsix(version, "Headers") else {
                bail!("MSVC {version}: no headers package")
            };
            slots.push((version.clone(), "", "headers", url, sha));
            for (arch, ms) in MSVC_ARCHS {
                let parts: Vec<_> = MSVC_PARTS
                    .iter()
                    .map(|(k, v)| (*k, vsix(version, &format!("{ms}.{v}"))))
                    .collect();
                if parts[0].1.is_some() && parts[1].1.is_some() {
                    for (k, p) in parts {
                        if let Some((url, sha)) = p {
                            slots.push((version.clone(), arch, k, url, sha));
                        }
                    }
                }
            }
        }
        let sizes = crate::parallel(&slots, jobs, |s| content_length(&s.3))?;
        for version in &new {
            let mut entry: Option<Msvc> = None;
            for ((v, arch, part, url, sha), size) in slots.iter().zip(&sizes) {
                if v != version {
                    continue;
                }
                let package = Package {
                    url: url.clone(),
                    size: *size,
                    sha256: sha.clone(),
                };
                if *part == "headers" {
                    entry = Some(Msvc {
                        manifest: name.clone(),
                        headers: package,
                        x86_64: None,
                        aarch64: None,
                        x86: None,
                    });
                    continue;
                }
                let e = entry.as_mut().unwrap();
                let slot = match *arch {
                    "x86_64" => &mut e.x86_64,
                    "aarch64" => &mut e.aarch64,
                    _ => &mut e.x86,
                };
                slot.get_or_insert_with(VecMap::default)
                    .insert(part.to_string(), package);
            }
            table.windows.msvc.insert(version.clone(), entry.unwrap());
            if !table.windows.manifests.contains(&name) {
                table.windows.manifests.insert(
                    name.clone(),
                    Manifest {
                        channel: format!("https://aka.ms/{channel}/channel"),
                        url: url.clone(),
                        size: raw.len() as u64,
                        sha256: sha256(&raw),
                        vsman: Vsman {
                            url: vsman_url.to_string(),
                            size: data.len() as u64,
                            sha256: sha256(&data),
                            listed: Listed {
                                size: vsman["size"].as_u64().unwrap_or_default(),
                                sha256: vsman["sha256"].as_str().unwrap_or_default().to_lowercase(),
                            },
                        },
                    },
                );
            }
            eprintln!("  + MSVC {version}");
        }
    }
    table.windows.msvc.sort_by_version();
    Ok(())
}

fn update_winsdk(table: &mut Table, jobs: usize) -> Result<()> {
    let mut offered: HashMap<&str, HashSet<String>> = HashMap::new();
    for (part, pkg) in NUGET_PACKAGES {
        let (data, _) = fetch(&format!("{NUGET}/{pkg}/index.json"))?;
        let doc: Value = serde_json::from_slice(&data)?;
        let versions = doc["versions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str);
        offered.insert(
            part,
            versions
                .filter(|v| !v.contains('-'))
                .map(String::from)
                .collect(),
        );
    }
    let mut new: Vec<&String> = offered["headers"]
        .iter()
        .filter(|v| !table.windows.sdk.contains(v))
        .collect();
    new.sort_by(|a, b| version_cmp(a, b));
    let mut slots = vec![];
    for v in &new {
        for (part, pkg) in NUGET_PACKAGES {
            if offered[part].contains(*v) {
                slots.push((
                    (*v).clone(),
                    part,
                    format!("{NUGET}/{pkg}/{v}/{pkg}.{v}.nupkg"),
                ));
            }
        }
    }
    let hashes = crate::parallel(&slots, jobs, |(_, _, url)| hash_url(url, None))?;
    for v in new {
        let mut parts: HashMap<&str, Package> = HashMap::new();
        for ((w, part, url), (size, sha)) in slots.iter().zip(&hashes) {
            if w == v {
                parts.insert(
                    part,
                    Package {
                        url: url.clone(),
                        size: *size,
                        sha256: sha.clone(),
                    },
                );
            }
        }
        let Some(headers) = parts.remove("headers") else {
            continue;
        };
        let sdk = WinSdk {
            headers,
            x86_64: parts.remove("x86_64"),
            aarch64: parts.remove("aarch64"),
            x86: parts.remove("x86"),
        };
        table.windows.sdk.insert(v.clone(), sdk);
        eprintln!("  + Windows SDK {v}");
    }
    table.windows.sdk.sort_by_version();
    Ok(())
}

fn update_macos(table: &mut Table, jobs: usize) -> Result<()> {
    // An SDK package, not the empty ones that remove an old SDK.
    let sdk_package = re(r"/CLTools_[^/]*SDK[^/]*\.pkg$");
    let known: HashSet<String> = table.macos.packages.iter().map(|p| p.url.clone()).collect();
    // url -> (posted, product), in the order the catalogs list them.
    let mut found: Vec<(String, (String, String))> = vec![];
    let catalogs = CATALOG_HEADS
        .iter()
        .map(|h| {
            format!("https://swscan.apple.com/content/catalogs/others/index-{h}{CATALOG_TAIL}")
        })
        .chain(OLD_CATALOGS.iter().map(|s| s.to_string()));
    for url in catalogs {
        let data = match fetch(&url) {
            Ok((data, _)) => data,
            Err(e) => {
                eprintln!("{e}");
                continue;
            }
        };
        let mut text = String::new();
        flate2::read::GzDecoder::new(&data[..])
            .read_to_string(&mut text)
            .context(&url)?;
        let catalog = plist(&xml::parse(&text)?)?;
        let Some(Plist::Dict(products)) = catalog.get("Products") else {
            bail!("{url}: no Products")
        };
        for (pid, product) in products {
            let Some(Plist::Array(packages)) = product.get("Packages") else {
                continue;
            };
            let posted = match product.get("PostDate") {
                Some(Plist::Date(d)) => d.clone(),
                _ => String::new(),
            };
            for p in packages {
                let (Some(Plist::String(u)), Some(Plist::Integer(size))) =
                    (p.get("URL"), p.get("Size"))
                else {
                    continue;
                };
                let u = match u.strip_prefix("http:") {
                    Some(rest) => format!("https:{rest}"),
                    None => u.clone(),
                };
                if sdk_package.is_match(&u)
                    && *size > 1 << 20
                    && !known.contains(&u)
                    && !found.iter().any(|f| f.0 == u)
                {
                    found.push((u, (posted.clone(), pid.clone())));
                }
            }
        }
    }
    let tmp = std::env::temp_dir().join(format!("xclang-update-{}", std::process::id()));
    std::fs::create_dir_all(&tmp)?;
    let examined = crate::parallel(&found, jobs, |(url, _)| {
        let pkg = tmp.join(format!("{}.pkg", sha256(url.as_bytes())));
        let (size, sha) = hash_url(url, Some(&pkg))?;
        let version = crate::macos::sdk_version(&pkg);
        let _ = std::fs::remove_file(&pkg);
        Ok((size, sha, version?))
    });
    let _ = std::fs::remove_dir_all(&tmp);
    let examined = examined?;
    let mut order: Vec<usize> = (0..found.len()).collect();
    // Newest first (stable: as the catalogs list them on a tie): the first
    // package of a version is the one fetch takes.
    order.sort_by(|&a, &b| found[b].1.cmp(&found[a].1));
    let mut shas: HashSet<String> = table
        .macos
        .packages
        .iter()
        .map(|p| p.sha256.clone())
        .collect();
    for i in order {
        let (url, (posted, pid)) = &found[i];
        let (size, sha, version) = &examined[i];
        if !shas.insert(sha.clone()) {
            continue;
        }
        table.macos.packages.push(MacPackage {
            sdk: version.clone(),
            product: pid.clone(),
            posted: posted.chars().take(10).collect(),
            url: url.clone(),
            size: *size,
            sha256: sha.clone(),
        });
        eprintln!(
            "  + macOS SDK {version} ({pid}, {})",
            url.rsplit('/').next().unwrap_or(url)
        );
    }
    Ok(())
}

/// Presets: what GitHub's Windows and macOS runner images (not deprecated
/// ones) build with, from actions/runner-images' software lists. Unlike
/// the versions they point to, they follow the images: each says which
/// image, of which version, it mirrors, and when that was read.
fn update_presets(
    table: &mut Table,
    defaults: &HashMap<String, (String, Option<String>)>,
) -> Result<()> {
    let today = today();
    let readme =
        String::from_utf8(fetch(&format!("{RUNNER_IMAGES}/README.md"))?.0).context("README.md")?;
    let links: HashMap<String, String> =
        re(r"(?m)^\[([^\]]+)\]: https://github\.com/actions/runner-images/blob/main/(\S+)$")
            .captures_iter(&readme)
            .map(|c| (c[1].to_string(), c[2].to_string()))
            .collect();
    let label = re(r"`([^`]+)`");
    let vs_re = re(r"(?m)^\| Visual Studio \w+ (\d{4}) \| (\d+)\.([\d.]+) \|");
    let kit_re = re(r"(?m)^\| Windows Software Development Kit\s*\| 10\.1\.([\d.]+)");
    let xcode_re = re(r"(?m)^\| ([\d.]+) \(default\)");
    let sdk_re = re(r"(?m)^\| macOS ([\d.]+)\s*\| macosx[\d.]+\s*\| ([^|]+)\|");
    let macos: HashSet<&str> = table
        .macos
        .packages
        .iter()
        .map(|p| p.sdk.as_str())
        .collect();
    let mut presets = VecMap::default();
    for row in re(r"(?m)^\|(.+)\|$").captures_iter(&readme) {
        let cells: Vec<&str> = row[1].split('|').map(str::trim).collect();
        if cells.len() < 4 || cells[0].contains("deprecated") || !cells[3].starts_with('[') {
            continue;
        }
        let key = cells[3].trim_matches(['[', ']']).to_string();
        let labels: Vec<String> = label
            .captures_iter(cells[2])
            .map(|c| c[1].to_string())
            .collect();
        let Some(path) = links.get(&key) else {
            continue;
        };
        if labels.is_empty()
            || !(path.starts_with("images/windows/") || path.starts_with("images/macos/"))
        {
            continue;
        }
        let text = String::from_utf8(fetch(&format!("{RUNNER_IMAGES}/{path}"))?.0).context(path)?;
        let mut image = Preset {
            image: key.clone(),
            labels: labels.clone(),
            readme: format!("https://github.com/actions/runner-images/blob/main/{path}"),
            image_version: re(r"Image Version: (\S+)")
                .captures(&text)
                .map(|c| c[1].to_string()),
            visual_studio: None,
            msvc: None,
            xcode: None,
            sdk: String::new(),
            read: None,
        };
        let missing: Vec<String>;
        if path.starts_with("images/windows/") {
            let (Some(vs), Some(kit)) = (vs_re.captures(&text), kit_re.captures(&text)) else {
                eprintln!("{key}: no Visual Studio or Windows SDK in its software list");
                continue;
            };
            image.visual_studio = Some(format!("{} {}.{}", &vs[1], &vs[2], &vs[3]));
            let channel = VS_CHANNELS
                .iter()
                .find(|(major, _)| *major == &vs[2])
                .map(|(_, c)| *c);
            image.msvc = channel.and_then(|c| defaults.get(c)?.1.clone());
            image.sdk = format!("10.0.{}", &kit[1]);
            let msvc_known = image
                .msvc
                .as_deref()
                .is_some_and(|m| table.windows.msvc.contains(m));
            missing = [
                (image.msvc.clone().unwrap_or_default(), msvc_known),
                (image.sdk.clone(), table.windows.sdk.contains(&image.sdk)),
            ]
            .into_iter()
            .filter(|(_, known)| !known)
            .map(|(v, _)| v)
            .collect();
        } else {
            let Some(xcode) = xcode_re.captures(&text) else {
                eprintln!("{key}: no default Xcode in its software list");
                continue;
            };
            // Installed SDKs: | macOS 15.5 | macosx15.5 | 16.4 |, the Xcodes last.
            let sdk = sdk_re.captures_iter(&text).find_map(|m| {
                m[2].split(',')
                    .any(|x| x.trim() == &xcode[1])
                    .then(|| m[1].to_string())
            });
            let Some(sdk) = sdk else {
                eprintln!("{key}: no default Xcode's macOS SDK in its software list");
                continue;
            };
            image.xcode = Some(xcode[1].to_string());
            missing = if macos.contains(sdk.as_str()) {
                vec![]
            } else {
                vec![sdk.clone()]
            };
            image.sdk = sdk;
        }
        if !missing.is_empty() {
            eprintln!("{key}: {missing:?} not in the table");
            continue;
        }
        // When it was read: the day it last changed.
        image.read = match table.presets.get(&key) {
            Some(old)
                if Preset {
                    read: None,
                    ..old.clone()
                } == image =>
            {
                old.read.clone().or(Some(today.clone()))
            }
            _ => Some(today.clone()),
        };
        let what: Vec<String> = [
            ("visual-studio", &image.visual_studio),
            ("xcode", &image.xcode),
            ("msvc", &image.msvc),
            ("sdk", &Some(image.sdk.clone())),
        ]
        .iter()
        .filter_map(|(k, v)| v.as_ref().map(|v| format!("{k} {v}")))
        .collect();
        eprintln!(
            "  preset {key} ({}): {}",
            labels.join(", "),
            what.join(", ")
        );
        presets.insert(key, image);
    }
    table.presets = presets;
    Ok(())
}

/// Today's date in UTC, 2026-10-05.
fn today() -> String {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() / 86_400) as i64;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// A property list value.
#[derive(Debug, Clone)]
pub enum Plist {
    String(String),
    Integer(i64),
    Date(String),
    /// real, true, false, data: nothing here reads them.
    Other,
    Array(Vec<Plist>),
    Dict(Vec<(String, Plist)>),
}

impl Plist {
    pub fn get(&self, key: &str) -> Option<&Plist> {
        match self {
            Plist::Dict(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// The value of a <plist> document's element, or of a value element.
pub fn plist(e: &xml::Element) -> Result<Plist> {
    Ok(match e.name.as_str() {
        "plist" => match e.elements().next() {
            Some(v) => plist(v)?,
            None => bail!("an empty plist"),
        },
        "string" => Plist::String(e.text()),
        "integer" => Plist::Integer(e.text().trim().parse().context("plist integer")?),
        "date" => Plist::Date(e.text()),
        "real" | "true" | "false" | "data" => Plist::Other,
        "array" => Plist::Array(e.elements().map(plist).collect::<Result<_>>()?),
        "dict" => {
            let mut entries = vec![];
            let mut it = e.elements();
            while let Some(k) = it.next() {
                if k.name != "key" {
                    bail!("plist dict: <{}> where a <key> belongs", k.name);
                }
                let Some(v) = it.next() else {
                    bail!("plist dict: no value for {}", k.text())
                };
                entries.push((k.text(), plist(v)?));
            }
            Plist::Dict(entries)
        }
        other => bail!("unknown plist element <{other}>"),
    })
}

/// A string of a property list's top-level dictionary.
pub fn plist_string(text: &str, key: &str) -> Result<Option<String>> {
    Ok(match plist(&xml::parse(text)?)?.get(key) {
        Some(Plist::String(s)) => Some(s.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plists() {
        let text = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Version</key><string>10.14</string>\
                    <key>N</key><integer>3</integer><key>A</key><array><true/><date>2026-09-09T17:41:12Z</date></array>\
                    </dict></plist>";
        assert_eq!(
            plist_string(text, "Version").unwrap().as_deref(),
            Some("10.14")
        );
        let p = plist(&xml::parse(text).unwrap()).unwrap();
        assert!(matches!(p.get("N"), Some(Plist::Integer(3))));
        assert!(matches!(p.get("A"), Some(Plist::Array(a)) if a.len() == 2));
    }

    #[test]
    fn dates() {
        assert_eq!(today().len(), 10);
    }
}
