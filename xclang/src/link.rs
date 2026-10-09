//! The linker of `xclang cargo`: this program as <Rust target>-linker,
//! which rustc runs with the options of a linker of the target's flavor.
//! It runs the toolchain's clang with the target's --target, or for the
//! MSVC targets its lld-link with the Windows SDK in use, after changing
//! what rustc gives them for a C runtime and an unwinder of its own:
//!
//!   Linux     -lgcc_s, the shared unwinder rustc names, is libunwind.a:
//!             xclang's libgcc_s.a is an empty stub; -B<rustc's gcc-ld>, which
//!             makes clang run rustc's rust-lld on x86_64, goes
//!   musl      rustc's own musl startup files and -L to its musl
//!             (-Clink-self-contained) go, and -nostartfiles with them:
//!             clang links xclang's musl, which the crates' C code was
//!             compiled against; so does -no-pie, unused with -static
//!   MSVC      the hybrid CRT, as xclang's clang links it: the VC runtime
//!             static (/defaultlib:libcmt for rustc's msvcrt) and UCRT
//!             from Windows (ucrt.lib, not libucrt.lib)
//!   MinGW, macOS  nothing but --target
//!
//! rustc gives the options in a response file, @<dir>/linker-arguments,
//! when the command line would be too long; that file is read, and its
//! options, changed, written to another for clang or lld-link.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cargo::{Kind, Target};
use crate::toolchain::Toolchain;
use crate::{Context, Result};

/// Link for t, with rustc's arguments.
pub fn main(t: &Target, args: Vec<OsString>) -> Result<()> {
    let root = Toolchain::find(None)?.root;
    let bin = root.join("bin");
    let tool = |name: &str| bin.join(format!("{name}{}", env::consts::EXE_SUFFIX));
    let mut file = None;
    let mut given = vec![];
    for arg in args {
        let text = arg.to_string_lossy();
        match text.strip_prefix('@') {
            Some(f)
                if Path::new(f)
                    .file_name()
                    .is_some_and(|n| n == "linker-arguments") =>
            {
                given.extend(read_response_file(Path::new(f))?);
                file = Some(PathBuf::from(f));
            }
            _ => given.push(text.into_owned()),
        }
    }
    let (program, mut args) = match t.kind {
        Kind::Msvc => {
            let mut args = vec![];
            let sdk = root.join("sdk").join("windows");
            if sdk.exists() {
                args.push(format!("/winsysroot:{}", sdk.display()));
            }
            (tool("lld-link"), args)
        }
        _ => (tool("clang"), vec![format!("--target={}", t.triple)]),
    };
    args.extend(filter(t.kind, given));
    if t.kind == Kind::Msvc {
        // The objects of the VC runtime name PDBs that are not shipped.
        args.extend(
            [
                "/nodefaultlib:libucrt.lib",
                "/defaultlib:ucrt.lib",
                "/ignore:4099",
            ]
            .map(String::from),
        );
    }
    let mut command = Command::new(program);
    match file {
        Some(file) => {
            let ours = file.with_file_name("linker-arguments.xclang");
            fs::write(&ours, response_file(&args)).context(ours.display())?;
            command
                .arg("--rsp-quoting=posix")
                .arg(format!("@{}", ours.display()));
        }
        None => {
            command.args(&args);
        }
    }
    crate::replace(command)
}

/// rustc's arguments, changed for xclang's sysroots and runtimes.
fn filter(kind: Kind, args: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut args = args.into_iter().peekable();
    let rustlib = |path: &str| {
        let p = Path::new(path);
        p.components().any(|c| c.as_os_str() == "rustlib")
    };
    let self_contained = |path: &str| {
        rustlib(path)
            && Path::new(path)
                .components()
                .any(|c| c.as_os_str() == "self-contained")
    };
    while let Some(arg) = args.next() {
        match kind {
            Kind::Linux if arg == "-lgcc_s" => out.push("-l:libunwind.a".into()),
            Kind::Linux
                if arg.starts_with("-B") && rustlib(&arg[2..]) && arg.ends_with("gcc-ld") => {}
            Kind::Linux
                if arg == "-B"
                    && args
                        .peek()
                        .is_some_and(|n| rustlib(n) && n.ends_with("gcc-ld")) =>
            {
                args.next();
            }
            // -no-pie, rustc's for a static program on arm64, which clang
            // takes for unused next to musl's -static.
            Kind::Musl if arg == "-nostartfiles" || arg == "-no-pie" => {}
            Kind::Musl if arg.ends_with(".o") && self_contained(&arg) => {}
            Kind::Musl if arg.starts_with("-L") && arg.len() > 2 && self_contained(&arg[2..]) => {}
            Kind::Musl if arg == "-L" && args.peek().is_some_and(|n| self_contained(n)) => {
                args.next();
            }
            Kind::Msvc
                if arg.eq_ignore_ascii_case("/defaultlib:msvcrt")
                    || arg.eq_ignore_ascii_case("/defaultlib:msvcrt.lib") =>
            {
                out.push("/defaultlib:libcmt".into())
            }
            _ => out.push(arg),
        }
    }
    out
}

/// The arguments of rustc's response file: one a line, UTF-8 with \ before
/// \ and blanks; for MSVC targets UTF-16 after a byte order mark, each in
/// "", \ before ".
fn read_response_file(file: &Path) -> Result<Vec<String>> {
    let bytes = fs::read(file).context(file.display())?;
    let text = match bytes.strip_prefix(&[0xFF, 0xFE]) {
        Some(utf16) => {
            let units: Vec<u16> = utf16
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16::from_le_bytes(*c))
                .collect();
            String::from_utf16_lossy(&units)
        }
        None => String::from_utf8_lossy(&bytes).into_owned(),
    };
    let lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.is_empty())
        .collect();
    let quoted = lines
        .iter()
        .all(|l| l.len() >= 2 && l.starts_with('"') && l.ends_with('"'));
    Ok(lines
        .into_iter()
        .map(|line| {
            if quoted {
                line[1..line.len() - 1].replace("\\\"", "\"")
            } else {
                let mut arg = String::new();
                let mut chars = line.chars();
                while let Some(c) = chars.next() {
                    arg.push(if c == '\\' {
                        chars.next().unwrap_or('\\')
                    } else {
                        c
                    });
                }
                arg
            }
        })
        .collect())
}

/// A response file of the arguments, as clang and lld-link read it with
/// --rsp-quoting=posix.
fn response_file(args: &[String]) -> String {
    let mut text = String::new();
    for arg in args {
        for c in arg.chars() {
            if matches!(c, '\\' | ' ' | '\t' | '\'' | '"') {
                text.push('\\');
            }
            text.push(c);
        }
        text.push('\n');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn linux() {
        let lib = "/r/.rustup/toolchains/1.99.0-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-gnu";
        let args = strings(&[
            "-m64",
            "a.o",
            "-Wl,-Bdynamic",
            "-lgcc_s",
            "-lc",
            &format!("-B{lib}/bin/gcc-ld"),
            "-fuse-ld=lld",
            "-B",
            &format!("{lib}/bin/gcc-ld"),
            "-B/my/tools",
        ]);
        assert_eq!(
            filter(Kind::Linux, args),
            strings(&[
                "-m64",
                "a.o",
                "-Wl,-Bdynamic",
                "-l:libunwind.a",
                "-lc",
                "-fuse-ld=lld",
                "-B/my/tools"
            ])
        );
    }

    #[test]
    fn musl() {
        let lib = "/r/toolchains/1.99.0-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-musl/lib";
        let args = strings(&[
            "-m64",
            &format!("{lib}/self-contained/rcrt1.o"),
            &format!("{lib}/self-contained/crti.o"),
            "a.o",
            "-lunwind",
            "-lc",
            "-nostartfiles",
            "-L",
            &format!("{lib}/self-contained"),
            "-L",
            lib,
            "-static-pie",
            "-no-pie",
            &format!("{lib}/self-contained/crtn.o"),
            "/my/self-contained/x.o",
        ]);
        assert_eq!(
            filter(Kind::Musl, args),
            strings(&[
                "-m64",
                "a.o",
                "-lunwind",
                "-lc",
                "-L",
                lib,
                "-static-pie",
                "/my/self-contained/x.o"
            ])
        );
    }

    #[test]
    fn msvc() {
        let args = strings(&[
            "/NOLOGO",
            "a.o",
            "kernel32.lib",
            "/defaultlib:msvcrt",
            "/OUT:a.exe",
        ]);
        assert_eq!(
            filter(Kind::Msvc, args),
            strings(&[
                "/NOLOGO",
                "a.o",
                "kernel32.lib",
                "/defaultlib:libcmt",
                "/OUT:a.exe"
            ])
        );
        let args = strings(&["-lgcc_s", "-nostartfiles"]);
        assert_eq!(filter(Kind::Mingw, args.clone()), args);
    }

    #[test]
    fn response_files() {
        let dir = env::temp_dir().join(format!("xclang-link-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("linker-arguments");
        fs::write(&file, "-o\n/a\\ b/c\\\\d\n\n-lc\n").unwrap();
        assert_eq!(
            read_response_file(&file).unwrap(),
            strings(&["-o", "/a b/c\\d", "-lc"])
        );
        let utf16: Vec<u8> = [0xFEFFu16]
            .into_iter()
            .chain("\"/OUT:C:\\a b\\x.exe\"\n\"/x:\\\"q\\\"\"\n".encode_utf16())
            .flat_map(|u| u.to_le_bytes())
            .collect();
        fs::write(&file, utf16).unwrap();
        assert_eq!(
            read_response_file(&file).unwrap(),
            strings(&["/OUT:C:\\a b\\x.exe", "/x:\"q\""])
        );
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(
            response_file(&strings(&["/OUT:C:\\a b", "it's"])),
            "/OUT:C:\\\\a\\ b\nit\\'s\n"
        );
    }
}
