//! The MSVC runtime and STL (Visual Studio's .vsix packages) and the
//! Windows SDK (its NuGet packages) as a /winsysroot, laid out as Visual
//! Studio installs them: VC/Tools/MSVC/<toolset>/{include,lib/<arch>},
//! Windows Kits/10/{Include,Lib}/<version>/...

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use crate::table::ms_arch;
use crate::zip::Zip;
use crate::{Context, Result, bail, links, mb};

pub const LICENSE: &str = "\
The MSVC C/C++ runtime and standard library are Microsoft's, under the
Visual Studio Build Tools license
(https://go.microsoft.com/fwlink/?LinkId=2179911), and the Windows SDK under
its own (https://aka.ms/WinSDKLicenseURL). xclang does not distribute them:
this downloads them from Microsoft's servers for you. Pass --accept-license
to confirm that you have read and accept both.";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// An MSVC package (.vsix).
    Crt,
    /// A Windows SDK package (.nupkg).
    Sdk,
}

/// Where a member of a package goes in the /winsysroot, or nowhere.
pub fn member(kind: Kind, name: &str, version: &str) -> Option<String> {
    match kind {
        // Headers, and an architecture's own libraries and link-option
        // objects (setargv.obj, ...), not those for Store apps, UWP or
        // enclaves; no debug symbols.
        Kind::Crt => {
            let rest = name.strip_prefix("Contents/")?;
            let (toolset, tail) = rest.strip_prefix("VC/Tools/MSVC/")?.split_once('/')?;
            if toolset.is_empty() {
                return None;
            }
            if tail.strip_prefix("include/").is_some_and(|f| !f.is_empty()) {
                return Some(rest.to_string());
            }
            let (arch, file) = tail.strip_prefix("lib/")?.split_once('/')?;
            let library = [".lib", ".obj"]
                .iter()
                .any(|ext| file.len() > 4 && file.ends_with(ext));
            (matches!(arch, "x64" | "arm64" | "x86") && !file.contains('/') && library)
                .then(|| rest.to_string())
        }
        Kind::Sdk => {
            let rest = name.strip_prefix("c/")?;
            if let Some(include) = rest.strip_prefix("Include/") {
                let (v, tail) = include.split_once('/')?;
                let (dir, file) = tail.split_once('/')?;
                let known = matches!(dir, "um" | "shared" | "ucrt" | "winrt" | "cppwinrt");
                return (!v.is_empty() && known && !file.is_empty())
                    .then(|| format!("Windows Kits/10/Include/{version}/{tail}"));
            }
            let parts: Vec<&str> = rest.split('/').collect();
            match parts[..] {
                [
                    dir @ ("um" | "ucrt"),
                    arch @ ("x64" | "arm64" | "x86"),
                    file,
                ] if !file.is_empty() => {
                    Some(format!("Windows Kits/10/Lib/{version}/{dir}/{arch}/{file}"))
                }
                _ => None,
            }
        }
    }
}

pub struct Unpacked {
    /// The SDK's own version, which names its directories (10.0.26100.0).
    pub sdk_version: String,
    /// The toolset's directory (14.44.35207).
    pub toolset: String,
}

/// Unpack the packages into out, which exists and is empty, then make the
/// links a case-sensitive file system needs. `packages[1]` is the Windows
/// SDK's headers.
pub fn unpack(packages: &[(Kind, PathBuf)], out: &Path, archs: &[&str]) -> Result<Unpacked> {
    let start = Instant::now();
    let headers = Zip::open(&packages[1].1)?;
    let Some(version) = headers.members.iter().find_map(|m| {
        let rest = m.raw_name.strip_prefix("c/Include/")?;
        let (v, tail) = rest.split_once('/')?;
        tail.starts_with("um/").then(|| v.to_string())
    }) else {
        bail!("{}: no c/Include/<version>/um", packages[1].1.display())
    };
    // What each package gives, and names alike but for case.
    let mut plans = vec![];
    let mut seen: HashMap<String, String> = HashMap::new();
    for (kind, path) in packages {
        let zip = Zip::open(path)?;
        let mut plan = vec![];
        for (i, m) in zip.members.iter().enumerate() {
            if m.is_dir() {
                continue;
            }
            let Some(rel) = member(*kind, &m.name(), &version) else {
                continue;
            };
            if !links::is_safe(Path::new(&rel)) {
                bail!("{}: unsafe path {}", path.display(), m.raw_name);
            }
            let first = seen
                .entry(rel.to_lowercase())
                .or_insert_with(|| rel.clone());
            if *first != rel {
                eprintln!("{rel} and {first} differ only in case");
            }
            plan.push((i, rel));
        }
        plans.push((path.clone(), plan));
    }
    let counted = Mutex::new((0u64, 0u64));
    crate::parallel(&plans, crate::cpus(), |(path, plan)| {
        let mut zip = Zip::open(path)?;
        let mut dirs = HashSet::new();
        for (i, rel) in plan {
            let dest = out.join(rel);
            let dir = dest.parent().unwrap();
            if dirs.insert(dir.to_path_buf()) {
                fs::create_dir_all(dir).context(dir.display())?;
            }
            let size = zip.members[*i].size;
            let mut file = BufWriter::new(File::create(&dest).context(dest.display())?);
            io::copy(&mut zip.read(*i)?, &mut file)
                .context(format!("{}: {rel}", path.display()))?;
            let mut c = counted.lock().unwrap();
            c.0 += 1;
            c.1 += size;
        }
        Ok(())
    })?;
    let (files, size) = counted.into_inner().unwrap();
    eprintln!(
        "{files} files, {}, unpacked in {:.1} s",
        mb(size),
        start.elapsed().as_secs_f64()
    );

    let tools = out.join("VC/Tools/MSVC");
    let toolset = match fs::read_dir(&tools).context(tools.display())?.next() {
        Some(entry) => entry?.file_name().to_string_lossy().into_owned(),
        None => bail!("no toolset in {}", tools.display()),
    };
    if links::case_insensitive(out)? {
        eprintln!("case-insensitive file system: no links needed");
    } else if cfg!(unix) {
        let start = Instant::now();
        let tools = tools.join(&toolset);
        let kits = out.join("Windows Kits/10");
        let mut includes = vec![tools.join("include")];
        includes.extend(
            ["ucrt", "um", "shared", "winrt", "cppwinrt"]
                .iter()
                .map(|d| kits.join("Include").join(&version).join(d)),
        );
        let mut libs: Vec<PathBuf> = archs
            .iter()
            .map(|a| tools.join("lib").join(ms_arch(a).unwrap()))
            .collect();
        for a in archs {
            for d in ["um", "ucrt"] {
                libs.push(
                    kits.join("Lib")
                        .join(&version)
                        .join(d)
                        .join(ms_arch(a).unwrap()),
                );
            }
        }
        includes.retain(|d| d.is_dir());
        libs.retain(|d| d.is_dir());
        let made = fix_case(&includes, &libs)?;
        eprintln!(
            "case-sensitive file system: {made} links in {:.1} s",
            start.elapsed().as_secs_f64()
        );
    } else {
        eprintln!("case-sensitive file system: no links made, as there are no symlinks here");
    }
    Ok(Unpacked {
        sdk_version: version,
        toolset,
    })
}

/// Spellings in use that no header writes, Microsoft's documentation's
/// (xwin links them too).
const KNOWN_HEADERS: [&str; 2] = ["BaseTsd.h", "Mstcpip.h"];
const KNOWN_LIBS: [&str; 2] = ["Kernel32.lib", "Iphlpapi.lib"];

struct Dir {
    exact: HashSet<String>,
    /// Lower case -> the name, the first in sorted order.
    lower: HashMap<String, String>,
}

/// Links for the names Windows finds whatever their case: every file's in
/// lower case, every library's in upper case too (LIBCMT.lib, as objects
/// MSVC built ask for), the paths of each #include and #pragma comment(lib)
/// of the headers as they are written (<Windows.h> includes <winbase.h>,
/// which is WinBase.h), and a few known spellings. Returns how many links
/// were made.
pub fn fix_case(includes: &[PathBuf], libs: &[PathBuf]) -> Result<usize> {
    struct State {
        dirs: HashMap<PathBuf, Dir>,
        made: usize,
    }
    impl State {
        fn dir(&mut self, d: &Path) -> &mut Dir {
            self.dirs.entry(d.to_path_buf()).or_insert_with(|| {
                let mut names: Vec<String> = fs::read_dir(d)
                    .map(|r| {
                        r.filter_map(|e| Some(e.ok()?.file_name().to_string_lossy().into_owned()))
                            .collect()
                    })
                    .unwrap_or_default();
                names.sort();
                let mut lower = HashMap::new();
                for n in &names {
                    lower.entry(n.to_lowercase()).or_insert_with(|| n.clone());
                }
                Dir {
                    exact: names.into_iter().collect(),
                    lower,
                }
            })
        }

        fn link(&mut self, d: &Path, want: &str, have: &str) -> Result<()> {
            if self.dir(d).exact.insert(want.to_string()) {
                links::symlink(have, &d.join(want)).context(d.join(want).display())?;
                self.made += 1;
            }
            Ok(())
        }

        /// Follow parts from base whatever their case; if every part is
        /// found, link the spellings that differ.
        fn resolve(&mut self, base: &Path, parts: &[&str]) -> Result<bool> {
            let mut d = base.to_path_buf();
            let mut plan = vec![];
            for &part in parts {
                match part {
                    "" | "." => continue,
                    ".." => {
                        d.pop();
                        continue;
                    }
                    _ => {}
                }
                let dir = self.dir(&d);
                let name = if dir.exact.contains(part) {
                    part.to_string()
                } else {
                    match dir.lower.get(&part.to_lowercase()) {
                        Some(have) => {
                            plan.push((d.clone(), part.to_string(), have.clone()));
                            have.clone()
                        }
                        None => return Ok(false),
                    }
                };
                d.push(name);
            }
            for (d, want, have) in plan {
                self.link(&d, &want, &have)?;
            }
            Ok(true)
        }
    }

    let mut s = State {
        dirs: HashMap::new(),
        made: 0,
    };
    let mut headers = vec![];
    for root in includes {
        walk(root, &mut headers)?;
    }
    let mut files = headers.clone();
    for d in libs {
        let names: BTreeSet<PathBuf> = fs::read_dir(d)?
            .filter_map(|e| Some(e.ok()?.path()))
            .collect();
        files.extend(names);
    }
    for path in &files {
        let (Some(d), Some(n)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) else {
            continue;
        };
        s.link(d, &n.to_lowercase(), n)?;
        if let Some(stem) = n
            .len()
            .checked_sub(4)
            .filter(|&k| n.is_char_boundary(k))
            .map(|k| &n[..k])
            && n[stem.len()..].eq_ignore_ascii_case(".lib")
        {
            s.link(d, &format!("{}.lib", stem.to_uppercase()), n)?;
        }
    }
    for name in KNOWN_HEADERS {
        for d in includes {
            if s.resolve(d, &[name])? {
                break;
            }
        }
    }
    for name in KNOWN_LIBS {
        for d in libs {
            if s.resolve(d, &[name])? {
                break;
            }
        }
    }
    for h in &headers {
        let text = fs::read(h).context(h.display())?;
        for include in includes_of(&text) {
            let include = include.trim().replace('\\', "/");
            let parts: Vec<&str> = include.split('/').collect();
            let here = h.parent().unwrap().to_path_buf();
            for base in std::iter::once(&here).chain(includes) {
                if s.resolve(base, &parts)? {
                    break;
                }
            }
        }
        for lib in pragma_libs(&text) {
            let lib = if lib.to_lowercase().ends_with(".lib") {
                lib
            } else {
                format!("{lib}.lib")
            };
            for d in libs {
                if s.resolve(d, &[&lib])? {
                    break;
                }
            }
        }
    }
    Ok(s.made)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .context(dir.display())?
        .collect::<Result<_, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if e.file_type()?.is_dir() {
            walk(&e.path(), out)?;
        } else {
            out.push(e.path());
        }
    }
    Ok(())
}

fn skip_blanks(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && (s[i] == b' ' || s[i] == b'\t') {
        i += 1;
    }
    i
}

/// The paths of `^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\r\n]+)[>"]`.
pub fn includes_of(text: &[u8]) -> Vec<String> {
    let mut out = vec![];
    for line in text.split(|&c| c == b'\n') {
        let mut i = skip_blanks(line, 0);
        if line.get(i) != Some(&b'#') {
            continue;
        }
        i = skip_blanks(line, i + 1);
        if !line[i..].starts_with(b"include") {
            continue;
        }
        i = skip_blanks(line, i + 7);
        if !matches!(line.get(i), Some(b'<' | b'"')) {
            continue;
        }
        let rest = &line[i + 1..];
        let end = rest
            .iter()
            .position(|&c| matches!(c, b'>' | b'"' | b'\r'))
            .unwrap_or(rest.len());
        if end > 0 && matches!(rest.get(end), Some(b'>' | b'"')) {
            out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        }
    }
    out
}

/// The libraries of `#[ \t]*pragma[ \t]+comment[ \t]*\([ \t]*lib[ \t]*,[ \t]*"([^"]+)"`,
/// in any case.
pub fn pragma_libs(text: &[u8]) -> Vec<String> {
    let word = |s: &[u8], i: usize, w: &str| {
        s.len() >= i + w.len() && s[i..i + w.len()].eq_ignore_ascii_case(w.as_bytes())
    };
    let mut out = vec![];
    for (hash, _) in text.iter().enumerate().filter(|(_, c)| **c == b'#') {
        let mut i = skip_blanks(text, hash + 1);
        if !word(text, i, "pragma") {
            continue;
        }
        let j = skip_blanks(text, i + 6);
        if j == i + 6 || !word(text, j, "comment") {
            continue;
        }
        i = skip_blanks(text, j + 7);
        if text.get(i) != Some(&b'(') {
            continue;
        }
        i = skip_blanks(text, i + 1);
        if !word(text, i, "lib") {
            continue;
        }
        i = skip_blanks(text, i + 3);
        if text.get(i) != Some(&b',') {
            continue;
        }
        i = skip_blanks(text, i + 1);
        if text.get(i) != Some(&b'"') {
            continue;
        }
        let rest = &text[i + 1..];
        if let Some(end) = rest.iter().position(|&c| c == b'"').filter(|&e| e > 0) {
            out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members() {
        let v = "10.0.26100.0";
        let crt = |n| member(Kind::Crt, n, v);
        let sdk = |n| member(Kind::Sdk, n, v);
        assert_eq!(
            crt("Contents/VC/Tools/MSVC/14.44.35207/include/vector").as_deref(),
            Some("VC/Tools/MSVC/14.44.35207/include/vector")
        );
        assert_eq!(
            crt("Contents/VC/Tools/MSVC/14.44.35207/lib/x64/libcmt.lib").as_deref(),
            Some("VC/Tools/MSVC/14.44.35207/lib/x64/libcmt.lib")
        );
        assert_eq!(
            crt("Contents/VC/Tools/MSVC/14.44.35207/lib/x64/store/msvcrt.lib"),
            None
        );
        assert_eq!(
            crt("Contents/VC/Tools/MSVC/14.44.35207/lib/x64/libcmt.pdb"),
            None
        );
        assert_eq!(
            sdk("c/Include/10.0.26100.0/um/Windows.h").as_deref(),
            Some("Windows Kits/10/Include/10.0.26100.0/um/Windows.h")
        );
        assert_eq!(sdk("c/Include/10.0.26100.0/km/wdm.h"), None);
        assert_eq!(
            sdk("c/um/arm64/kernel32.Lib").as_deref(),
            Some("Windows Kits/10/Lib/10.0.26100.0/um/arm64/kernel32.Lib")
        );
        assert_eq!(sdk("c/bin/x64/rc.exe"), None);
    }

    #[test]
    fn scans() {
        let text = b"#include <windows.h>\n  #  include \"sub\\\\x.h\"\n#include_next <no>\n#pragma once\n\
                     #pragma comment(lib, \"kernel32\")\n#PRAGMA Comment ( LIB , \"User32.lib\" )\n#pragmacomment(lib,\"x\")\n";
        assert_eq!(
            includes_of(text),
            ["windows.h", "sub\\\\x.h"].map(String::from)
        );
        assert_eq!(
            pragma_libs(text),
            ["kernel32", "User32.lib"].map(String::from)
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_case() {
        let dir = std::env::temp_dir().join(format!("xclang-case-{}", std::process::id()));
        let inc = dir.join("include");
        let lib = dir.join("lib");
        fs::create_dir_all(&inc).unwrap();
        fs::create_dir_all(&lib).unwrap();
        fs::write(
            inc.join("Windows.h"),
            "#include <winbase.h>\n#pragma comment(lib, \"Kernel32\")\n",
        )
        .unwrap();
        fs::write(inc.join("WinBase.h"), "").unwrap();
        fs::write(lib.join("kernel32.Lib"), "").unwrap();
        fix_case(std::slice::from_ref(&inc), std::slice::from_ref(&lib)).unwrap();
        for p in [
            inc.join("windows.h"),
            inc.join("winbase.h"),
            lib.join("KERNEL32.lib"),
            lib.join("Kernel32.lib"),
        ] {
            assert!(p.exists(), "{}", p.display());
        }
        fs::remove_dir_all(&dir).unwrap();
    }
}
