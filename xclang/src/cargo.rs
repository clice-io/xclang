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
//!                                 (stdc++ for the platform's libstdc++)
//!   CMAKE_TOOLCHAIN_FILE_<t>      <cache>/<Rust target>-toolchain.cmake, which
//!                                 includes lib/cmake/xclang/toolchain.cmake
//!                                 for the target (the cmake crate)
//!   CMAKE_GENERATOR_<t>           Ninja: on Windows for every target, if it is
//!                                 in PATH (else the cmake crate takes Visual
//!                                 Studio's, which compiles with cl); elsewhere
//!                                 for MSVC targets, or Unix Makefiles
//!   BINDGEN_EXTRA_CLANG_ARGS_<t>  --target and the header directories of the
//!                                 toolchain's clang, for the libclang bindgen
//!                                 loads
//!   CARGO_TARGET_<T>_RUSTFLAGS    MSVC targets: +crt-static, so that build
//!                                 scripts see the static VC runtime the linker
//!                                 links anyway, after the variable's flags or,
//!                                 if the configs have no rustflags of the
//!                                 target, after build.rustflags, which cargo
//!                                 would no longer take
//!
//! and for every target: PATH with the toolchain's bin/ first, XCLANG_ROOT,
//! the toolchain's, for the linker; macOS targets: MACOSX_DEPLOYMENT_TARGET,
//! the toolchain's (13.0), and off macOS SDKROOT, the fetched SDK in use.
//!
//! A variable the environment has already is left as it is. So is one of
//! the configs' [env], which cargo gives build scripts and rustc where the
//! environment lacks it; [env] is read for XCLANG_STDLIB too, and for what a
//! variable had that xclang cargo's value is joined to (CFLAGS_<t>,
//! BINDGEN_EXTRA_CLANG_ARGS_<t>).
//!
//! XCLANG_STDLIB=platform builds C++ code with the platform's C++ library in
//! place of xclang's libc++ (patches/0018): -stdlib=platform after the cc
//! crate's CFLAGS and CXXFLAGS (CFLAGS_<t>, CXXFLAGS_<t>) and in the linker's
//! clang, XCLANG_STDLIB in the cmake crate's toolchain file, and CXXSTDLIB_<t>
//! stdc++ for Linux and MinGW targets, whose libstdc++ is the host's or that
//! of a --sysroot the flags give.
//!
//! The targets are those of --target, else of build.target (--config, a value
//! or a file, CARGO_BUILD_TARGET, cargo's config files), else the host's.
//! Only those: cargo links build scripts and proc macros with the host's
//! linker unless the host's target is one of them. Before cargo runs, each
//! target's Rust standard library is added with rustup if it is missing, and
//! a vendor SDK a target needs is checked for.

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
    /// --config, each: KEY=VALUE, or a config file.
    configs: Vec<String>,
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
                inv.configs.push(c);
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

/// Calls f with each character of a line of TOML that is not in a string,
/// its offset and how deep in brackets it is, until f returns true; how deep
/// in brackets the line ends.
fn walk(text: &str, mut f: impl FnMut(usize, char, i32) -> bool) -> i32 {
    let mut quote = None;
    let mut escape = false;
    let mut depth = 0;
    for (i, c) in text.char_indices() {
        if let Some(q) = quote {
            if escape {
                escape = false;
            } else if c == '\\' && q == '"' {
                escape = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if f(i, c, depth) {
            break;
        }
        match c {
            '"' | '\'' => quote = Some(c),
            '[' | '{' => depth += 1,
            ']' | '}' => depth -= 1,
            _ => {}
        }
    }
    depth
}

/// Where c is in a line of TOML, out of its strings and brackets.
fn position(text: &str, c: char) -> Option<usize> {
    let mut at = None;
    walk(text, |i, x, depth| {
        if x == c && depth == 0 {
            at = Some(i);
        }
        at.is_some()
    });
    at
}

/// A line of TOML without its comment.
fn uncomment(line: &str) -> &str {
    let mut end = line.len();
    walk(line, |i, c, _| {
        if c == '#' {
            end = i;
        }
        c == '#'
    });
    &line[..end]
}

/// A TOML key as xclang cargo compares it: its parts without their quotes,
/// and no blanks between them.
fn toml_key(text: &str) -> String {
    let mut key = String::new();
    let mut quote = None;
    for c in text.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => key.push(c),
            None if c == '"' || c == '\'' => quote = Some(c),
            None if !c.is_whitespace() => key.push(c),
            None => {}
        }
    }
    key
}

/// The keys of a cargo config (TOML) with their values as written, in order:
/// `c = v` in [a.b] is a.b.c, and an inline table's entries are keys of their
/// own (`x = { value = "v" }` is x.value). Enough of TOML for cargo's
/// configs: no multi-line strings.
fn config_entries(text: &str) -> Vec<(String, String)> {
    // The byte order mark PowerShell 5 writes UTF-8 with, which TOML skips.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut entries = vec![];
    let mut table = String::new();
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let line = uncomment(line).trim();
        if line.starts_with('[') {
            // [table], or [[array of tables]].
            table = toml_key(line.trim_start_matches('[').trim_end_matches(']'));
            continue;
        }
        let Some(eq) = position(line, '=') else {
            continue;
        };
        let mut value = line[eq + 1..].to_string();
        // An array over several lines.
        while walk(&value, |_, _, _| false) > 0 {
            let Some(next) = lines.next() else { break };
            value.push(' ');
            value.push_str(uncomment(next));
        }
        let key = toml_key(&line[..eq]);
        let key = if table.is_empty() {
            key
        } else {
            format!("{table}.{key}")
        };
        add_entry(&mut entries, key, &value);
    }
    entries
}

/// Add key = value to entries, or for an inline table its entries, each as
/// key.<its key>.
fn add_entry(entries: &mut Vec<(String, String)>, key: String, value: &str) {
    let value = value.trim();
    let Some(table) = value.strip_prefix('{').and_then(|v| v.strip_suffix('}')) else {
        entries.push((key, value.to_string()));
        return;
    };
    let mut rest = table;
    while !rest.trim().is_empty() {
        let end = position(rest, ',').unwrap_or(rest.len());
        if let Some(eq) = position(&rest[..end], '=') {
            let name = format!("{key}.{}", toml_key(&rest[..eq]));
            add_entry(entries, name, &rest[eq + 1..end]);
        }
        rest = rest.get(end + 1..).unwrap_or("");
    }
}

/// The strings of a TOML value: "a", ["a", 'b'], with a basic string's
/// escapes read (\\, \", \n, \u00e9, ...).
fn strings(value: &str) -> Vec<String> {
    let mut out = vec![];
    let mut chars = value.chars();
    while let Some(quote) = chars.find(|c| *c == '"' || *c == '\'') {
        let mut s = String::new();
        loop {
            match chars.next() {
                Some(c) if c == quote => break,
                Some('\\') if quote == '"' => match chars.next() {
                    Some('n') => s.push('\n'),
                    Some('t') => s.push('\t'),
                    Some('r') => s.push('\r'),
                    Some(u @ ('u' | 'U')) => {
                        let digits = if u == 'u' { 4 } else { 8 };
                        let hex: String = chars.by_ref().take(digits).collect();
                        let code = u32::from_str_radix(&hex, 16).ok();
                        s.extend(code.and_then(char::from_u32));
                    }
                    Some(c) => s.push(c),
                    None => return out,
                },
                Some(c) => s.push(c),
                None => return out,
            }
        }
        out.push(s);
    }
    out
}

/// A list of strings as cargo reads one (rustflags): an array, or a string
/// of them between blanks.
fn string_list(value: &str) -> Vec<String> {
    let all = strings(value);
    if value.starts_with('[') {
        return all;
    }
    all.iter()
        .flat_map(|s| s.split_whitespace())
        .map(String::from)
        .collect()
}

/// One of cargo's configs: a config file, or a --config KEY=VALUE.
struct Config {
    /// Its keys and values (config_entries).
    entries: Vec<(String, String)>,
    /// What an [env] value with relative = true is relative to: a file's
    /// directory's parent (that of .cargo/), else the current directory.
    root: PathBuf,
    /// Of --config, which cargo puts before its environment.
    cli: bool,
}

impl Config {
    /// A config file's, at an absolute path; none if it cannot be read.
    fn read(file: &Path, cli: bool) -> Option<Config> {
        let text = fs::read_to_string(file).ok()?;
        let dir = file.parent()?;
        Some(Config {
            entries: config_entries(&text),
            root: dir.parent().unwrap_or(dir).to_path_buf(),
            cli,
        })
    }

    /// The value of a key.
    fn get(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

/// cargo's configs, from the one it gives way to most: $CARGO_HOME's config
/// file (`home`), those of cwd's parents, cwd's, each .cargo/config or else
/// .cargo/config.toml; then those of --config, in order, a file (a path to
/// one, or without =) or KEY=VALUE.
fn configs(inv: &Invocation, cwd: &Path, home: Option<PathBuf>) -> Vec<Config> {
    let canonical = |dir: &Path| fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let mut dirs: Vec<PathBuf> = cwd.ancestors().map(|d| d.join(".cargo")).collect();
    if let Some(home) = home
        && !dirs.iter().any(|d| canonical(d) == canonical(&home))
    {
        dirs.push(home);
    }
    let mut configs: Vec<Config> = dirs
        .iter()
        .rev()
        .filter_map(|dir| {
            let file = [dir.join("config"), dir.join("config.toml")]
                .into_iter()
                .find(|f| f.is_file())?;
            Config::read(&file, false)
        })
        .collect();
    for c in &inv.configs {
        let file = cwd.join(c);
        if file.is_file() || !c.contains('=') {
            configs.extend(Config::read(&file, true));
        } else {
            configs.push(Config {
                entries: config_entries(c),
                root: cwd.to_path_buf(),
                cli: true,
            });
        }
    }
    configs
}

/// The targets cargo builds for: --target's, else build.target, the last
/// --config's that has it, CARGO_BUILD_TARGET (`given`) or the nearest config
/// file's; none for the host's.
fn named_targets(inv: &Invocation, configs: &[Config], given: Option<String>) -> Vec<String> {
    if !inv.targets.is_empty() {
        return inv.targets.clone();
    }
    let last = |cli: bool| {
        configs
            .iter()
            .rev()
            .filter(|c| c.cli == cli)
            .find_map(|c| c.get("build.target"))
            .map(strings)
            .filter(|t| !t.is_empty())
    };
    last(true)
        .or_else(|| given.filter(|t| !t.is_empty()).map(|t| vec![t]))
        .or_else(|| last(false))
        .unwrap_or_default()
}

/// The [env] of the configs, which cargo gives build scripts and rustc:
/// each variable's value, that of the nearest config file or of a later
/// --config, and whether it is forced on them (force = true); a value with
/// relative = true is a path relative to its config's root.
fn config_env(configs: &[Config]) -> Vec<(String, OsString, bool)> {
    let mut vars: Vec<(String, OsString, bool)> = vec![];
    for c in configs {
        for (key, _) in &c.entries {
            let Some(name) = key.strip_prefix("env.").and_then(|k| k.split('.').next()) else {
                continue;
            };
            let field = |f: &str| c.get(&format!("env.{name}.{f}"));
            let Some(value) = c
                .get(&format!("env.{name}"))
                .or_else(|| field("value"))
                .and_then(|v| strings(v).pop())
            else {
                continue;
            };
            let value = if field("relative") == Some("true") {
                c.root.join(value).into_os_string()
            } else {
                value.into()
            };
            vars.retain(|(n, ..)| n != name);
            vars.push((name.to_string(), value, field("force") == Some("true")));
        }
    }
    vars
}

/// build.rustflags as cargo reads it: a config's array joined to what those
/// before have, a string's flags in their place; the config files' first,
/// then CARGO_BUILD_RUSTFLAGS's (`given`), then --config's.
fn build_rustflags(configs: &[Config], given: Option<&str>) -> Vec<String> {
    let mut flags: Vec<(bool, String)> = vec![];
    for c in configs {
        if let Some(value) = c.get("build.rustflags") {
            if !value.starts_with('[') {
                flags.clear();
            }
            flags.extend(string_list(value).into_iter().map(|f| (c.cli, f)));
        }
    }
    // After the config files', before --config's.
    let at = flags.iter().filter(|(cli, _)| !cli).count();
    let given = given.unwrap_or_default().split_whitespace();
    flags.splice(at..at, given.map(|f| (false, f.to_string())));
    flags.into_iter().map(|(_, f)| f).collect()
}

/// CARGO_TARGET_<T>_RUSTFLAGS for an MSVC target: -Ctarget-feature=+crt-static
/// after the flags cargo would take without it; none if they name crt-static.
/// cargo takes a target's rustflags from the first of RUSTFLAGS, the
/// target's (the variable's, `given`, joined to the configs'
/// target.<T>.rustflags and those of each target.'cfg(...)' that matches,
/// which xclang cargo takes all to match) and build.rustflags (`build` is
/// CARGO_BUILD_RUSTFLAGS): with no rustflags of the target, the variable
/// would drop build.rustflags, so it has them.
fn msvc_rustflags(
    t: &Target,
    configs: &[Config],
    given: Option<&str>,
    build: Option<&str>,
) -> Option<String> {
    let key = format!("target.{}.rustflags", t.rust);
    let target: Vec<String> = configs
        .iter()
        .flat_map(|c| &c.entries)
        .filter(|(k, _)| *k == key || (k.starts_with("target.cfg(") && k.ends_with(".rustflags")))
        .flat_map(|(_, v)| string_list(v))
        .collect();
    let flags = match given.filter(|g| !g.trim().is_empty()) {
        Some(given) => given.to_string(),
        None if target.is_empty() => build_rustflags(configs, build).join(" "),
        None => String::new(),
    };
    if flags.contains("crt-static") || target.iter().any(|f| f.contains("crt-static")) {
        return None;
    }
    let flags = format!("{flags} -Ctarget-feature=+crt-static");
    Some(flags.trim().to_string())
}

fn home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where xclang cargo keeps the linkers and CMake toolchain files of a
/// toolchain: $XCLANG_CACHE_DIR, or the user's cache directory, then
/// cargo/<a hash of the toolchain's path>; absolute, as CMake would take a
/// relative toolchain file to be in its build directory. getenv gives the
/// environment's variables; one that is empty is unset, as XDG has it.
fn cache_dir(root: &Path, getenv: impl Fn(&str) -> Option<OsString>) -> Result<PathBuf> {
    let var = |name: &str| getenv(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let home = || var(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let base = match var("XCLANG_CACHE_DIR") {
        Some(dir) => dir,
        None => {
            let user = if cfg!(windows) {
                var("LOCALAPPDATA")
            } else if cfg!(target_os = "macos") {
                home().map(|h| h.join("Library").join("Caches"))
            } else {
                var("XDG_CACHE_HOME").or_else(|| home().map(|h| h.join(".cache")))
            };
            let Some(user) = user else {
                bail!("no cache directory: set XCLANG_CACHE_DIR")
            };
            user.join("xclang")
        }
    };
    let base = std::path::absolute(&base).context(base.display())?;
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
fn toolchain_file(root: &Path, cmake: &Path, t: &Target, platform: bool) -> String {
    let mut text = format!(
        "# xclang cargo: the cmake crate's toolchain file for {}\n\
         set(XCLANG_ROOT \"{}\")\n\
         set(XCLANG_TARGET {})\n",
        t.rust,
        cmake_path(root),
        t.triple
    );
    if platform {
        text.push_str("set(XCLANG_STDLIB platform)\n");
    }
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
fn search_dirs(clang: &Path, t: &Target, platform: bool, language: &str) -> Result<Vec<String>> {
    let mut c = Command::new(clang);
    c.arg(format!("--target={}", t.triple));
    if platform {
        c.arg("-stdlib=platform");
    }
    c.args(["-E", "-x", language, "-", "-v"])
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
fn bindgen_args(root: &Path, t: &Target, platform: bool) -> Result<String> {
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
    let (c_before, c_after) = split(search_dirs(&clang, t, platform, "c")?);
    let (cxx_before, _) = split(search_dirs(&clang, t, platform, "c++")?);
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

/// The environment of cargo: the variables xclang cargo sets, over this
/// process's. get sees the configs' [env] too, as cargo gives it to build
/// scripts and rustc (so the linker): where the environment lacks a
/// variable, or with force = true in its place.
struct Env {
    vars: Vec<(OsString, OsString)>,
    /// [env]'s: name, value, force (config_env).
    config: Vec<(String, OsString, bool)>,
}

impl Env {
    fn get(&self, name: &str) -> Option<OsString> {
        let config = |force: bool| {
            self.config
                .iter()
                .find(|(n, _, f)| n == name && *f == force)
                .map(|(_, v, _)| v.clone())
        };
        config(true)
            .or_else(|| {
                self.vars
                    .iter()
                    .rev()
                    .find(|(n, _)| n == name)
                    .map(|(_, v)| v.clone())
            })
            .or_else(|| env::var_os(name))
            .or_else(|| config(false))
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

    /// Set <prefix>_<target>, in both spellings, to what the cc crate takes
    /// of its variables, the first of <prefix>_<target>, <side>_<prefix> and
    /// <prefix> that is set, followed by value. side is TARGET, or HOST for
    /// the host's target, for which the cc crate reads HOST_<prefix>.
    fn append_for(&mut self, prefix: &str, t: &Target, side: &str, value: &str) {
        let names = [
            format!("{prefix}_{}", t.rust),
            format!("{prefix}_{}", t.rust.replace('-', "_")),
        ];
        let given = names
            .iter()
            .cloned()
            .chain([format!("{side}_{prefix}"), prefix.to_string()])
            .find_map(|n| self.get(&n))
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default();
        let joined = format!("{given} {value}");
        for name in names {
            self.set(name, joined.trim());
        }
    }
}

/// XCLANG_STDLIB, its value: libc++ (the default), xclang's; platform, the
/// platform's C++ library (-stdlib=platform, patches/0018).
pub fn platform_stdlib(value: Option<&OsStr>) -> Result<bool> {
    match value.map(OsStr::to_string_lossy).as_deref() {
        None | Some("" | "libc++") => Ok(false),
        Some("platform") => Ok(true),
        Some(other) => bail!("XCLANG_STDLIB is {other}, not libc++ or platform"),
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
    let cwd = env::current_dir().context("the current directory")?;
    let cargo_home = env::var_os("CARGO_HOME")
        .map(|h| cwd.join(h))
        .or_else(|| home().map(|h| h.join(".cargo")));
    let configs = configs(&inv, &cwd, cargo_home);
    let mut e = Env {
        vars: vec![],
        config: config_env(&configs),
    };
    let platform = platform_stdlib(e.get("XCLANG_STDLIB").as_deref())?;
    let toolchain = Toolchain::find(None)?;
    let root = toolchain.root;
    let bin = root.join("bin");
    let tool = |name: &str| bin.join(format!("{name}{}", env::consts::EXE_SUFFIX));

    let host = host(&inv);
    let mut named = named_targets(&inv, &configs, env::var("CARGO_BUILD_TARGET").ok());
    if named.is_empty() {
        match &host {
            Ok(h) => named.push(h.clone()),
            Err(err) => bail!("{err}"),
        }
    }
    let host = host.ok();
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

    let cache = cache_dir(&root, |name: &str| env::var_os(name))?;
    fs::create_dir_all(&cache).context(cache.display())?;
    let path = env::var_os("PATH").unwrap_or_default();
    let path = env::join_paths(std::iter::once(bin.clone()).chain(env::split_paths(&path)))
        .context("PATH")?;
    e.set("PATH", path);
    // The toolchain found, by its absolute path: rustc runs the linker in
    // another directory.
    e.set("XCLANG_ROOT", &root);
    for t in &targets {
        let upper = t.rust.to_uppercase().replace('-', "_");
        let lower = t.rust.replace('-', "_");
        let var = |prefix: &str| format!("{prefix}_{lower}");
        // The cc and cmake crates read HOST_* for the host's target.
        let side = if host.as_deref() == Some(t.rust) {
            "HOST"
        } else {
            "TARGET"
        };
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
            let stdlib = if platform && t.kind != Kind::Darwin {
                "stdc++"
            } else {
                "c++"
            };
            e.default_for("CXXSTDLIB", t, stdlib);
        }
        if platform {
            for prefix in ["CFLAGS", "CXXFLAGS"] {
                e.append_for(prefix, t, side, "-stdlib=platform");
            }
        }
        let cmake = root
            .join("lib")
            .join("cmake")
            .join("xclang")
            .join("toolchain.cmake");
        if cmake.is_file() {
            let file = cache.join(format!("{}-toolchain.cmake", t.rust));
            write(&file, &toolchain_file(&root, &cmake, t, platform))?;
            e.default(
                &var("CMAKE_TOOLCHAIN_FILE"),
                &[
                    &format!("CMAKE_TOOLCHAIN_FILE_{}", t.rust),
                    &format!("{side}_CMAKE_TOOLCHAIN_FILE"),
                    "CMAKE_TOOLCHAIN_FILE",
                ],
                cmake_path(&file),
            );
        }
        // The cmake crate takes Visual Studio's generator for MSVC targets,
        // and on Windows for the others too, which compiles with cl: on
        // Windows, without Ninja, there is no other.
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
                    &format!("{side}_CMAKE_GENERATOR"),
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
        let mut value = bindgen_args(&root, t, platform)?;
        if let Some(given) = given {
            value.push(' ');
            value.push_str(&given.to_string_lossy());
        }
        e.set(format!("BINDGEN_EXTRA_CLANG_ARGS_{}", t.rust), &value);
        e.set(bindgen, value);
        if t.kind == Kind::Msvc {
            // cargo's own variables, which [env] does not set.
            let name = format!("CARGO_TARGET_{upper}_RUSTFLAGS");
            let given = env::var(&name).ok();
            let build = env::var("CARGO_BUILD_RUSTFLAGS").ok();
            if let Some(flags) = msvc_rustflags(t, &configs, given.as_deref(), build.as_deref()) {
                e.set(name, flags);
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
            "--config=ci.toml",
            "tree",
        ]);
        assert_eq!(inv.subcommand.as_deref(), Some("tree"));
        assert_eq!(inv.configs, ["build.target=[\"a\", 'b']", "ci.toml"]);
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

    fn config(text: &str, cli: bool) -> Config {
        Config {
            entries: config_entries(text),
            root: PathBuf::from("/p"),
            cli,
        }
    }

    fn strs(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn config_files() {
        let text = r##"
build.jobs = 4 # a comment
[build]
target = "x86_64-pc-windows-gnullvm" # Windows
rustflags = [
  "-Cx=#1",
  '-Cy', # two
]
[ target.'cfg(target_os = "windows")' ]
rustflags = "-Ca  -Cb"
[target."x86_64-pc-windows-msvc"]
linker = "C:\\a b\\link.exe"
[env]
A = { value = "a", relative = true, force = true }
"B" = 'b\n'
[env.C]
value = "\u00e9\""
[[bin]]
name = "x"
"##;
        let c = config(text, false);
        let get = |key: &str| c.get(key).map(strings);
        assert_eq!(c.get("build.jobs"), Some("4"));
        assert_eq!(
            get("build.target"),
            Some(strs(&["x86_64-pc-windows-gnullvm"]))
        );
        assert_eq!(
            c.get("build.rustflags").map(string_list),
            Some(strs(&["-Cx=#1", "-Cy"]))
        );
        assert_eq!(
            c.get("target.cfg(target_os = \"windows\").rustflags")
                .map(string_list),
            Some(strs(&["-Ca", "-Cb"]))
        );
        assert_eq!(
            get("target.x86_64-pc-windows-msvc.linker"),
            Some(strs(&[r"C:\a b\link.exe"]))
        );
        assert_eq!(get("env.A.value"), Some(strs(&["a"])));
        assert_eq!(c.get("env.A.relative"), Some("true"));
        assert_eq!(c.get("env.A.force"), Some("true"));
        assert_eq!(get("env.B"), Some(strs(&[r"b\n"])));
        assert_eq!(get("env.C.value"), Some(strs(&["\u{e9}\""])));
        assert_eq!(get("bin.name"), Some(strs(&["x"])));
        assert_eq!(c.get("build.name"), None);
        // A byte order mark, which TOML skips.
        let bom = config("\u{feff}build.target = 'x'\n", false);
        assert_eq!(bom.get("build.target"), Some("'x'"));
        let other = config("[env]\ntarget = \"x\"\n", false);
        assert_eq!(other.get("build.target"), None);
    }

    #[test]
    fn config_sources() {
        let dir = env::temp_dir().join(format!("xclang-cargo-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let work = dir.join("w");
        let project = work.join("p");
        let home = dir.join("h");
        for d in [project.join(".cargo"), work.join(".cargo"), home.clone()] {
            fs::create_dir_all(d).unwrap();
        }
        let fixtures = [
            ("h/config.toml", "[env.H]\nvalue = 'h'\nrelative = true"),
            ("w/.cargo/config", "[build]\ntarget = 'w'\n"),
            ("w/.cargo/config.toml", "[build]\ntarget = 'unread'\n"),
            ("w/p/.cargo/config.toml", "build.target = 'p'\n"),
            ("w/p/ci.toml", "\u{feff}[build]\ntarget = 'file'\n"),
        ];
        for (file, text) in fixtures {
            fs::write(dir.join(file), text).unwrap();
        }
        let inv = parse(&[
            "build",
            "--config",
            "build.target='kv'",
            "--config",
            "ci.toml",
        ]);
        // The test's, not those of a .cargo/ above the temporary directory.
        let ours: Vec<Config> = configs(&inv, &project, Some(home.clone()))
            .into_iter()
            .filter(|c| c.root.starts_with(&dir))
            .collect();
        let seen: Vec<(Option<&str>, &Path, bool)> = ours
            .iter()
            .map(|c| (c.get("build.target"), c.root.as_path(), c.cli))
            .collect();
        assert_eq!(
            seen,
            [
                (None, dir.as_path(), false),
                (Some("'w'"), work.as_path(), false),
                (Some("'p'"), project.as_path(), false),
                (Some("'kv'"), project.as_path(), true),
                (Some("'file'"), work.as_path(), true),
            ]
        );
        let given = || Some("e".to_string());
        assert_eq!(named_targets(&inv, &ours, given()), ["file"]);
        let files: Vec<Config> = ours.into_iter().filter(|c| !c.cli).collect();
        assert_eq!(named_targets(&inv, &files, given()), ["e"]);
        assert_eq!(named_targets(&inv, &files, None), ["p"]);
        let inv = parse(&["build", "--target", "t"]);
        assert_eq!(named_targets(&inv, &files, given()), ["t"]);
        assert_eq!(
            config_env(&files),
            [("H".to_string(), dir.join("h").into_os_string(), false)]
        );
        // $CARGO_HOME read once, as one of the directories'.
        let once = configs(&inv, &project, Some(work.join(".cargo")));
        assert_eq!(once.iter().filter(|c| c.root == work).count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn env_table() {
        let home = config(
            "[env]\nXCLANG_TEST_A = 'home'\nXCLANG_TEST_B = 'home'\n",
            false,
        );
        let project = config(
            "[env]\nXCLANG_TEST_B = { value = 'b', relative = true }\n\
             XCLANG_TEST_C = { value = 'c', force = true }\nPATH = 'p'\n",
            false,
        );
        let cli = config("env.XCLANG_TEST_A = \"cli\"", true);
        let vars = config_env(&[home, project, cli]);
        let b = Path::new("/p").join("b").into_os_string();
        assert_eq!(
            vars,
            [
                ("XCLANG_TEST_B".to_string(), b, false),
                ("XCLANG_TEST_C".to_string(), "c".into(), true),
                ("PATH".to_string(), "p".into(), false),
                ("XCLANG_TEST_A".to_string(), "cli".into(), false),
            ]
        );
        let mut e = Env {
            vars: vec![],
            config: vars,
        };
        let get = |e: &Env, name: &str| e.get(name).map(|v| v.to_string_lossy().into_owned());
        assert_eq!(get(&e, "XCLANG_TEST_A").as_deref(), Some("cli"));
        // The environment's first, but for force = true.
        assert_ne!(get(&e, "PATH").as_deref(), Some("p"));
        e.set("XCLANG_TEST_A", "set");
        e.set("XCLANG_TEST_C", "set");
        assert_eq!(get(&e, "XCLANG_TEST_A").as_deref(), Some("set"));
        assert_eq!(get(&e, "XCLANG_TEST_C").as_deref(), Some("c"));
        assert_eq!(get(&e, "XCLANG_TEST_D"), None);

        assert!(!platform_stdlib(None).unwrap());
        assert!(!platform_stdlib(Some(OsStr::new("libc++"))).unwrap());
        assert!(platform_stdlib(Some(OsStr::new("platform"))).unwrap());
        assert!(platform_stdlib(Some(OsStr::new("gnu"))).is_err());
        let forced = config(
            "[env]\nXCLANG_STDLIB = { value = 'platform', force = true }\n",
            false,
        );
        let e = Env {
            vars: vec![],
            config: config_env(&[forced]),
        };
        assert!(platform_stdlib(e.get("XCLANG_STDLIB").as_deref()).unwrap());
    }

    #[test]
    fn host_flags() {
        let t = find("x86_64-unknown-linux-gnu").unwrap();
        // The cc crate's flags for t when it is the host's, or not.
        let flags = |side: &str| {
            let target = config("[env]\nTARGET_XCLANG_TEST_FLAGS = '-Dt'\n", false);
            let mut e = Env {
                vars: vec![],
                config: config_env(&[target]),
            };
            e.set("HOST_XCLANG_TEST_FLAGS", "-Dh");
            e.append_for("XCLANG_TEST_FLAGS", t, side, "-x");
            let get = |n: &str| e.get(n).map(|v| v.to_string_lossy().into_owned());
            (
                get("XCLANG_TEST_FLAGS_x86_64-unknown-linux-gnu"),
                get("XCLANG_TEST_FLAGS_x86_64_unknown_linux_gnu"),
            )
        };
        assert_eq!(
            flags("HOST"),
            (Some("-Dh -x".into()), Some("-Dh -x".into()))
        );
        assert_eq!(
            flags("TARGET"),
            (Some("-Dt -x".into()), Some("-Dt -x".into()))
        );
    }

    #[test]
    fn msvc_flags() {
        let t = find("x86_64-pc-windows-msvc").unwrap();
        let file = |text: &str| config(text, false);
        let flags = |configs: &[Config], given: Option<&str>, build: Option<&str>| {
            msvc_rustflags(t, configs, given, build)
        };
        let crt = "-Ctarget-feature=+crt-static";
        assert_eq!(flags(&[], None, None).as_deref(), Some(crt));
        // build.rustflags, which the variable would drop: arrays joined, the
        // files', CARGO_BUILD_RUSTFLAGS's, --config's; a string in place of
        // those before it.
        let build = [
            file("[build]\nrustflags = ['-Ch']\n"),
            file("build.rustflags = [\"-Cp\"]\n"),
            config("build.rustflags=['-Cc']", true),
        ];
        assert_eq!(
            flags(&build, None, Some(" -Ce1  -Ce2")),
            Some(format!("-Ch -Cp -Ce1 -Ce2 -Cc {crt}"))
        );
        let replaced = [
            file("build.rustflags = '-Ch'\n"),
            file("[build]\nrustflags = '-Cp1  -Cp2'\n"),
        ];
        assert_eq!(
            flags(&replaced, None, Some("-Ce")),
            Some(format!("-Cp1 -Cp2 -Ce {crt}"))
        );
        // The target's, which cargo joins to the variable: the variable's
        // (if not blank), the configs' and cfg(...)'s.
        assert_eq!(flags(&build, Some("-Cv"), None), Some(format!("-Cv {crt}")));
        assert_eq!(
            flags(&build, Some(" "), None),
            Some(format!("-Ch -Cp -Cc {crt}"))
        );
        let target = [file(
            "[build]\nrustflags = ['-Cb']\n\
             [target.x86_64-pc-windows-msvc]\nrustflags = ['-Ct']\n",
        )];
        assert_eq!(flags(&target, None, Some("-Ce")).as_deref(), Some(crt));
        let cfg = [file(
            "[build]\nrustflags = ['-Cb']\n\
             [target.'cfg(windows)']\nrustflags = '-Cw'\n",
        )];
        assert_eq!(flags(&cfg, None, None).as_deref(), Some(crt));
        // None of the target's: empty, or another target's.
        let other = [file(
            "[target.x86_64-pc-windows-msvc]\nrustflags = []\n\
             [target.aarch64-pc-windows-msvc]\nrustflags = ['-Co']\n\
             [build]\nrustflags = ['-Cb']\n",
        )];
        assert_eq!(flags(&other, None, None), Some(format!("-Cb {crt}")));
        // crt-static named already.
        let off = "-Ctarget-feature=-crt-static";
        assert_eq!(flags(&[], Some(off), None), None);
        let text = format!("[target.x86_64-pc-windows-msvc]\nrustflags = ['{off}']");
        assert_eq!(flags(&[file(&text)], None, None), None);
        assert_eq!(flags(&[], None, Some(crt)), None);
    }

    #[test]
    fn cache_dirs() {
        let root = Path::new("/opt/xclang");
        let dir = |vars: &[(&str, &str)]| {
            cache_dir(root, |name: &str| {
                vars.iter()
                    .find(|(n, _)| *n == name)
                    .map(|(_, v)| OsString::from(v))
            })
        };
        // Absolute, as CMake would read a relative toolchain file elsewhere.
        let cwd = env::current_dir().unwrap();
        let relative = dir(&[("XCLANG_CACHE_DIR", "c")]).unwrap();
        assert!(relative.is_absolute());
        assert!(relative.starts_with(cwd.join("c").join("cargo")));
        // An empty variable is unset.
        let empty = [
            ("XCLANG_CACHE_DIR", ""),
            ("XDG_CACHE_HOME", ""),
            ("LOCALAPPDATA", ""),
        ];
        assert!(dir(&empty).is_err());
        if cfg!(unix) {
            let user = if cfg!(target_os = "macos") {
                "/h/Library/Caches/xclang/cargo"
            } else {
                "/h/.cache/xclang/cargo"
            };
            let home = [
                ("XCLANG_CACHE_DIR", ""),
                ("XDG_CACHE_HOME", ""),
                ("HOME", "/h"),
            ];
            assert!(dir(&home).unwrap().starts_with(user));
        }
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
