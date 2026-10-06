//! `xclang`, the toolchain's own command: fetches what the toolchain does
//! not carry. Vendor SDKs come from the vendors themselves, pinned by
//! sha256 (`xclang sdk`); more targets come from the release's index of
//! target archives (`xclang target`).

mod args;
mod http;
mod links;
mod macos;
mod pkg;
mod sdk;
mod table;
mod target;
mod toolchain;
#[cfg(feature = "maintainer")]
mod update;
mod windows;
mod xml;
mod zip;

use std::fmt::Display;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// The release this program was built for (cli/cli.ts sets it), or the
/// crate's version for a build by hand.
pub const VERSION: &str = match option_env!("XCLANG_VERSION") {
    Some(v) => v,
    None => concat!(env!("CARGO_PKG_VERSION"), "-dev"),
};

#[derive(Debug)]
pub struct Error(pub String);

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error(e.to_string())
    }
}

impl From<ureq::Error> for Error {
    fn from(e: ureq::Error) -> Self {
        Error(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error(e.to_string())
    }
}

impl From<lexopt::Error> for Error {
    fn from(e: lexopt::Error) -> Self {
        Error(e.to_string())
    }
}

#[macro_export]
macro_rules! bail {
    ($($t:tt)*) => { return Err($crate::Error(format!($($t)*))) };
}

/// What failed, said with what it was doing: "<what>: <error>".
pub trait Context<T> {
    fn context(self, what: impl Display) -> Result<T>;
}

impl<T, E: Display> Context<T> for std::result::Result<T, E> {
    fn context(self, what: impl Display) -> Result<T> {
        self.map_err(|e| Error(format!("{what}: {e}")))
    }
}

/// f of every item, on up to `jobs` threads, in the items' order; the first
/// error (by position) if any failed.
pub fn parallel<T: Sync, R: Send>(
    items: &[T],
    jobs: usize,
    f: impl Fn(&T) -> Result<R> + Sync,
) -> Result<Vec<R>> {
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<Result<R>>>> = Mutex::new(items.iter().map(|_| None).collect());
    std::thread::scope(|s| {
        for _ in 0..jobs.clamp(1, items.len().max(1)) {
            s.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= items.len() {
                        break;
                    }
                    let r = f(&items[i]);
                    results.lock().unwrap()[i] = Some(r);
                }
            });
        }
    });
    results
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.unwrap())
        .collect()
}

/// How many threads unpack: $XCLANG_JOBS, or one per CPU.
pub fn cpus() -> usize {
    match std::env::var("XCLANG_JOBS")
        .ok()
        .and_then(|j| j.parse().ok())
    {
        Some(jobs) if jobs > 0 => jobs,
        _ => std::thread::available_parallelism().map_or(4, |n| n.get()),
    }
}

/// Megabytes, as the vendors count them.
pub fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1e6)
}

const USAGE: &str = "\
xclang: fetches what the toolchain does not carry.

  xclang sdk list [macos|windows]
      the vendor SDKs xclang knows (presets from GitHub's runner images,
      every version), and those fetched
  xclang sdk fetch macos --accept-license [--preset P] [--version V]
      Apple's macOS SDK, from Apple, which the toolchain's macOS targets
      then use on Linux and Windows: clang++ --target=arm64-apple-macos
      (on macOS they use Xcode's; this one with
      -isysroot \"$(xclang sdk path macos)\")
  xclang sdk fetch windows --accept-license [--preset P] [--msvc-version V]
          [--sdk-version V] [--arch x86_64,aarch64,x86]
      the MSVC runtime and STL and the Windows SDK, from Microsoft, as a
      /winsysroot, which the toolchain's MSVC targets then use:
      clang++ --target=x86_64-pc-windows-msvc, clang-cl
  xclang sdk path macos|windows [the options of fetch]
      where the SDK fetch would fetch is
  xclang sdk use <name>
      use another fetched SDK of its vendor (fetch uses the one it fetched)
  xclang sdk remove <name>
      remove a fetched SDK (its name as sdk list shows it)
  xclang target list
      the targets of this release: built in, and those to add
  xclang target add <target>...
  xclang target remove <target>...
      add a target's archive to the toolchain, or remove it

Options:
  --preset P         a GitHub runner image or its label (windows-2022,
                     macos-15, ...); default windows-latest, macos-latest
  --version V        (macOS) the SDK version, whole or in part (26, 15.5)
  --msvc-version V   (Windows) MSVC's version, whole or in part (14.44)
  --sdk-version V    (Windows) the Windows SDK's version (10.0.26100)
  --arch A,...       (Windows) x86_64, aarch64, x86; default x86_64,aarch64
  --cache DIR        keep downloads in DIR (and take them from there)
  --links L          (macOS) symlink, junction or copy; default junction on
                     Windows, symlink elsewhere
  --sdk-dir DIR      where SDKs go: default <toolchain>/sdk ($XCLANG_SDK_DIR)
  --index URL        the target index: default this release's on GitHub
                     ($XCLANG_TARGET_INDEX); a URL or a file
  --root DIR         the toolchain: default the one this program is in
                     ($XCLANG_ROOT)
  --force            (target add) overwrite files that are not the target's
  -h, --help         this text
  -V, --version      the versions of this program and of the toolchain

Requests carry the User-Agent xclang/<version> and nothing else about you.
HTTPS_PROXY, HTTP_PROXY, ALL_PROXY and NO_PROXY are honoured; certificates
are checked against the system's trust store.
";

fn main() {
    // Quietly end when what reads the output goes away (xclang ... | head),
    // as C programs do, rather than fail on the next write.
    #[cfg(unix)]
    {
        unsafe extern "C" {
            fn signal(signal: i32, handler: usize) -> usize;
        }
        // SAFETY: SIGPIPE (13 on Linux and macOS) back to its default, SIG_DFL.
        unsafe { signal(13, 0) };
    }
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut a = args::Args::parse()?;
    if a.flag("version") {
        return version(&a);
    }
    let words: Vec<&str> = a.words.iter().map(String::as_str).collect();
    if a.flag("help") || words.is_empty() || words == ["help"] {
        print!("{USAGE}");
        return Ok(());
    }
    match words[..] {
        ["version"] => version(&a),
        ["sdk", ..] => sdk::main(&mut a),
        ["target", ..] => target::main(&mut a),
        _ => bail!("unknown command {}; see xclang --help", words.join(" ")),
    }
}

fn version(a: &args::Args) -> Result<()> {
    println!("xclang {VERSION}");
    match toolchain::Toolchain::find(a.value("root")) {
        Ok(t) => {
            println!("toolchain: {}", t.root.display());
            // The release whose targets `target add` takes.
            println!("release: {}", t.release().unwrap_or("unknown"));
        }
        Err(e) => println!("toolchain: none ({e})"),
    }
    Ok(())
}
