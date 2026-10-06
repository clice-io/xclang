//! `xclang sdk`: vendor SDKs, fetched from the vendors by version and
//! sha256 (the built-in version table) once the user accepts their license,
//! each into a directory of its own under the SDK directory:
//!
//!   <sdk dir>/macos-<version>/                  -isysroot
//!   <sdk dir>/windows-msvc<v>-sdk<v>/           /winsysroot
//!   <sdk dir>/macos, <sdk dir>/windows          the one in use
//!
//! The SDK directory is <toolchain>/sdk, or --sdk-dir / $XCLANG_SDK_DIR for
//! a toolchain installed where its user cannot write. Each SDK records
//! what it was fetched from in .xclang-sdk.json, written last: a directory
//! without it is incomplete. The SDK in use, the last fetched or the one
//! `sdk use` names, is a link with the vendor's name (a junction on
//! Windows), the fixed path the toolchain's config files read: a Windows
//! SDK holds config files for the MSVC targets of each of its
//! architectures, which name it (windows::write_configs).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::args::Args;
use crate::links::{self, Links};
use crate::table::{self, MacPackage, Package, Preset, Table, Vendor, ms_arch, pick};
use crate::toolchain::Toolchain;
use crate::windows::Kind;
use crate::{Context, Result, bail, macos, mb, windows};

const RECORD: &str = ".xclang-sdk.json";

/// What an SDK directory holds.
#[derive(Serialize, Deserialize, Debug)]
pub struct Record {
    pub kind: String,
    /// macOS: the SDK's version (26.5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Windows: MSVC's and the Windows SDK's versions in the table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msvc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    /// Windows: the directories they unpack to (14.44.35207, 10.0.26100.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub archs: Vec<String>,
    pub packages: Vec<Package>,
}

pub fn main(a: &mut Args) -> Result<()> {
    let words: Vec<String> = a.words[1..].to_vec();
    let words: Vec<&str> = words.iter().map(String::as_str).collect();
    let table = Table::load(a.value("table"))?;
    let selection = ["preset", "version", "sdk-version", "msvc-version", "arch"];
    match words[..] {
        ["list"] | ["list", _] => {
            a.allow(&[])?;
            let vendor = words.get(1).map(|v| Vendor::parse(v)).transpose()?;
            list(&table, vendor, sdk_dir(a).ok().as_deref())
        }
        ["fetch", vendor] => {
            let mut allowed = selection.to_vec();
            allowed.extend(["accept-license", "cache", "links", "pkg"]);
            a.allow(&allowed)?;
            fetch(a, &table, Vendor::parse(vendor)?)
        }
        ["path", vendor] => {
            a.allow(&selection)?;
            let vendor = Vendor::parse(vendor)?;
            let dir = sdk_dir(a)?.join(choose(a, &table, vendor)?.name());
            let Some(record) = read_record(&dir) else {
                bail!(
                    "{} is not fetched: xclang sdk fetch {} --accept-license",
                    dir.display(),
                    vendor.name()
                )
            };
            if let Some(arch) = a.value("arch") {
                for x in arch.split(',') {
                    if !record.archs.iter().any(|r| r == x) {
                        bail!(
                            "{} has no {x}: fetch it again with --arch {arch}",
                            dir.display()
                        );
                    }
                }
            }
            println!("{}", dir.display());
            Ok(())
        }
        ["remove", name] => {
            a.allow(&[])?;
            let root = sdk_dir(a)?;
            let dir = fetched(&root, name)?;
            for vendor in [Vendor::Macos, Vendor::Windows] {
                if links::alias_of(&root, vendor.name()).as_deref() == Some(name) {
                    links::remove_alias(&root, vendor.name()).context(root.display())?;
                }
            }
            links::remove_tree(&dir).context(dir.display())?;
            eprintln!("removed {}", dir.display());
            Ok(())
        }
        ["use", name] => {
            a.allow(&[])?;
            let root = links::canonical(&sdk_dir(a)?)?;
            let dir = fetched(&root, name)?;
            let Some(record) = read_record(&dir) else {
                bail!("{} is incomplete: fetch it again", dir.display())
            };
            use_sdk(&root, &record.kind, name)
        }
        #[cfg(feature = "maintainer")]
        ["update-table"] => {
            a.allow(&["jobs"])?;
            let file = a.value("table").unwrap_or("cli/sdk-versions.json");
            let jobs = a
                .value("jobs")
                .map_or(Ok(8), str::parse)
                .context("--jobs")?;
            crate::update::run(file, jobs)
        }
        _ => bail!("unknown command sdk {}; see xclang --help", words.join(" ")),
    }
}

/// Where SDKs go.
pub fn sdk_dir(a: &Args) -> Result<PathBuf> {
    if let Some(dir) = a
        .value("sdk-dir")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XCLANG_SDK_DIR").map(PathBuf::from))
    {
        return Ok(dir);
    }
    match Toolchain::find(a.value("root")) {
        Ok(t) => Ok(t.root.join("sdk")),
        Err(e) => bail!("{e}; or name a directory for SDKs with --sdk-dir or XCLANG_SDK_DIR"),
    }
}

/// The directory of a fetched SDK, by its name.
fn fetched(root: &Path, name: &str) -> Result<PathBuf> {
    let dir = root.join(name);
    if !links::is_safe(Path::new(name))
        || name.contains(['/', '\\'])
        || !dir.is_dir()
        || links::is_link(&dir)
    {
        bail!("no SDK {name} in {}", root.display());
    }
    Ok(dir)
}

/// Make the fetched SDK `name` the one in use: the link <root>/<vendor>.
fn use_sdk(root: &Path, vendor: &str, name: &str) -> Result<()> {
    links::set_alias(root, vendor, name).context(root.join(vendor).display())?;
    eprintln!("{} is {name}", root.join(vendor).display());
    Ok(())
}

pub fn read_record(dir: &Path) -> Option<Record> {
    serde_json::from_slice(&fs::read(dir.join(RECORD)).ok()?).ok()
}

/// What the options select.
enum Choice<'a> {
    Macos {
        version: String,
        package: &'a MacPackage,
        preset: Option<(&'a str, &'a Preset)>,
    },
    Windows {
        msvc: String,
        sdk: String,
        archs: Vec<String>,
        preset: Option<(&'a str, &'a Preset)>,
    },
}

impl Choice<'_> {
    fn name(&self) -> String {
        match self {
            Choice::Macos { version, .. } => format!("macos-{version}"),
            Choice::Windows { msvc, sdk, .. } => format!("windows-msvc{msvc}-sdk{sdk}"),
        }
    }
}

/// The versions of the preset (--preset, or the default one), each replaced
/// by the version an option names.
fn choose<'a>(a: &Args, table: &'a Table, vendor: Vendor) -> Result<Choice<'a>> {
    let named = a.value("preset").unwrap_or(vendor.default_preset());
    let (key, preset) = table.preset(named, vendor)?;
    match vendor {
        Vendor::Macos => {
            if a.value("sdk-version").is_some()
                || a.value("msvc-version").is_some()
                || a.value("arch").is_some()
            {
                bail!(
                    "--sdk-version, --msvc-version and --arch are for windows; macOS takes --version"
                );
            }
            let versions = table.macos_versions();
            let given = a.value("version");
            let version = pick(
                versions.keys(),
                Some(given.unwrap_or(&preset.sdk)),
                "macOS SDK",
            )?;
            let package = versions.get(&version).unwrap();
            Ok(Choice::Macos {
                version,
                package,
                preset: given.is_none().then_some((key, preset)),
            })
        }
        Vendor::Windows => {
            if a.value("version").is_some() {
                bail!("--version is for macos; Windows takes --msvc-version and --sdk-version");
            }
            let w = &table.windows;
            let (sdk_given, msvc_given) = (a.value("sdk-version"), a.value("msvc-version"));
            let sdk = pick(
                w.sdk.keys(),
                Some(sdk_given.unwrap_or(&preset.sdk)),
                "Windows SDK",
            )?;
            let msvc_want = msvc_given.or(preset.msvc.as_deref());
            let msvc = pick(w.msvc.keys(), msvc_want, "MSVC")?;
            let archs: Vec<String> = a
                .value("arch")
                .unwrap_or("x86_64,aarch64")
                .split(',')
                .map(String::from)
                .collect();
            for arch in &archs {
                if ms_arch(arch).is_none() {
                    bail!("unknown architecture {arch}: x86_64, aarch64 or x86");
                }
                if w.msvc.get(&msvc).unwrap().arch(arch).is_none() {
                    bail!("MSVC {msvc} has no {arch} packages");
                }
                if w.sdk.get(&sdk).unwrap().arch(arch).is_none() {
                    bail!("Windows SDK {sdk} has no {arch} packages");
                }
            }
            let preset = (sdk_given.is_none() || msvc_given.is_none()).then_some((key, preset));
            Ok(Choice::Windows {
                msvc,
                sdk,
                archs,
                preset,
            })
        }
    }
}

fn fetch(a: &Args, table: &Table, vendor: Vendor) -> Result<()> {
    if !a.flag("accept-license") {
        eprintln!(
            "{}",
            match vendor {
                Vendor::Macos => macos::LICENSE,
                Vendor::Windows => windows::LICENSE,
            }
        );
        std::process::exit(1);
    }
    let choice = choose(a, table, vendor)?;
    let root = sdk_dir(a)?;
    fs::create_dir_all(&root).context(root.display())?;
    let root = links::canonical(&root)?;
    let name = choice.name();
    let dir = root.join(&name);
    // Downloads go to --cache and stay there, or next to the SDK for now.
    let (cache, keep) = match a.value("cache") {
        Some(c) => (PathBuf::from(c), true),
        None => (root.join(format!(".{name}.downloads")), false),
    };
    if let Some((key, p)) = match &choice {
        Choice::Macos { preset, .. } | Choice::Windows { preset, .. } => preset,
    } {
        let what = match vendor {
            Vendor::Macos => format!("Xcode {}", p.xcode.as_deref().unwrap_or("?")),
            Vendor::Windows => format!(
                "Visual Studio {}",
                p.visual_studio.as_deref().unwrap_or("?")
            ),
        };
        let image = p.image_version.as_deref().unwrap_or("?");
        eprintln!(
            "preset {key} ({}; image {image}, {what})",
            p.labels.join(", ")
        );
    }
    let start = Instant::now();
    let record = match &choice {
        Choice::Macos {
            version, package, ..
        } => {
            eprintln!("macOS SDK {version}: {}", package.url);
            let file = match a.value("pkg") {
                Some(pkg) => {
                    let pkg = PathBuf::from(pkg);
                    if crate::http::sha256_file(&pkg)? != package.sha256 {
                        bail!(
                            "{}: not the package of macOS SDK {version} (sha256)",
                            pkg.display()
                        );
                    }
                    pkg
                }
                None => {
                    let file = cache.join(format!(
                        "{}-{}",
                        package.product,
                        package.url.rsplit('/').next().unwrap()
                    ));
                    crate::http::fetch_pinned(
                        &package.url,
                        &package.sha256,
                        Some(package.size),
                        &file,
                    )?;
                    file
                }
            };
            eprintln!(
                "sha256 {}, {} in {:.1} s",
                package.sha256,
                mb(package.size),
                start.elapsed().as_secs_f64()
            );
            let how = Links::parse(a.value("links"))?;
            fresh_dir(&dir)?;
            macos::unpack(&file, &dir, how)?;
            Record {
                kind: "macos".into(),
                version: Some(version.clone()),
                msvc: None,
                sdk: None,
                toolset: None,
                sdk_directory: None,
                archs: vec![],
                packages: vec![Package {
                    url: package.url.clone(),
                    size: package.size,
                    sha256: package.sha256.clone(),
                }],
            }
        }
        Choice::Windows {
            msvc, sdk, archs, ..
        } => {
            if a.value("links").is_some() || a.value("pkg").is_some() {
                bail!("--links and --pkg are for macos");
            }
            let (m, s) = (
                table.windows.msvc.get(msvc).unwrap(),
                table.windows.sdk.get(sdk).unwrap(),
            );
            eprintln!("MSVC {msvc} ({}), Windows SDK {sdk}", m.manifest);
            let mut packages = vec![(Kind::Crt, &m.headers), (Kind::Sdk, &s.headers)];
            for arch in archs {
                packages.extend(m.arch(arch).unwrap().iter().map(|(_, p)| (Kind::Crt, p)));
                packages.push((Kind::Sdk, s.arch(arch).unwrap()));
            }
            let files = crate::parallel(&packages, 4, |(kind, p)| {
                let file = cache.join(p.url.rsplit('/').next().unwrap());
                crate::http::fetch_pinned(&p.url, &p.sha256, Some(p.size), &file)?;
                Ok((*kind, file))
            })?;
            let total: u64 = packages.iter().map(|(_, p)| p.size).sum();
            eprintln!(
                "{} packages, {}, in {:.1} s",
                packages.len(),
                mb(total),
                start.elapsed().as_secs_f64()
            );
            fresh_dir(&dir)?;
            let archs_ref: Vec<&str> = archs.iter().map(String::as_str).collect();
            let unpacked = windows::unpack(&files, &dir, &archs_ref)?;
            let what = format!("MSVC {msvc} and the Windows SDK {sdk}");
            windows::write_configs(&dir, archs, &unpacked, &what)?;
            Record {
                kind: "windows".into(),
                version: None,
                msvc: Some(msvc.clone()),
                sdk: Some(sdk.clone()),
                toolset: Some(unpacked.toolset),
                sdk_directory: Some(unpacked.sdk_version),
                archs: archs.clone(),
                packages: packages.iter().map(|(_, p)| (*p).clone()).collect(),
            }
        }
    };
    fs::write(
        dir.join(RECORD),
        serde_json::to_string_pretty(&record)? + "\n",
    )
    .context(dir.display())?;
    if !keep {
        links::remove_tree(&cache).context(cache.display())?;
    }
    eprintln!("fetched {name} in {:.1} s", start.elapsed().as_secs_f64());
    use_sdk(&root, vendor.name(), &name)?;
    let d = dir.display();
    // The toolchain's config files read <toolchain>/sdk/windows, and off
    // macOS <toolchain>/sdk/macos (on macOS, Xcode's SDK).
    let own = Toolchain::find(a.value("root"))
        .ok()
        .and_then(|t| links::canonical(&t.root.join("sdk")).ok())
        .is_some_and(|s| s == root);
    match vendor {
        Vendor::Macos if own && !cfg!(target_os = "macos") => {
            eprintln!("  clang --target=arm64-apple-macos ...")
        }
        Vendor::Macos => eprintln!("  clang --target=arm64-apple-macos -isysroot \"{d}\" ..."),
        Vendor::Windows if own => eprintln!(
            "  clang --target=x86_64-pc-windows-msvc ...\n  clang-cl --target=x86_64-pc-windows-msvc ..."
        ),
        Vendor::Windows => eprintln!(
            "  clang-cl --target=x86_64-pc-windows-msvc /winsysroot \"{d}\" -fuse-ld=lld ...\n  \
             clang --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root \"{d}\" -fuse-ld=lld ..."
        ),
    }
    println!("{d}");
    Ok(())
}

/// An empty directory at dir, whatever was there.
fn fresh_dir(dir: &Path) -> Result<()> {
    links::remove_tree(dir).context(dir.display())?;
    fs::create_dir_all(dir).context(dir.display())?;
    Ok(())
}

fn list(table: &Table, vendor: Option<Vendor>, root: Option<&Path>) -> Result<()> {
    for v in [Vendor::Macos, Vendor::Windows] {
        if vendor.is_none_or(|x| x == v) {
            list_vendor(table, v)?;
        }
    }
    let Some(root) = root else { return Ok(()) };
    let active: Vec<String> = [Vendor::Macos, Vendor::Windows]
        .iter()
        .filter_map(|v| links::alias_of(root, v.name()))
        .collect();
    let mut fetched: Vec<(String, Option<Record>)> = match fs::read_dir(root) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().is_dir()
                    && !links::is_link(&e.path())
                    && !e.file_name().to_string_lossy().starts_with('.')
            })
            .map(|e| {
                (
                    e.file_name().to_string_lossy().into_owned(),
                    read_record(&e.path()),
                )
            })
            .filter(|(_, r)| vendor.is_none_or(|v| r.as_ref().is_none_or(|r| r.kind == v.name())))
            .collect(),
        Err(_) => vec![],
    };
    fetched.sort_by(|a, b| a.0.cmp(&b.0));
    println!("Fetched, in {}:", root.display());
    if fetched.is_empty() {
        println!("  none");
    }
    for (name, record) in fetched {
        let what = match record {
            None => "incomplete: fetch it again, or remove it".to_string(),
            Some(r) if r.kind == "macos" => format!("macOS SDK {}", r.version.unwrap_or_default()),
            Some(r) => format!(
                "MSVC {} ({}), Windows SDK {}, for {}",
                r.msvc.unwrap_or_default(),
                r.toolset.unwrap_or_default(),
                r.sdk.unwrap_or_default(),
                r.archs.join(", ")
            ),
        };
        let mark = if active.contains(&name) {
            " (in use)"
        } else {
            ""
        };
        println!("  {name:36} {what}{mark}");
    }
    Ok(())
}

fn list_vendor(table: &Table, vendor: Vendor) -> Result<()> {
    println!(
        "{} presets, from GitHub's runner images:",
        if vendor == Vendor::Macos {
            "macOS"
        } else {
            "Windows"
        }
    );
    let default = table.preset(vendor.default_preset(), vendor)?.0;
    for (key, p) in table.presets.iter().filter(|(_, p)| p.vendor() == vendor) {
        let what = match vendor {
            Vendor::Windows => format!(
                "MSVC {}, Windows SDK {}",
                p.msvc.as_deref().unwrap_or("?"),
                p.sdk
            ),
            Vendor::Macos => format!(
                "SDK {} (Xcode {})",
                p.sdk,
                p.xcode.as_deref().unwrap_or("?")
            ),
        };
        let mark = if key == default { " (default)" } else { "" };
        println!("  {key:26} {what:42} {}{mark}", p.labels.join(", "));
        println!(
            "  {:26} image {}, read {}",
            "",
            p.image_version.as_deref().unwrap_or("?"),
            p.read.as_deref().unwrap_or("?")
        );
    }
    let preset = table.preset(vendor.default_preset(), vendor)?.1;
    match vendor {
        Vendor::Macos => {
            let versions = table.macos_versions();
            let default = pick(versions.keys(), Some(&preset.sdk), "macOS SDK")?;
            let mut sorted: Vec<(&str, &&MacPackage)> = versions.iter().collect();
            sorted.sort_by(|a, b| table::version_cmp(a.0, b.0));
            println!("macOS SDKs:");
            for (v, p) in sorted {
                let mark = if v == default { " (default)" } else { "" };
                println!("  {v:8} {} {:>9}  {}{mark}", p.posted, mb(p.size), p.url);
            }
        }
        Vendor::Windows => {
            let w = &table.windows;
            let sdk_default = pick(w.sdk.keys(), Some(&preset.sdk), "Windows SDK")?;
            println!("Windows SDKs:");
            for (v, s) in w.sdk.iter() {
                let archs: Vec<&str> = table::MS_ARCH
                    .iter()
                    .map(|(a, _)| *a)
                    .filter(|a| s.arch(a).is_some())
                    .collect();
                let mark = if v == sdk_default { " (default)" } else { "" };
                println!("  {v:18} {:22} nuget.org{mark}", archs.join(" "));
            }
            let msvc_default = pick(w.msvc.keys(), preset.msvc.as_deref(), "MSVC")?;
            println!("MSVC:");
            for (v, m) in w.msvc.iter() {
                let archs: Vec<&str> = table::MS_ARCH
                    .iter()
                    .map(|(a, _)| *a)
                    .filter(|a| m.arch(a).is_some())
                    .collect();
                let mark = if v == msvc_default { " (default)" } else { "" };
                println!("  {v:18} {:22} {}{mark}", archs.join(" "), m.manifest);
            }
        }
    }
    Ok(())
}
