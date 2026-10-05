//! `xclang target`: targets beyond the six every toolchain carries, each an
//! archive of its own listed in the release's index (as rustup's channel
//! manifests list components), unpacked into the toolchain.
//!
//! The index, xclang-targets-<version>.json, a release asset:
//!
//!   { "schema": 1, "version": "23.1.2.7",
//!     "targets": { "x86_64-unknown-linux-musl": {
//!       "description": "Linux x64, musl 1.2.5", "tier": 1, "sdk": null,
//!       "archive": "xclang-target-23.1.2.7-x86_64-unknown-linux-musl.tar.xz",
//!       "sha256": "...", "size": 12345678, "unpacked": 98765432 } } }
//!
//! `archive` is a URL, or a name next to the index. An archive is a
//! .tar.xz of files below xclang/, as the toolchain archive's are, without
//! links: the target's directory, its compiler-rt in lib/clang/<major>/lib,
//! its config files in bin/. What a target added is recorded in
//! <toolchain>/lib/xclang/targets/<target>.json, which `remove` reads.

use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::args::Args;
use crate::table::VecMap;
use crate::toolchain::Toolchain;
use crate::{Context, Result, bail, http, links, mb};

/// The targets every toolchain carries.
pub const BUILT_IN: [(&str, &str); 6] = [
    ("x86_64-unknown-linux-gnu", "Linux x64, glibc 2.17"),
    ("aarch64-unknown-linux-gnu", "Linux arm64, glibc 2.17"),
    ("x86_64-w64-mingw32", "Windows x64, MinGW-w64 (UCRT)"),
    ("aarch64-w64-mingw32", "Windows arm64, MinGW-w64 (UCRT)"),
    (
        "aarch64-apple-darwin",
        "macOS arm64, Xcode's SDK or xclang sdk fetch macos",
    ),
    (
        "x86_64-apple-darwin",
        "macOS x64, Xcode's SDK or xclang sdk fetch macos",
    ),
];

pub const SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize, Debug)]
pub struct Index {
    pub schema: u32,
    /// The release whose toolchains the targets fit.
    pub version: String,
    pub targets: VecMap<Entry>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Entry {
    pub description: String,
    pub tier: u8,
    /// The vendor SDK it needs: macos, windows, or none.
    #[serde(default)]
    pub sdk: Option<String>,
    pub archive: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unpacked: Option<u64>,
}

/// What `target add` put into the toolchain.
#[derive(Serialize, Deserialize, Debug)]
struct Installed {
    target: String,
    version: String,
    archive: String,
    sha256: String,
    /// Paths below the toolchain, with /.
    files: Vec<String>,
}

pub fn main(a: &mut Args) -> Result<()> {
    let words: Vec<String> = a.words[1..].to_vec();
    let toolchain = || Toolchain::find(a.value("root"));
    match words.first().map(String::as_str) {
        Some("list") if words.len() == 1 => {
            a.allow(&["index"])?;
            list(&toolchain()?, a.value("index"))
        }
        Some("add") if words.len() > 1 => {
            a.allow(&["index", "force"])?;
            let t = toolchain()?;
            let (location, index) = load_index(&t, a.value("index"))?;
            for target in &words[1..] {
                add(&t, &location, &index, target, a.flag("force"))?;
            }
            Ok(())
        }
        Some("remove") if words.len() > 1 => {
            a.allow(&[])?;
            let t = toolchain()?;
            words[1..].iter().try_for_each(|target| remove(&t, target))
        }
        _ => bail!(
            "unknown command target {}; see xclang --help",
            words.join(" ")
        ),
    }
}

/// What xclang keeps in the toolchain: lib/xclang.
fn state(t: &Toolchain) -> PathBuf {
    t.root.join("lib").join("xclang")
}

fn records(t: &Toolchain) -> PathBuf {
    state(t).join("targets")
}

/// Remove lib/xclang's directories that are empty.
fn prune(t: &Toolchain) {
    for dir in [state(t).join("downloads"), records(t), state(t)] {
        let _ = fs::remove_dir(dir);
    }
}

fn installed(t: &Toolchain, target: &str) -> Option<Installed> {
    serde_json::from_slice(&fs::read(records(t).join(format!("{target}.json"))).ok()?).ok()
}

/// --index, $XCLANG_TARGET_INDEX, or the index of the toolchain's release.
fn load_index(t: &Toolchain, given: Option<&str>) -> Result<(String, Index)> {
    let location = match given
        .map(String::from)
        .or_else(|| std::env::var("XCLANG_TARGET_INDEX").ok())
    {
        Some(l) => l,
        None => match t.release() {
            Some(v) => format!(
                "https://github.com/clice-io/xclang/releases/download/{v}/xclang-targets-{v}.json"
            ),
            None => bail!("the toolchain's release is unknown: name the target index with --index"),
        },
    };
    let index: Index = serde_json::from_slice(&http::get(&location)?).context(&location)?;
    if index.schema > SCHEMA {
        bail!(
            "{location}: index schema {}, newer than this program reads ({SCHEMA})",
            index.schema
        );
    }
    if let Some(v) = t.release().filter(|v| *v != index.version) {
        bail!(
            "{location} lists the targets of xclang {}, not of this toolchain's release {v}",
            index.version
        );
    }
    Ok((location, index))
}

fn list(t: &Toolchain, given: Option<&str>) -> Result<()> {
    println!("Built in:");
    for (target, what) in BUILT_IN {
        let here = if t.root.join(target).is_dir() {
            ""
        } else {
            " (missing!)"
        };
        println!("  {target:32} tier 1  {what}{here}");
    }
    let mut added: Vec<String> = fs::read_dir(records(t))
        .map(|r| {
            r.filter_map(|e| {
                e.ok()?
                    .file_name()
                    .to_str()?
                    .strip_suffix(".json")
                    .map(String::from)
            })
            .collect()
        })
        .unwrap_or_default();
    added.sort();
    match load_index(t, given) {
        Ok((location, index)) => {
            println!("From the index of xclang {} ({location}):", index.version);
            for (target, e) in index.targets.iter() {
                let state = match installed(t, target) {
                    Some(i) if i.sha256 == e.sha256 => "added",
                    Some(_) => "added, another build",
                    None => "",
                };
                let sdk = e
                    .sdk
                    .as_ref()
                    .map(|s| format!(", needs the {s} SDK"))
                    .unwrap_or_default();
                println!(
                    "  {target:32} tier {}  {:>9}  {state:12} {}{sdk}",
                    e.tier,
                    mb(e.size),
                    e.description
                );
            }
            added.retain(|a| !index.targets.contains(a));
        }
        Err(e) => eprintln!("no index: {e}"),
    }
    if !added.is_empty() {
        println!("Added, not in the index:");
        for target in added {
            println!("  {target}");
        }
    }
    Ok(())
}

fn add(t: &Toolchain, location: &str, index: &Index, target: &str, force: bool) -> Result<()> {
    if BUILT_IN.iter().any(|(b, _)| *b == target) {
        eprintln!("{target} is built into every toolchain");
        return Ok(());
    }
    let Some(e) = index.targets.get(target) else {
        let known: Vec<&str> = index.targets.keys().collect();
        bail!(
            "no target {target} in {location}; it has: {}",
            known.join(" ")
        )
    };
    let previous = installed(t, target);
    if previous.as_ref().is_some_and(|p| p.sha256 == e.sha256) {
        eprintln!("{target} is added already");
        return Ok(());
    }
    let url = http::resolve(location, &e.archive);
    let file = state(t)
        .join("downloads")
        .join(url.rsplit(['/', '\\']).next().unwrap());
    let result = (|| {
        http::fetch_pinned(&url, &e.sha256, Some(e.size), &file)?;
        if let Some(p) = &previous {
            remove_files(t, &p.files)?;
            fs::remove_file(records(t).join(format!("{target}.json")))?;
        }
        unpack(t, &file, force).context(file.display())
    })();
    let _ = fs::remove_file(&file);
    prune(t);
    let files = result?;
    let record = Installed {
        target: target.to_string(),
        version: index.version.clone(),
        archive: url,
        sha256: e.sha256.clone(),
        files,
    };
    fs::create_dir_all(records(t))?;
    let path = records(t).join(format!("{target}.json"));
    fs::write(&path, serde_json::to_string_pretty(&record)? + "\n").context(path.display())?;
    eprintln!("added {target} ({} files)", record.files.len());
    if let Some(sdk) = &e.sdk {
        eprintln!("{target} needs the {sdk} SDK: xclang sdk fetch {sdk} --accept-license");
    }
    Ok(())
}

/// Unpack the archive into the toolchain; the files it wrote. On a failure
/// what it wrote is removed again.
fn unpack(t: &Toolchain, file: &Path, force: bool) -> Result<Vec<String>> {
    let mut archive = tar::Archive::new(liblzma::read::XzDecoder::new(BufReader::new(File::open(
        file,
    )?)));
    let mut files = vec![];
    let result = (|| -> Result<()> {
        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            let Ok(rel) = path.strip_prefix("xclang") else {
                bail!("{} is not below xclang/", path.display())
            };
            if rel.as_os_str().is_empty() {
                continue;
            }
            if !links::is_safe(rel) {
                bail!("unsafe path {}", path.display());
            }
            let dest = t.root.join(rel);
            match entry.header().entry_type() {
                tar::EntryType::Directory => fs::create_dir_all(&dest).context(dest.display())?,
                tar::EntryType::Regular | tar::EntryType::Continuous => {
                    if !force && fs::symlink_metadata(&dest).is_ok() {
                        bail!(
                            "{} exists, and is not the target's (--force overwrites it)",
                            dest.display()
                        );
                    }
                    if let Some(dir) = dest.parent() {
                        fs::create_dir_all(dir).context(dir.display())?;
                    }
                    entry.unpack(&dest).context(dest.display())?;
                    files.push(rel.to_string_lossy().replace('\\', "/"));
                }
                other => bail!(
                    "{}: a target archive holds no links ({other:?})",
                    path.display()
                ),
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        remove_files(t, &files)?;
        return Err(e);
    }
    Ok(files)
}

fn remove(t: &Toolchain, target: &str) -> Result<()> {
    if BUILT_IN.iter().any(|(b, _)| *b == target) {
        bail!("{target} is built into the toolchain, not added");
    }
    let Some(i) = installed(t, target) else {
        bail!("{target} is not added")
    };
    remove_files(t, &i.files)?;
    let path = records(t).join(format!("{target}.json"));
    fs::remove_file(&path).context(path.display())?;
    prune(t);
    eprintln!("removed {target} ({} files)", i.files.len());
    Ok(())
}

/// Remove the files, then the directories they leave empty.
fn remove_files(t: &Toolchain, files: &[String]) -> Result<()> {
    let mut dirs = vec![];
    for f in files {
        if !links::is_safe(Path::new(f)) {
            bail!("unsafe path {f} in the record");
        }
        let path = t.root.join(f);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => bail!("{}: {e}", path.display()),
        }
        let mut dir = path.parent();
        while let Some(d) = dir.filter(|d| *d != t.root) {
            dirs.push(d.to_path_buf());
            dir = d.parent();
        }
    }
    // Deepest first; a directory that is not empty stays.
    dirs.sort_by(|a, b| {
        b.components()
            .count()
            .cmp(&a.components().count())
            .then(a.cmp(b))
    });
    dirs.dedup();
    for d in dirs {
        let _ = fs::remove_dir(d);
    }
    Ok(())
}
