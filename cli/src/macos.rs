//! Apple's macOS SDK out of a Command Line Tools package: the SDK directory
//! of its payload, Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk.

use std::collections::HashMap;
use std::fs;
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::{Mutex, mpsc};
use std::time::Instant;

use crate::links::{self, Links};
use crate::pkg::{self, Cpio, S_IFDIR, S_IFLNK, S_IFMT, S_IFREG, Xar};
use crate::{Context, Result, bail, mb};

pub const LICENSE: &str = "\
The macOS SDK is Apple's, under the Xcode and Apple SDKs Agreement
(https://www.apple.com/legal/sla/docs/xcode.pdf), which among other things
allows its use only on Apple-branded computers. xclang does not distribute
it: this downloads it from Apple's servers for you. Pass --accept-license
to confirm that you have read and accept that agreement.";

const SDKS: &str = "Library/Developer/CommandLineTools/SDKs/";

/// What compiling and linking never read, as Nixpkgs leaves out too: man
/// pages (some named like APR::Base64.3pm, which Windows refuses), tools,
/// Perl.
const SKIP: [&str; 3] = ["usr/bin/", "usr/share/", "System/Library/Perl/"];

/// (the SDK directory's name, the path below it) of a payload member.
pub fn sdk_member(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("./").unwrap_or(name).strip_prefix(SDKS)?;
    let (sdk, path) = rest.split_once('/')?;
    (sdk.ends_with(".sdk") && sdk.len() > 4 && !path.is_empty()).then_some((sdk, path))
}

/// Unpack the SDK directory of the package into out, which exists and is
/// empty; returns its name in the package (MacOSX26.5.sdk). Files are
/// written on several threads (creating files is slow on Windows), but for
/// hard links, which wait for each other.
pub fn unpack(package: &Path, out: &Path, how: Links) -> Result<String> {
    let start = Instant::now();
    let (tx, rx) = mpsc::sync_channel::<(PathBuf, Vec<u8>, u32)>(256);
    let rx = Mutex::new(rx);
    let failed: Mutex<Option<crate::Error>> = Mutex::new(None);
    let (sdk, files, size, pending) = std::thread::scope(|s| {
        for _ in 0..crate::cpus().clamp(1, 8) {
            s.spawn(|| {
                while let Ok((path, data, mode)) = rx.lock().unwrap().recv() {
                    if let Err(e) = write_file(&path, &data, mode) {
                        failed.lock().unwrap().get_or_insert(e);
                    }
                }
            });
        }
        let read = read_payload(package, out, how, &tx);
        drop(tx);
        read
    })?;
    if let Some(e) = failed.into_inner().unwrap() {
        return Err(e);
    }
    resolve_links(out, pending, how)?;
    eprintln!(
        "{files} files, {}, unpacked in {:.1} s",
        mb(size),
        start.elapsed().as_secs_f64()
    );
    Ok(sdk)
}

fn write_file(path: &Path, data: &[u8], mode: u32) -> Result<()> {
    fs::write(path, data).context(path.display())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o755 | 0o644))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    Ok(())
}

type Read = (String, u64, u64, Vec<(PathBuf, String)>);

/// The SDK's entries of the payload: directories made, files sent to the
/// writers, hard links written here; (the SDK's name, files, bytes, the
/// links still to make).
fn read_payload(
    package: &Path,
    out: &Path,
    how: Links,
    tx: &mpsc::SyncSender<(PathBuf, Vec<u8>, u32)>,
) -> Result<Read> {
    let mut xar = Xar::open(package)?;
    let mut cpio = Cpio::new(pkg::payload(xar.member("Payload")?)?);
    let (mut sdk, mut files, mut size) = (None::<String>, 0u64, 0u64);
    let mut pending: Vec<(PathBuf, String)> = vec![];
    let mut inodes: HashMap<(u64, u64), PathBuf> = HashMap::new();
    let mut empties: HashMap<(u64, u64), Vec<PathBuf>> = HashMap::new();
    let mut others: Vec<String> = vec![];
    while let Some(e) = cpio.next_entry()? {
        let Some((dir, rel)) = sdk_member(&e.name) else {
            continue;
        };
        match &sdk {
            None => {
                eprintln!("unpacking {dir}");
                sdk = Some(dir.to_string());
            }
            Some(s) if s != dir => {
                if !others.iter().any(|o| o == dir) {
                    eprintln!("skipping {dir}");
                    others.push(dir.to_string());
                }
                continue;
            }
            Some(_) => {}
        }
        if SKIP.iter().any(|s| rel.starts_with(s)) {
            continue;
        }
        if !links::is_safe(Path::new(rel)) {
            bail!("{}: unsafe path {}", package.display(), e.name);
        }
        let path = out.join(rel);
        match e.mode & S_IFMT {
            S_IFDIR => {
                fs::create_dir_all(&path).context(path.display())?;
                continue;
            }
            S_IFLNK | S_IFREG => {}
            _ => continue,
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).context(dir.display())?;
        }
        if e.mode & S_IFMT == S_IFLNK {
            let target = String::from_utf8(cpio.read_data()?).context(&e.name)?;
            if how == Links::Symlink {
                links::symlink(&target, &path).context(path.display())?;
            } else {
                pending.push((path, target));
            }
            continue;
        }
        files += 1;
        size += e.size;
        if e.nlink <= 1 {
            let data = cpio.read_data()?;
            if tx.send((path, data, e.mode)).is_err() {
                bail!("the writers stopped");
            }
            continue;
        }
        // A hard link's data may come with one of its names only.
        if e.size == 0 && inodes.contains_key(&e.inode) {
            fs::copy(&inodes[&e.inode], &path).context(path.display())?;
        } else {
            write_file(&path, &cpio.read_data()?, e.mode)?;
            if e.size > 0 {
                for other in empties.remove(&e.inode).unwrap_or_default() {
                    fs::copy(&path, &other).context(other.display())?;
                }
                inodes.insert(e.inode, path.clone());
            } else {
                empties.entry(e.inode).or_default().push(path.clone());
            }
        }
    }
    let Some(sdk) = sdk else {
        bail!("{}: no SDK in the package", package.display())
    };
    Ok((sdk, files, size, pending))
}

/// The links not made as symlinks: a junction to a directory and a hard
/// link to a file, or a copy, made once no link under its target is still
/// to be made, so that it is whole. Links to links resolve over several
/// rounds.
fn resolve_links(out: &Path, pending: Vec<(PathBuf, String)>, how: Links) -> Result<()> {
    let out = links::canonical(out)?;
    let mut pending: Vec<(PathBuf, PathBuf)> = pending
        .into_iter()
        .filter_map(|(path, target)| {
            let src = links::normalize(&path.parent()?.join(&target));
            if Path::new(&target).is_absolute() || !src.starts_with(&out) {
                eprintln!(
                    "{}: a link out of the SDK ({target}), left out",
                    path.display()
                );
                return None;
            }
            Some((links::normalize(&path), src))
        })
        .collect();
    let under = |dir: &Path| format!("{}{MAIN_SEPARATOR}", dir.display());
    while !pending.is_empty() {
        let mut paths: Vec<String> = pending
            .iter()
            .map(|(p, _)| p.display().to_string())
            .collect();
        paths.sort();
        let mut left = vec![];
        for (path, src) in std::mem::take(&mut pending) {
            if how == Links::Copy {
                if under(&path).starts_with(&under(&src)) {
                    continue; // a link to a directory above it (ruby/ruby -> .)
                }
                let prefix = under(&src);
                let i = paths.partition_point(|p| *p < prefix);
                if paths.get(i).is_some_and(|p| p.starts_with(&prefix)) {
                    left.push((path, src));
                } else if src.is_dir() {
                    copy_tree(&src, &path)?;
                } else if src.is_file() {
                    fs::copy(&src, &path).context(path.display())?;
                } else {
                    left.push((path, src));
                }
            } else if src.is_dir() {
                links::junction(&src, &path).context(path.display())?;
            } else if src.is_file() {
                fs::hard_link(&src, &path).context(path.display())?;
            } else {
                left.push((path, src));
            }
        }
        if !left.is_empty() && left.len() == paths.len() {
            let some: Vec<String> = left
                .iter()
                .take(3)
                .map(|(p, _)| p.display().to_string())
                .collect();
            eprintln!(
                "{} links point nowhere, left out: {}",
                left.len(),
                some.join(", ")
            );
            break;
        }
        pending = left;
    }
    Ok(())
}

fn copy_tree(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).context(dest.display())?;
    for entry in fs::read_dir(src).context(src.display())? {
        let entry = entry?;
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to).context(to.display())?;
        }
    }
    Ok(())
}

/// The version of the SDK a package carries (26.5), from the SDKSettings
/// near the start of its payload; older packages name the SDK's directory
/// MacOSX.sdk.
#[cfg(feature = "maintainer")]
pub fn sdk_version(package: &Path) -> Result<String> {
    let mut xar = Xar::open(package)?;
    let mut cpio = Cpio::new(pkg::payload(xar.member("Payload")?)?);
    while let Some(e) = cpio.next_entry()? {
        let Some((_, rel)) = sdk_member(&e.name) else {
            continue;
        };
        if e.mode & S_IFMT != S_IFREG {
            continue;
        }
        if rel == "SDKSettings.json" {
            let settings: serde_json::Value = serde_json::from_slice(&cpio.read_data()?)?;
            if let Some(v) = settings["Version"].as_str() {
                return Ok(v.to_string());
            }
        } else if rel == "SDKSettings.plist" {
            let text = String::from_utf8(cpio.read_data()?).context("SDKSettings.plist")?;
            if let Some(v) = crate::update::plist_string(&text, "Version")? {
                return Ok(v);
            }
        }
    }
    bail!("{}: no SDK in the package", package.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members() {
        let m = "Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk/usr/include/stdio.h";
        assert_eq!(
            sdk_member(m),
            Some(("MacOSX26.5.sdk", "usr/include/stdio.h"))
        );
        assert_eq!(
            sdk_member(&format!("./{m}")),
            Some(("MacOSX26.5.sdk", "usr/include/stdio.h"))
        );
        assert_eq!(
            sdk_member("Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"),
            None
        );
        assert_eq!(
            sdk_member("Library/Developer/CommandLineTools/usr/bin/clang"),
            None
        );
    }
}
