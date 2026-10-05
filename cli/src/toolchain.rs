//! The toolchain this program belongs to: <root>/bin/xclang.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{Result, bail, links};

pub struct Toolchain {
    pub root: PathBuf,
    /// Its release (23.1.2.6), from its CMake package.
    pub version: Option<String>,
}

fn exe(name: &str) -> String {
    format!("{name}{}", env::consts::EXE_SUFFIX)
}

fn is_toolchain(root: &Path) -> bool {
    root.join("bin").join(exe("llvm")).is_file() || root.join("bin").join(exe("clang")).is_file()
}

impl Toolchain {
    /// --root, $XCLANG_ROOT, or the tree whose bin/ holds this program.
    pub fn find(root: Option<&str>) -> Result<Toolchain> {
        let given = root
            .map(PathBuf::from)
            .or_else(|| env::var_os("XCLANG_ROOT").map(PathBuf::from));
        let root = match given {
            Some(root) => {
                if !is_toolchain(&root) {
                    bail!(
                        "{} is not an xclang toolchain (no bin/llvm)",
                        root.display()
                    );
                }
                links::canonical(&root)?
            }
            None => {
                let exe = links::canonical(&env::current_exe()?)?;
                match exe.parent().and_then(Path::parent) {
                    Some(root) if is_toolchain(root) => root.to_path_buf(),
                    _ => bail!(
                        "{} is not in a toolchain's bin/: pass --root or set XCLANG_ROOT",
                        exe.display()
                    ),
                }
            }
        };
        let version = read_version(&root);
        Ok(Toolchain { root, version })
    }

    /// The release whose targets fit this toolchain: its own, or (before
    /// toolchains carried their CMake package) the one this program was
    /// built for.
    pub fn release(&self) -> Option<&str> {
        self.version.as_deref().or(option_env!("XCLANG_VERSION"))
    }
}

/// set(PACKAGE_VERSION "23.1.2.6") in lib/cmake/xclang/xclang-config-version.cmake.
fn read_version(root: &Path) -> Option<String> {
    let text =
        fs::read_to_string(root.join("lib/cmake/xclang/xclang-config-version.cmake")).ok()?;
    let rest = &text[text.find("set(PACKAGE_VERSION \"")? + 21..];
    Some(rest[..rest.find('"')?].to_string())
}
