//! Downloads: over HTTPS, or from a file (a URL without a scheme, or
//! file://), each pinned download checked against its size and sha256.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use ureq::tls::{RootCerts, TlsConfig};

use crate::{Context, Result, bail, mb};

pub fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        // The proxy comes from the environment (ureq's default config reads
        // ALL_PROXY, HTTPS_PROXY, HTTP_PROXY and NO_PROXY).
        ureq::Agent::config_builder()
            // Only what the program is: no name, address or host.
            .user_agent(format!("xclang/{}", crate::VERSION))
            .tls_config(TlsConfig::builder().root_certs(roots()).build())
            .timeout_connect(Some(Duration::from_secs(30)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .build()
            .into()
    })
}

/// The system's trust store (macOS' and Windows' own verifiers, the CA
/// files of a Linux system), so that a CA a company adds is trusted too;
/// Mozilla's roots on a Linux system without CA certificates (a bare
/// container).
fn roots() -> RootCerts {
    #[cfg(target_os = "linux")]
    if rustls_native_certs::load_native_certs().certs.is_empty() {
        return RootCerts::WebPki;
    }
    RootCerts::PlatformVerifier
}

/// The file a URL names, if it names one: a path, or file://<path>.
pub fn local_path(url: &str) -> Option<PathBuf> {
    if let Some(path) = url.strip_prefix("file://") {
        // file:///C:/dir on Windows.
        let path = match path.as_bytes() {
            [b'/', _, b':', ..] if cfg!(windows) => &path[1..],
            _ => path,
        };
        return Some(PathBuf::from(path));
    }
    (!url.contains("://")).then(|| PathBuf::from(url))
}

pub struct Body {
    pub reader: Box<dyn Read + Send>,
    pub length: Option<u64>,
}

pub fn open(url: &str) -> Result<Body> {
    if let Some(path) = local_path(url) {
        let file = File::open(&path).context(path.display())?;
        let length = file.metadata()?.len();
        return Ok(Body {
            reader: Box::new(file),
            length: Some(length),
        });
    }
    let response = agent().get(url).call().context(url)?;
    let length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok()?.parse().ok());
    // The reader fails when the connection ends before Content-Length.
    Ok(Body {
        reader: Box::new(response.into_body().into_reader()),
        length,
    })
}

/// A whole (small) document.
pub fn get(url: &str) -> Result<Vec<u8>> {
    let mut body = open(url)?;
    let mut data = Vec::with_capacity(body.length.unwrap_or(0) as usize);
    body.reader.read_to_end(&mut data).context(url)?;
    Ok(data)
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).context(path.display())?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = vec![0; 1 << 20];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => ctx.update(&buf[..n]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => bail!("{}: {e}", path.display()),
        }
    }
    Ok(hex(ctx.finish().as_ref()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The file at dest if it has the pinned sha256, else downloaded anew. A
/// download now and then comes short or damaged: three tries.
pub fn fetch_pinned(url: &str, sha256: &str, size: Option<u64>, dest: &Path) -> Result<()> {
    if dest.is_file() && sha256_file(dest)? == sha256 {
        eprintln!("{}: already downloaded", dest.display());
        return Ok(());
    }
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).context(dir.display())?;
    }
    let mut failure = String::new();
    for attempt in 1..=3 {
        match download(url, dest, size) {
            Ok((got, _)) if got == sha256 => return Ok(()),
            Ok((got, _)) => {
                let _ = fs::remove_file(dest);
                failure = format!("{url}: sha256 {got}, expected {sha256}");
            }
            Err(e) => failure = e.0,
        }
        if attempt < 3 {
            eprintln!("{failure}; trying again");
            std::thread::sleep(Duration::from_secs(2 << attempt));
        }
    }
    bail!("{failure}")
}

/// Stream url to dest; its sha256 and size. Short of the expected size, it
/// fails.
pub fn download(url: &str, dest: &Path, size: Option<u64>) -> Result<(String, u64)> {
    let name = url.rsplit('/').next().unwrap_or(url);
    let mut part = dest.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let mut body = open(url)?;
    let total = size.or(body.length);
    let mut out = File::create(&part).context(part.display())?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = vec![0; 1 << 20];
    let (start, mut last, mut done) = (Instant::now(), Instant::now(), 0u64);
    let result = loop {
        match body.reader.read(&mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => {
                out.write_all(&buf[..n]).context(part.display())?;
                ctx.update(&buf[..n]);
                done += n as u64;
                if last.elapsed() > Duration::from_secs(5) {
                    last = Instant::now();
                    eprintln!("  {name}: {} of {}", mb(done), total.map_or("?".into(), mb));
                }
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => break Err(e),
        }
    };
    drop(out);
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        bail!("{url}: {e} after {}", mb(done));
    }
    if let Some(want) = size.filter(|&want| want != done) {
        let _ = fs::remove_file(&part);
        bail!("{url}: {done} bytes, expected {want}");
    }
    fs::rename(&part, dest).context(dest.display())?;
    eprintln!(
        "downloaded {name}, {} in {:.1} s",
        mb(done),
        start.elapsed().as_secs_f64()
    );
    Ok((hex(ctx.finish().as_ref()), done))
}

/// The location of `relative` next to the document at `base`, a URL or a
/// file; a URL stays as it is.
pub fn resolve(base: &str, relative: &str) -> String {
    if relative.contains("://") {
        return relative.to_string();
    }
    match local_path(base) {
        Some(path) => path
            .parent()
            .unwrap_or(Path::new(""))
            .join(relative)
            .to_string_lossy()
            .into_owned(),
        None => format!(
            "{}/{relative}",
            &base[..base.rfind('/').unwrap_or(base.len())]
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations() {
        assert_eq!(
            resolve("https://example.com/a/index.json", "t.tar.xz"),
            "https://example.com/a/t.tar.xz"
        );
        assert_eq!(
            resolve("https://example.com/a/index.json", "https://x/y"),
            "https://x/y"
        );
        assert_eq!(
            local_path("dir/index.json"),
            Some(PathBuf::from("dir/index.json"))
        );
        assert_eq!(
            local_path("file:///tmp/i.json"),
            Some(PathBuf::from("/tmp/i.json"))
        );
        assert_eq!(local_path("https://example.com/i.json"), None);
        assert_eq!(
            resolve("dir/index.json", "t.tar.xz"),
            Path::new("dir").join("t.tar.xz").to_string_lossy()
        );
    }
}
