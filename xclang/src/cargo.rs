//! `xclang cargo`: cargo, with the toolchain's clang as the C and C++
//! compiler and its clang or lld-link as the linker of the targets it builds
//! for, and no cargo config. As cargo-zigbuild does for zig, it sets cargo's
//! variables of each target in cargo's environment, which a cargo config of
//! the user's, RUSTFLAGS included, leaves in effect:
//!
//!   CARGO_TARGET_<T>_LINKER       this program, as <cache>/<Rust target>-linker,
//!                                 which links as the target needs (link.rs)
//!   CC_<t>, CXX_<t>, AR_<t>,      the toolchain's clang, clang++, llvm-ar
//!   RANLIB_<t>                    (llvm-lib for MSVC), llvm-ranlib: the cc
//!                                 crate gives them its --target, whose config
//!                                 file (bin/<triple>.cfg) has the rest
//!   CXXSTDLIB_<t>                 c++: libc++, for the cc crate's C++ code
//!   CMAKE_TOOLCHAIN_FILE_<t>      <cache>/<Rust target>-toolchain.cmake, which
//!                                 includes lib/cmake/xclang/toolchain.cmake
//!                                 for the target (the cmake crate)
//!   BINDGEN_EXTRA_CLANG_ARGS_<t>  --target and the header directories of the
//!                                 toolchain's clang, for the libclang bindgen
//!                                 loads
//!   CARGO_TARGET_<T>_RUSTFLAGS    MSVC targets: +crt-static, joined to what the
//!                                 configs have, so that build scripts see the
//!                                 static VC runtime the linker links anyway
//!
//! and for every target: PATH with the toolchain's bin/ first, XCLANG_ROOT for
//! the linker; macOS targets: MACOSX_DEPLOYMENT_TARGET, the toolchain's (13.0),
//! and off macOS SDKROOT, the fetched SDK in use; on Windows, CMAKE_GENERATOR
//! Ninja. A variable the environment has already is left as it is.
//!
//! The targets are those of --target, else of build.target (--config,
//! CARGO_BUILD_TARGET, cargo's config files), else the host's. Only those:
//! cargo links build scripts and proc macros with the host's linker unless
//! the host's target is one of them. Before cargo runs, each target's Rust
//! standard library is added with rustup if it is missing, and a vendor SDK
//! a target needs is checked for.

use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::toolchain::Toolchain;
use crate::{Context, Result, bail, links};

/// What a target of xclang is to clang and to the linker.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Linux,
    Musl,
    Mingw,
    Darwin,
    Msvc,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Target {
    /// Rust's name.
    pub rust: &'static str,
    /// xclang's (clang's --target).
    pub triple: &'static str,
    pub kind: Kind,
}

impl Target {
    pub fn arch(&self) -> &'static str {
        self.rust.split('-').next().unwrap()
    }

    /// The name of its config file, bin/<name>.cfg.
    pub fn config(&self) -> String {
        match self.kind {
            Kind::Mingw => format!("{}-w64-windows-gnu", self.arch()),
            _ => self.triple.to_string(),
        }
    }
}

const fn target(rust: &'static str, triple: &'static str, kind: Kind) -> Target {
    Target { rust, triple, kind }
}

/// The Rust targets xclang builds for: the targets of every toolchain, and
/// those of the vendor SDKs. Rust's *-windows-gnullvm targets are the MinGW
/// ones: their std links libunwind and UCRT, as xclang's MinGW sysroots have
/// them.
pub const TARGETS: [Target; 10] = [
    target(
        "x86_64-unknown-linux-gnu",
        "x86_64-unknown-linux-gnu",
        Kind::Linux,
    ),
    target(
        "aarch64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu",
        Kind::Linux,
    ),
    target(
        "x86_64-unknown-linux-musl",
        "x86_64-unknown-linux-musl",
        Kind::Musl,
    ),
    target(
        "aarch64-unknown-linux-musl",
        "aarch64-unknown-linux-musl",
        Kind::Musl,
    ),
    target(
        "x86_64-pc-windows-gnullvm",
        "x86_64-w64-mingw32",
        Kind::Mingw,
    ),
    target(
        "aarch64-pc-windows-gnullvm",
        "aarch64-w64-mingw32",
        Kind::Mingw,
    ),
    target("aarch64-apple-darwin", "aarch64-apple-darwin", Kind::Darwin),
    target("x86_64-apple-darwin", "x86_64-apple-darwin", Kind::Darwin),
    target(
        "x86_64-pc-windows-msvc",
        "x86_64-pc-windows-msvc",
        Kind::Msvc,
    ),
    target(
        "aarch64-pc-windows-msvc",
        "aarch64-pc-windows-msvc",
        Kind::Msvc,
    ),
];

/// The target of a Rust target's name, or why there is none.
pub fn find(rust: &str) -> Result<&'static Target> {
    if let Some(t) = TARGETS.iter().find(|t| t.rust == rust) {
        return Ok(t);
    }
    if let Some(arch) = rust.strip_suffix("-pc-windows-gnu")
        && TARGETS
            .iter()
            .any(|t| t.rust == format!("{arch}-pc-windows-gnullvm"))
    {
        bail!(
            "{rust}: Rust's *-windows-gnu targets link libgcc and msvcrt, which xclang's MinGW \
             sysroots do not have; build for {arch}-pc-windows-gnullvm, whose std links \
             libunwind and UCRT"
        );
    }
    let names: Vec<&str> = TARGETS.iter().map(|t| t.rust).collect();
    bail!(
        "{rust} is not a target of xclang cargo, which builds for {}",
        names.join(", ")
    )
}

/// The target this program links for when it runs as <Rust target>-linker.
pub fn linker_of(program: &OsStr) -> Option<&'static Target> {
    let name = program.to_str()?.rsplit(['/', '\\']).next()?;
    let name = name.strip_suffix(".exe").unwrap_or(name);
    let rust = name.strip_suffix("-linker")?;
    TARGETS.iter().find(|t| t.rust == rust)
}

/// cargo's subcommands that compile nothing: xclang cargo checks no
/// standard library or SDK for them, and skips a target it cannot set up.
const NOT_COMPILING: &[&str] = &[
    "add",
    "clean",
    "config",
    "fetch",
    "generate-lockfile",
    "help",
    "info",
    "init",
    "locate-project",
    "login",
    "logout",
    "metadata",
    "new",
    "owner",
    "pkgid",
    "read-manifest",
    "remove",
    "report",
    "search",
    "tree",
    "uninstall",
    "update",
    "vendor",
    "verify-project",
    "version",
    "yank",
];

/// What xclang cargo reads of cargo's command line.
#[derive(Debug, Default, PartialEq)]
struct Invocation {
    /// cargo +<toolchain>.
    toolchain: Option<String>,
    subcommand: Option<String>,
    /// --target, each.
    targets: Vec<String>,
    /// build.target of --config build.target=....
    config_targets: Vec<String>,
    /// -Zbuild-std: no standard library to add.
    build_std: bool,
}

impl Invocation {
    fn parse(args: &[String]) -> Invocation {
        let mut inv = Invocation::default();
        let mut i = 0;
        if let Some(t) = args.first().and_then(|a| a.strip_prefix('+')) {
            inv.toolchain = Some(t.to_string());
            i = 1;
        }
        while i < args.len() {
            let arg = args[i].as_str();
            i += 1;
            if arg == "--" {
                break;
            }
            // An option and its value, as one argument or two.
            let mut value = |name: &str| -> Option<String> {
                if arg == name {
                    let v = args.get(i).cloned();
                    i += 1;
                    v
                } else {
                    arg.strip_prefix(name)
                        .and_then(|v| {
                            v.strip_prefix('=')
                                .or(if name == "-Z" { Some(v) } else { None })
                        })
                        .filter(|v| !v.is_empty())
                        .map(String::from)
                }
            };
            if let Some(t) = value("--target") {
                inv.targets.push(t);
            } else if let Some(c) = value("--config") {
                if let Some(v) = c
                    .split_once('=')
                    .and_then(|(k, v)| (k.trim() == "build.target").then_some(v))
                {
                    inv.config_targets = strings(v);
                }
            } else if let Some(z) = value("-Z") {
                inv.build_std |= z.starts_with("build-std");
            } else if inv.subcommand.is_none()
                && (value("-C").is_some() || value("--color").is_some())
            {
            } else if inv.subcommand.is_none() && !arg.starts_with('-') {
                inv.subcommand = Some(arg.to_string());
            }
        }
        inv
    }

    fn compiles(&self) -> bool {
        self.subcommand
            .as_deref()
            .is_some_and(|s| !NOT_COMPILING.contains(&s))
    }
}

/// The strings of a TOML value: "a", ["a", 'b'].
fn strings(value: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = value;
    while let Some(start) = rest.find(['"', '\'']) {
        let quote = rest.as_bytes()[start] as char;
        let after = &rest[start + 1..];
        let Some(end) = after.find(quote) else { break };
        out.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    out
}

/// build.target of a cargo config file, if it names one: `target = ...` in
/// [build], or `build.target = ...`, a string or an array of them.
fn config_file_targets(text: &str) -> Option<Vec<String>> {
    let mut table = String::new();
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let line = line.split('#').next().unwrap().trim();
        if let Some(name) = line.strip_prefix('[') {
            table = name.trim_end_matches(']').trim().to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
        let key = if table.is_empty() {
            key
        } else {
            format!("{table}.{key}")
        };
        if key != "build.target" {
            continue;
        }
        let mut value = value.to_string();
        // An array over several lines.
        while value.contains('[') && !value.contains(']') {
            let Some(next) = lines.next() else { break };
            value.push_str(next.split('#').next().unwrap());
        }
        return Some(strings(&value));
    }
    None
}

/// build.target of cargo's config files: the nearest of this directory's and
/// its parents' .cargo/config.toml (or .cargo/config), then $CARGO_HOME's.
fn config_targets() -> Option<Vec<String>> {
    let cwd = env::current_dir().ok()?;
    let home = env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(".cargo")));
    let dirs = cwd.ancestors().map(|d| d.join(".cargo")).chain(home);
    for dir in dirs {
        for name in ["config.toml", "config"] {
            if let Ok(text) = fs::read_to_string(dir.join(name))
                && let Some(targets) = config_file_targets(&text)
            {
                return Some(targets);
            }
        }
    }
    None
}

fn home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where xclang cargo keeps the linkers and CMake toolchain files of a
/// toolchain: $XCLANG_CACHE_DIR, or the user's cache directory, then
/// cargo/<a hash of the toolchain's path>.
fn cache_dir(root: &Path) -> Result<PathBuf> {
    let base = match env::var_os("XCLANG_CACHE_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => {
            let user = if cfg!(windows) {
                env::var_os("LOCALAPPDATA").map(PathBuf::from)
            } else if cfg!(target_os = "macos") {
                home().map(|h| h.join("Library").join("Caches"))
            } else {
                env::var_os("XDG_CACHE_HOME")
                    .map(PathBuf::from)
                    .or_else(|| home().map(|h| h.join(".cache")))
            };
            let Some(user) = user else {
                bail!("no cache directory: set XCLANG_CACHE_DIR")
            };
            user.join("xclang")
        }
    };
    let digest = ring::digest::digest(&ring::digest::SHA256, root.as_os_str().as_encoded_bytes());
    let hash: String = digest.as_ref()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(base.join("cargo").join(hash))
}

/// dir/<name>, this program under another name: a symlink; on Windows,
/// where a symlink needs a privilege, a hard link, or a copy across
/// volumes, made again when the program changed.
fn alias(dir: &Path, name: &str) -> Result<PathBuf> {
    let exe = links::canonical(&env::current_exe()?)?;
    let file = dir.join(format!("{name}{}", env::consts::EXE_SUFFIX));
    let current = |m: &fs::Metadata| {
        let e = fs::metadata(&exe).ok();
        e.is_some_and(|e| e.len() == m.len() && e.modified().ok() == m.modified().ok())
    };
    if cfg!(unix) {
        if fs::read_link(&file).is_ok_and(|t| t == exe) {
            return Ok(file);
        }
    } else if fs::metadata(&file).is_ok_and(|m| current(&m)) {
        return Ok(file);
    }
    // Made aside and renamed into place, as another build may be making it.
    let temp = dir.join(format!(
        ".{name}.{}{}",
        std::process::id(),
        env::consts::EXE_SUFFIX
    ));
    let _ = fs::remove_file(&temp);
    #[cfg(unix)]
    std::os::unix::fs::symlink(&exe, &temp).context(temp.display())?;
    #[cfg(windows)]
    if std::os::windows::fs::symlink_file(&exe, &temp).is_err()
        && fs::hard_link(&exe, &temp).is_err()
    {
        fs::copy(&exe, &temp).context(temp.display())?;
    }
    if let Err(e) = fs::rename(&temp, &file) {
        let _ = fs::remove_file(&temp);
        // In use by a link of another build, and as new as this one.
        if !fs::metadata(&file).is_ok_and(|m| current(&m)) {
            bail!("{}: {e}", file.display());
        }
    }
    Ok(file)
}

/// Write a file unless it has the text already.
fn write(file: &Path, text: &str) -> Result<()> {
    if fs::read_to_string(file).is_ok_and(|t| t == text) {
        return Ok(());
    }
    let temp = file.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, text).context(temp.display())?;
    fs::rename(&temp, file).context(file.display())
}

/// The cmake crate's toolchain file for t: xclang's, for the target.
fn toolchain_file(root: &Path, cmake: &Path, t: &Target) -> String {
    let mut text = format!(
        "# xclang cargo: the cmake crate's toolchain file for {}\n\
         set(XCLANG_ROOT \"{}\")\n\
         set(XCLANG_TARGET {})\n",
        t.rust,
        cmake_path(root),
        t.triple
    );
    if t.kind == Kind::Mingw {
        // The cmake crate gives a MinGW target the C compiler's windres, by
        // its name, or else the C compiler: clang. With another than the
        // toolchain file's, CMake deletes its cache and configures again,
        // without the cmake crate's options (CMAKE_INSTALL_PREFIX).
        text.push_str(
            "if(CMAKE_RC_COMPILER MATCHES \"clang(\\\\.exe)?$\")\n    unset(CMAKE_RC_COMPILER CACHE)\nendif()\n",
        );
    }
    text.push_str(&format!("include(\"{}\")\n", cmake_path(cmake)));
    text
}

/// A path as CMake writes it.
fn cmake_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// A word as shlex (bindgen) reads it.
fn quote(word: &str) -> String {
    if !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_=+./:@,%".contains(c))
    {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

/// The directories clang searches for #include <...>, in order, for C or
/// C++; a framework directory ends with " (framework directory)".
fn search_dirs(clang: &Path, t: &Target, language: &str) -> Result<Vec<String>> {
    let mut c = Command::new(clang);
    c.arg(format!("--target={}", t.triple))
        .args(["-E", "-x", language, "-", "-v"])
        .stdin(std::process::Stdio::null());
    let what = format!("{c:?}");
    let out = c.output().context(&what)?;
    let err = String::from_utf8_lossy(&out.stderr);
    let (Some(start), Some(end)) = (
        err.find("#include <...> search starts here:"),
        err.find("End of search list."),
    ) else {
        bail!("{what}: no search list: {}", err.trim())
    };
    Ok(err[start..end]
        .lines()
        .skip(1)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// bindgen's arguments for libclang, which reads no config file of the
/// toolchain's (and is often older than its clang): the target, and the
/// header directories of xclang's clang for it, but for its own headers,
/// libclang's then: those before them -isystem (-cxx-isystem for C++'s
/// alone, libc++), those after -idirafter, as the config files order them
/// (mingw-w64's headers come after clang's, which include_next them).
fn bindgen_args(root: &Path, t: &Target) -> Result<String> {
    let clang = root
        .join("bin")
        .join(format!("clang{}", env::consts::EXE_SUFFIX));
    let mut c = Command::new(&clang);
    c.arg("-print-resource-dir");
    let resource = PathBuf::from(output(c)?.trim()).join("include");
    let resource = links::canonical(&resource).unwrap_or(resource);
    let is_resource = |d: &str| links::canonical(Path::new(d)).is_ok_and(|d| d == resource);
    let split = |dirs: Vec<String>| -> (Vec<String>, Vec<String>) {
        match dirs.iter().position(|d| is_resource(d)) {
            Some(i) => (dirs[..i].to_vec(), dirs[i + 1..].to_vec()),
            None => (vec![], dirs),
        }
    };
    let (c_before, c_after) = split(search_dirs(&clang, t, "c")?);
    let (cxx_before, _) = split(search_dirs(&clang, t, "c++")?);
    let mut args = vec![format!("--target={}", t.triple), "-nostdlibinc".into()];
    let mut add = |option: &str, dir: &str| match dir.strip_suffix(" (framework directory)") {
        Some(framework) => args.extend(["-iframework".into(), framework.to_string()]),
        None => args.extend([option.to_string(), dir.to_string()]),
    };
    for d in cxx_before.iter().filter(|d| !c_before.contains(d)) {
        add("-cxx-isystem", d);
    }
    for d in &c_before {
        add("-isystem", d);
    }
    for d in &c_after {
        add("-idirafter", d);
    }
    match t.kind {
        Kind::Darwin => args.push(format!("-mmacos-version-min={}", macos_min(root, t))),
        Kind::Msvc => args.push("-D_STATIC_INLINE_UCRT_FUNCTIONS=0".into()),
        _ => {}
    }
    Ok(args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" "))
}

/// The macOS release the toolchain's macOS targets build for, from their
/// config files (-mmacos-version-min=13.0).
fn macos_min(root: &Path, t: &Target) -> String {
    let cfg = fs::read_to_string(root.join("bin").join(format!("{}.cfg", t.config())))
        .unwrap_or_default();
    cfg.lines()
        .find_map(|l| l.trim().strip_prefix("-mmacos-version-min="))
        .unwrap_or("13.0")
        .to_string()
}

/// The environment of cargo: the variables xclang cargo sets.
struct Env {
    vars: Vec<(OsString, OsString)>,
}

impl Env {
    fn get(&self, name: &str) -> Option<OsString> {
        self.vars
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
            .or_else(|| env::var_os(name))
    }

    fn set(&mut self, name: impl Into<OsString>, value: impl Into<OsString>) {
        self.vars.push((name.into(), value.into()));
    }

    /// Set name unless the environment has it, or one of `also`.
    fn default(&mut self, name: &str, also: &[&str], value: impl Into<OsString>) {
        if self.get(name).is_none() && also.iter().all(|a| self.get(a).is_none()) {
            self.set(name, value);
        }
    }

    /// Set <prefix>_<target> (in lower case with _) unless the environment
    /// has it, in that spelling or with the target's -.
    fn default_for(&mut self, prefix: &str, t: &Target, value: impl Into<OsString>) {
        let name = format!("{prefix}_{}", t.rust.replace('-', "_"));
        self.default(&name, &[&format!("{prefix}_{}", t.rust)], value);
    }
}

/// Whether Visual Studio is installed, which clang and lld-link find on
/// Windows without an SDK.
fn visual_studio() -> bool {
    env::var_os("VCINSTALLDIR").is_some()
        || env::var_os("ProgramFiles(x86)").is_some_and(|p| {
            Path::new(&p)
                .join(r"Microsoft Visual Studio\Installer\vswhere.exe")
                .is_file()
        })
}

/// Fails, saying what to fetch, when a target needs a vendor SDK that is
/// not in the toolchain, or a sysroot the toolchain lacks.
fn check_sdk(root: &Path, t: &Target) -> Result<()> {
    let xclang = root.join("bin").join("xclang");
    let xclang = xclang.display();
    match t.kind {
        Kind::Msvc => {
            let sdk = root.join("sdk").join("windows");
            if sdk.join(format!("{}.cfg", t.triple)).is_file()
                || cfg!(windows) && !sdk.exists() && visual_studio()
            {
                return Ok(());
            }
            if sdk.exists() {
                bail!(
                    "{}: the Windows SDK in use, {}, has no {}: {xclang} sdk fetch windows --accept-license --arch x86_64,aarch64",
                    t.rust,
                    links::canonical(&sdk).unwrap_or(sdk).display(),
                    t.arch()
                );
            }
            bail!(
                "{} needs Microsoft's CRT and the Windows SDK{}: {xclang} sdk fetch windows --accept-license",
                t.rust,
                if cfg!(windows) {
                    ", or Visual Studio"
                } else {
                    ""
                }
            )
        }
        Kind::Darwin if !cfg!(target_os = "macos") => {
            if root
                .join("sdk")
                .join("macos")
                .join("SDKSettings.json")
                .is_file()
            {
                return Ok(());
            }
            bail!(
                "{} needs Apple's macOS SDK: {xclang} sdk fetch macos --accept-license",
                t.rust
            )
        }
        Kind::Musl if !root.join(t.triple).is_dir() => {
            bail!(
                "{}: the toolchain at {} has no {}; the musl targets are in 23.1.2.10 and later",
                t.rust,
                root.display(),
                t.triple
            )
        }
        _ => Ok(()),
    }
}

/// rustc, of the toolchain cargo runs (+<toolchain>, or rustup's choice for
/// this directory).
fn rustc(inv: &Invocation) -> Command {
    let mut c = Command::new(env::var_os("RUSTC").unwrap_or("rustc".into()));
    if let Some(t) = &inv.toolchain {
        c.arg(format!("+{t}"));
    }
    c
}

fn output(mut c: Command) -> Result<String> {
    let what = format!("{c:?}");
    let out = c.output().context(&what)?;
    if !out.status.success() {
        bail!("{what}: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Rust's target of this machine, as rustc builds for it.
fn host(inv: &Invocation) -> Result<String> {
    let mut c = rustc(inv);
    c.arg("-vV");
    let out = output(c)?;
    match out.lines().find_map(|l| l.strip_prefix("host: ")) {
        Some(h) => Ok(h.trim().to_string()),
        None => bail!("rustc -vV names no host"),
    }
}

/// Add the target's standard library with rustup when the toolchain lacks
/// it, as it is what the build needs and what rustup's own error would ask
/// for; without rustup, fail saying so.
fn check_std(inv: &Invocation, t: &Target) -> Result<()> {
    let mut c = rustc(inv);
    c.args(["--print", "target-libdir", "--target", t.rust]);
    let dir = PathBuf::from(output(c)?.trim());
    let has_core = fs::read_dir(&dir).is_ok_and(|mut d| {
        d.any(|e| e.is_ok_and(|e| e.file_name().to_string_lossy().starts_with("libcore-")))
    });
    if has_core {
        return Ok(());
    }
    if Command::new("rustup").arg("--version").output().is_err() {
        bail!(
            "Rust's standard library for {} is not installed (no {}); install it, with rustup: rustup target add {}",
            t.rust,
            dir.display(),
            t.rust
        );
    }
    eprintln!(
        "xclang: adding Rust's standard library for {}: rustup target add {}",
        t.rust, t.rust
    );
    let mut c = Command::new("rustup");
    c.args(["target", "add", t.rust]);
    if let Some(tc) = &inv.toolchain {
        c.args(["--toolchain", tc]);
    }
    match c.status() {
        Ok(s) if s.success() => Ok(()),
        _ => bail!("rustup target add {} failed", t.rust),
    }
}

/// `xclang cargo <cargo's arguments>`: cargo, set up for xclang's targets.
pub fn main(args: Vec<OsString>) -> Result<()> {
    let words: Vec<String> = args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let inv = Invocation::parse(&words);
    let mut cargo = Command::new(env::var_os("CARGO").unwrap_or("cargo".into()));
    cargo.args(&args);
    if inv.subcommand.is_none() {
        crate::replace(cargo);
    }
    let strict = inv.compiles();
    let toolchain = Toolchain::find(None)?;
    let root = toolchain.root;
    let bin = root.join("bin");
    let tool = |name: &str| bin.join(format!("{name}{}", env::consts::EXE_SUFFIX));

    let mut named: Vec<String> = if !inv.targets.is_empty() {
        inv.targets.clone()
    } else if !inv.config_targets.is_empty() {
        inv.config_targets.clone()
    } else if let Some(t) = env::var("CARGO_BUILD_TARGET")
        .ok()
        .filter(|t| !t.is_empty())
    {
        vec![t]
    } else {
        config_targets().unwrap_or_default()
    };
    if named.is_empty() {
        named.push(host(&inv)?);
    }
    let mut seen = vec![];
    named.retain(|n| {
        let new = !seen.contains(n);
        seen.push(n.clone());
        new
    });
    let mut targets = vec![];
    for name in &named {
        match find(name) {
            Ok(t) => {
                if strict {
                    check_sdk(&root, t)?;
                }
                targets.push(t);
            }
            Err(e) if strict => return Err(e),
            Err(_) => {}
        }
    }
    if strict && !inv.build_std {
        for t in &targets {
            check_std(&inv, t)?;
        }
    }

    let cache = cache_dir(&root)?;
    fs::create_dir_all(&cache).context(cache.display())?;
    let mut e = Env { vars: vec![] };
    let path = env::var_os("PATH").unwrap_or_default();
    let path = env::join_paths(std::iter::once(bin.clone()).chain(env::split_paths(&path)))
        .context("PATH")?;
    e.set("PATH", path);
    e.default("XCLANG_ROOT", &[], &root);
    for t in &targets {
        let upper = t.rust.to_uppercase().replace('-', "_");
        let lower = t.rust.replace('-', "_");
        let var = |prefix: &str| format!("{prefix}_{lower}");
        let linker = alias(&cache, &format!("{}-linker", t.rust))?;
        e.set(format!("CARGO_TARGET_{upper}_LINKER"), linker);
        e.default_for("CC", t, tool("clang"));
        e.default_for("CXX", t, tool("clang++"));
        e.default_for(
            "AR",
            t,
            tool(if t.kind == Kind::Msvc {
                "llvm-lib"
            } else {
                "llvm-ar"
            }),
        );
        if t.kind != Kind::Msvc {
            e.default_for("RANLIB", t, tool("llvm-ranlib"));
            e.default_for("CXXSTDLIB", t, "c++");
        }
        let cmake = root
            .join("lib")
            .join("cmake")
            .join("xclang")
            .join("toolchain.cmake");
        if cmake.is_file() {
            let file = cache.join(format!("{}-toolchain.cmake", t.rust));
            write(&file, &toolchain_file(&root, &cmake, t))?;
            e.default(
                &var("CMAKE_TOOLCHAIN_FILE"),
                &[
                    &format!("CMAKE_TOOLCHAIN_FILE_{}", t.rust),
                    "TARGET_CMAKE_TOOLCHAIN_FILE",
                    "CMAKE_TOOLCHAIN_FILE",
                ],
                cmake_path(&file),
            );
        }
        // The cmake crate takes Visual Studio's generator for MSVC targets,
        // and on Windows for the others too, which compiles with cl.
        let generator = if which("ninja").is_some() {
            Some("Ninja")
        } else if !cfg!(windows) {
            Some("Unix Makefiles")
        } else {
            None
        };
        if let Some(g) = generator
            && (cfg!(windows) || t.kind == Kind::Msvc)
        {
            e.default(
                &var("CMAKE_GENERATOR"),
                &[
                    &format!("CMAKE_GENERATOR_{}", t.rust),
                    "TARGET_CMAKE_GENERATOR",
                    "CMAKE_GENERATOR",
                ],
                g,
            );
        }
        // bindgen takes the first of these, and a --target of its own unless
        // one is given.
        let bindgen = var("BINDGEN_EXTRA_CLANG_ARGS");
        let given = [
            format!("BINDGEN_EXTRA_CLANG_ARGS_{}", t.rust),
            bindgen.clone(),
            "BINDGEN_EXTRA_CLANG_ARGS".into(),
        ]
        .iter()
        .find_map(|n| e.get(n));
        let mut value = bindgen_args(&root, t)?;
        if let Some(given) = given {
            value.push(' ');
            value.push_str(&given.to_string_lossy());
        }
        e.set(format!("BINDGEN_EXTRA_CLANG_ARGS_{}", t.rust), &value);
        e.set(bindgen, value);
        if t.kind == Kind::Msvc {
            let name = format!("CARGO_TARGET_{upper}_RUSTFLAGS");
            let given = e
                .get(&name)
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !given.contains("crt-static") {
                let flags = format!("{given} -Ctarget-feature=+crt-static");
                e.set(name, flags.trim());
            }
        }
        if t.kind == Kind::Darwin {
            e.default("MACOSX_DEPLOYMENT_TARGET", &[], macos_min(&root, t));
            let sdk = root.join("sdk").join("macos");
            if !cfg!(target_os = "macos")
                && let Ok(sdk) = links::canonical(&sdk)
            {
                e.default("SDKROOT", &[], sdk);
            }
        }
    }
    for (name, value) in &e.vars {
        cargo.env(name, value);
    }
    crate::replace(cargo)
}

/// A program in PATH.
fn which(name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", env::consts::EXE_SUFFIX);
    env::split_paths(&env::var_os("PATH")?)
        .map(|d| d.join(&file))
        .find(|f| f.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Invocation {
        Invocation::parse(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn targets() {
        assert_eq!(
            find("x86_64-pc-windows-gnullvm").unwrap().triple,
            "x86_64-w64-mingw32"
        );
        assert_eq!(
            find("aarch64-apple-darwin").unwrap().config(),
            "aarch64-apple-darwin"
        );
        assert_eq!(
            find("aarch64-pc-windows-gnullvm").unwrap().config(),
            "aarch64-w64-windows-gnu"
        );
        assert!(
            find("x86_64-pc-windows-gnu")
                .unwrap_err()
                .0
                .contains("x86_64-pc-windows-gnullvm")
        );
        assert!(
            find("wasm32-unknown-unknown")
                .unwrap_err()
                .0
                .contains("not a target")
        );
        let t = |p: &str| linker_of(OsStr::new(p)).map(|t| t.rust);
        assert_eq!(
            t("/c/x86_64-unknown-linux-musl-linker"),
            Some("x86_64-unknown-linux-musl")
        );
        assert_eq!(
            t(r"C:\c\aarch64-pc-windows-msvc-linker.exe"),
            Some("aarch64-pc-windows-msvc")
        );
        assert_eq!(t("/usr/bin/xclang"), None);
        assert_eq!(t("riscv64gc-unknown-linux-gnu-linker"), None);
    }

    #[test]
    fn command_line() {
        let inv = parse(&[
            "+nightly",
            "-v",
            "--config",
            "net.offline=true",
            "build",
            "--release",
            "--target",
            "x86_64-pc-windows-gnullvm",
            "--target=aarch64-apple-darwin",
            "-Zbuild-std",
            "--",
            "--target",
            "x",
        ]);
        assert_eq!(inv.toolchain.as_deref(), Some("nightly"));
        assert_eq!(inv.subcommand.as_deref(), Some("build"));
        assert_eq!(
            inv.targets,
            ["x86_64-pc-windows-gnullvm", "aarch64-apple-darwin"]
        );
        assert!(inv.build_std && inv.compiles());
        let inv = parse(&[
            "--color",
            "never",
            "--config",
            "build.target=[\"a\", 'b']",
            "tree",
        ]);
        assert_eq!(inv.subcommand.as_deref(), Some("tree"));
        assert_eq!(inv.config_targets, ["a", "b"]);
        assert!(!inv.compiles() && !inv.build_std);
        assert_eq!(
            parse(&["-Z", "build-std=core", "check"])
                .subcommand
                .as_deref(),
            Some("check")
        );
        assert!(parse(&["-Z", "build-std=core", "check"]).build_std);
        assert_eq!(parse(&["--version"]).subcommand, None);
    }

    #[test]
    fn config_files() {
        let t = |s: &str| config_file_targets(s);
        assert_eq!(
            t("[build]\ntarget = \"x86_64-pc-windows-gnullvm\" # Windows\n"),
            Some(vec!["x86_64-pc-windows-gnullvm".into()])
        );
        assert_eq!(
            t("build.target = ['a', \"b\"]\n"),
            Some(vec!["a".into(), "b".into()])
        );
        assert_eq!(
            t("[build]\ntarget = [\n  \"a\",\n  \"b\", # two\n]\n"),
            Some(vec!["a".into(), "b".into()])
        );
        assert_eq!(
            t("[target.x86_64-unknown-linux-gnu]\nlinker = \"clang\"\n[build]\njobs = 4\n"),
            None
        );
        assert_eq!(t("[env]\ntarget = \"x\"\n"), None);
    }

    #[test]
    fn quoting() {
        assert_eq!(
            quote("--config=/opt/xclang/bin/x86_64-pc-windows-msvc.cfg"),
            "--config=/opt/xclang/bin/x86_64-pc-windows-msvc.cfg"
        );
        assert_eq!(
            quote(r"--config=C:\Program Files\x.cfg"),
            r"'--config=C:\Program Files\x.cfg'"
        );
        assert_eq!(quote("it's"), r"'it'\''s'");
    }
}
