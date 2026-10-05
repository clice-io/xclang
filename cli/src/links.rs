//! Links and paths. Windows needs a privilege (or developer mode) for
//! symlinks; a junction (to a directory) or a hard link (to a file) needs
//! none.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// How a package's symlinks are made.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Links {
    Symlink,
    /// A junction for a link to a directory, a hard link for one to a file.
    Junction,
    Copy,
}

impl Links {
    pub fn parse(s: Option<&str>) -> crate::Result<Links> {
        Ok(match s {
            None if cfg!(windows) => Links::Junction,
            None | Some("symlink") if cfg!(unix) => Links::Symlink,
            Some("junction") if cfg!(windows) => Links::Junction,
            Some("copy") => Links::Copy,
            Some(other) => crate::bail!(
                "--links {other}: symlink (not on Windows), junction (Windows only) or copy"
            ),
            None => Links::Copy,
        })
    }
}

#[cfg(unix)]
pub fn symlink(target: impl AsRef<Path>, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
pub fn symlink(_target: impl AsRef<Path>, _link: &Path) -> io::Result<()> {
    Err(io::Error::other("no symlinks here"))
}

/// A junction at `link` to the directory `target` (an absolute path).
#[cfg(windows)]
pub fn junction(target: &Path, link: &Path) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00a4;
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xa000_0003;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn DeviceIoControl(
            device: *mut std::ffi::c_void,
            code: u32,
            input: *const u8,
            input_len: u32,
            output: *mut u8,
            output_len: u32,
            returned: *mut u32,
            overlapped: *mut std::ffi::c_void,
        ) -> i32;
    }

    let target = plain(target);
    let utf16 = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    // The NT path (\??\C:\dir) to substitute, and the one to print.
    let substitute = utf16(&format!("\\??\\{}", target.display()));
    let print = utf16(&target.display().to_string());
    let mut paths = vec![];
    for name in [&substitute, &print] {
        paths.extend(name.iter().flat_map(|c| c.to_le_bytes()));
        paths.extend([0, 0]);
    }
    let mut buf = vec![];
    buf.extend(IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    buf.extend(((8 + paths.len()) as u16).to_le_bytes());
    buf.extend(0u16.to_le_bytes());
    for v in [
        0,
        substitute.len() * 2,
        substitute.len() * 2 + 2,
        print.len() * 2,
    ] {
        buf.extend((v as u16).to_le_bytes());
    }
    buf.extend(paths);

    fs::create_dir(link)?;
    let result = (|| {
        let dir = fs::OpenOptions::new()
            .access_mode(GENERIC_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(link)?;
        let mut returned = 0;
        // SAFETY: a valid handle and a buffer of the length given.
        let ok = unsafe {
            DeviceIoControl(
                dir.as_raw_handle(),
                FSCTL_SET_REPARSE_POINT,
                buf.as_ptr(),
                buf.len() as u32,
                std::ptr::null_mut(),
                0,
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    })();
    if result.is_err() {
        let _ = fs::remove_dir(link);
    }
    result
}

#[cfg(not(windows))]
pub fn junction(_target: &Path, _link: &Path) -> io::Result<()> {
    Err(io::Error::other("junctions are Windows'"))
}

/// The path without Windows' verbatim prefix (\\?\C:\dir is C:\dir).
pub fn plain(path: &Path) -> PathBuf {
    match path.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// The absolute, canonical path, without a verbatim prefix.
pub fn canonical(path: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(path).map(|p| plain(&p))
}

/// a/./b/../c is a/c, without looking at the file system.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// A relative path with only plain names, safe to join to a directory.
pub fn is_safe(path: &Path) -> bool {
    path.components().all(|c| matches!(c, Component::Normal(_)))
        && path.components().next().is_some()
}

/// Whether the file system of dir finds a name whatever its case.
pub fn case_insensitive(dir: &Path) -> io::Result<bool> {
    let probe = dir.join("CaseProbe");
    fs::write(&probe, b"")?;
    let insensitive = dir.join("caseprobe").exists();
    fs::remove_file(&probe)?;
    Ok(insensitive)
}

/// Remove dir and what is below it, if it exists (links, not what they
/// point to).
pub fn remove_tree(dir: &Path) -> io::Result<()> {
    match fs::symlink_metadata(dir) {
        Ok(_) => fs::remove_dir_all(dir),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(normalize(Path::new("a/./b/../c")), PathBuf::from("a/c"));
        assert_eq!(normalize(Path::new("a/../../c")), PathBuf::from("../c"));
        assert!(is_safe(Path::new("a/b.txt")));
        assert!(!is_safe(Path::new("a/../b")));
        assert!(!is_safe(Path::new("/a")));
        assert!(!is_safe(Path::new("")));
    }
}
