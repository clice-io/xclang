//! Apple's software update catalogs: the Command Line Tools packages that
//! carry a macOS SDK, as Apple lists them now. `sdk update-table` adds them
//! to the version table; `sdk fetch` looks there for an SDK whose package
//! Apple withdrew, and for the newest one (--version latest).

use std::io::Read;

use crate::xml::{self, Plist};
use crate::{Context, Result, http};

/// The catalogs, one per macOS release: each lists the Command Line Tools
/// for that release and those before it.
const CATALOG_TAIL: &str = "10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz";
const CATALOG_HEADS: [&str; 7] = [
    "27-26-15-14-13-12-",
    "26-15-14-13-12-",
    "15-14-13-12-",
    "14-13-12-",
    "13-12-",
    "12-",
    "",
];
const OLD_CATALOGS: [&str; 2] = [
    "https://swscan.apple.com/content/catalogs/others/index-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
    "https://swscan.apple.com/content/catalogs/others/index-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz",
];

/// A package a catalog lists.
#[derive(Clone, Debug)]
pub struct Listed {
    pub url: String,
    pub product: String,
    /// The product's PostDate, 2026-10-29T17:07:51Z.
    pub posted: String,
    pub size: u64,
}

/// Every SDK package the catalogs list (not the small ones that remove an
/// old SDK), each once, newest first, and whether every catalog was read: a
/// catalog that fails is skipped, but none read fails.
pub fn list() -> Result<(Vec<Listed>, bool)> {
    let urls: Vec<String> = CATALOG_HEADS
        .iter()
        .map(|h| {
            format!("https://swscan.apple.com/content/catalogs/others/index-{h}{CATALOG_TAIL}")
        })
        .chain(OLD_CATALOGS.iter().map(|s| s.to_string()))
        .collect();
    let read = crate::parallel(&urls, urls.len(), |url| Ok(read(url)));
    let mut found: Vec<Listed> = vec![];
    let mut failed = vec![];
    for result in read? {
        match result {
            Ok(listed) => {
                for l in listed {
                    if !found.iter().any(|f| f.url == l.url) {
                        found.push(l);
                    }
                }
            }
            Err(e) => {
                eprintln!("{e}");
                failed.push(e.0);
            }
        }
    }
    if failed.len() == urls.len() {
        crate::bail!(
            "Apple's software update catalogs could not be read: {}",
            failed[0]
        );
    }
    // Newest first (stable: as the catalogs list them on a tie).
    found.sort_by(|a, b| (&b.posted, &b.product).cmp(&(&a.posted, &a.product)));
    Ok((found, failed.is_empty()))
}

/// The SDK packages of a catalog.
fn read(url: &str) -> Result<Vec<Listed>> {
    let data = http::get(url)?;
    let mut text = String::new();
    flate2::read::GzDecoder::new(&data[..])
        .read_to_string(&mut text)
        .context(url)?;
    let catalog = xml::plist(&xml::parse(&text)?)?;
    let Some(Plist::Dict(products)) = catalog.get("Products") else {
        crate::bail!("{url}: no Products")
    };
    let mut out = vec![];
    for (pid, product) in products {
        let Some(Plist::Array(packages)) = product.get("Packages") else {
            continue;
        };
        let posted = match product.get("PostDate") {
            Some(Plist::Date(d)) => d.clone(),
            _ => String::new(),
        };
        for p in packages {
            let (Some(Plist::String(u)), Some(Plist::Integer(size))) =
                (p.get("URL"), p.get("Size"))
            else {
                continue;
            };
            let u = match u.strip_prefix("http:") {
                Some(rest) => format!("https:{rest}"),
                None => u.clone(),
            };
            if !is_sdk_package(&u) || *size <= 1 << 20 {
                continue;
            }
            out.push(Listed {
                url: u,
                product: pid.clone(),
                posted: posted.clone(),
                size: *size as u64,
            });
        }
    }
    Ok(out)
}

/// A Command Line Tools package of an SDK: CLTools_macOSNMOS_SDK.pkg,
/// CLTools_SDK_macOS1014.pkg.
fn is_sdk_package(url: &str) -> bool {
    let name = url.rsplit('/').next().unwrap_or(url);
    name.starts_with("CLTools_") && name.ends_with(".pkg") && name.contains("SDK")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_packages() {
        let base = "https://swcdn.apple.com/content/downloads/53/49/142-50405-A_WOBLDDXP4W/x";
        assert!(is_sdk_package(&format!("{base}/CLTools_macOSNMOS_SDK.pkg")));
        assert!(is_sdk_package(&format!("{base}/CLTools_SDK_macOS1014.pkg")));
        assert!(!is_sdk_package(&format!("{base}/CLTools_Executables.pkg")));
        assert!(!is_sdk_package(&format!("{base}/CLTools_SDK/x.pkm")));
    }
}
