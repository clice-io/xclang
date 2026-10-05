//! The version table (sdk-versions.json, built in): every SDK version the
//! vendors offer, where each package is, its size and sha256, and the
//! presets of GitHub's runner images. `xclang sdk update-table` (the
//! maintainer feature) appends to it; the same types read and write it.

use std::cmp::Ordering;
use std::fmt;
use std::marker::PhantomData;

use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{Result, bail};

pub const BUILT_IN: &str = include_str!("../sdk-versions.json");

/// A JSON object whose keys keep their order.
#[derive(Clone, Debug, PartialEq)]
pub struct VecMap<V>(pub Vec<(String, V)>);

impl<V> Default for VecMap<V> {
    fn default() -> Self {
        VecMap(vec![])
    }
}

impl<V> VecMap<V> {
    pub fn get(&self, key: &str) -> Option<&V> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &V)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v))
    }

    #[cfg(feature = "maintainer")]
    pub fn insert(&mut self, key: String, value: V) {
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }

    #[cfg(feature = "maintainer")]
    pub fn sort_by_version(&mut self) {
        self.0.sort_by(|a, b| version_cmp(&a.0, &b.0));
    }
}

impl<V: Serialize> Serialize for VecMap<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

impl<'de, V: Deserialize<'de>> Deserialize<'de> for VecMap<V> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V2<V>(PhantomData<V>);
        impl<'de, V: Deserialize<'de>> Visitor<'de> for V2<V> {
            type Value = VecMap<V>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut out = vec![];
                while let Some((k, v)) = a.next_entry()? {
                    out.push((k, v));
                }
                Ok(VecMap(out))
            }
        }
        d.deserialize_map(V2(PhantomData))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Table {
    pub windows: Windows,
    pub macos: Macos,
    #[serde(default)]
    pub presets: VecMap<Preset>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Windows {
    /// Visual Studio's channel manifests the MSVC packages were found in.
    pub manifests: VecMap<Manifest>,
    pub msvc: VecMap<Msvc>,
    pub sdk: VecMap<WinSdk>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Manifest {
    pub channel: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub vsman: Vsman,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Vsman {
    pub url: String,
    pub size: u64,
    pub sha256: String,
    /// What the channel manifest lists for it, which the CDN does not serve.
    pub listed: Listed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Listed {
    pub size: u64,
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Package {
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

/// An MSVC toolset: its headers, and per architecture the CRT packages
/// (desktop, store, desktop-debug).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Msvc {
    pub manifest: String,
    pub headers: Package,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x86_64: Option<VecMap<Package>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aarch64: Option<VecMap<Package>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x86: Option<VecMap<Package>>,
}

impl Msvc {
    pub fn arch(&self, arch: &str) -> Option<&VecMap<Package>> {
        match arch {
            "x86_64" => self.x86_64.as_ref(),
            "aarch64" => self.aarch64.as_ref(),
            "x86" => self.x86.as_ref(),
            _ => None,
        }
    }
}

/// A Windows SDK: its headers' NuGet package, and one per architecture.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WinSdk {
    pub headers: Package,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x86_64: Option<Package>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aarch64: Option<Package>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x86: Option<Package>,
}

impl WinSdk {
    pub fn arch(&self, arch: &str) -> Option<&Package> {
        match arch {
            "x86_64" => self.x86_64.as_ref(),
            "aarch64" => self.aarch64.as_ref(),
            "x86" => self.x86.as_ref(),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Macos {
    /// Newest first: of the packages of one SDK version, the first is taken.
    pub packages: Vec<MacPackage>,
}

/// A Command Line Tools package carrying a macOS SDK.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MacPackage {
    pub sdk: String,
    pub product: String,
    pub posted: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

/// What one of GitHub's runner images builds with.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Preset {
    pub image: String,
    pub labels: Vec<String>,
    pub readme: String,
    #[serde(
        rename = "image-version",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub image_version: Option<String>,
    #[serde(
        rename = "visual-studio",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub visual_studio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msvc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xcode: Option<String>,
    pub sdk: String,
    /// The day the image was read, kept while the preset stays the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Vendor {
    Macos,
    Windows,
}

impl Vendor {
    pub fn parse(s: &str) -> Result<Vendor> {
        match s {
            "macos" => Ok(Vendor::Macos),
            "windows" => Ok(Vendor::Windows),
            _ => bail!("unknown SDK {s}: macos or windows"),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Vendor::Macos => "macos",
            Vendor::Windows => "windows",
        }
    }

    /// The preset taken when none is named: what a workflow on GitHub's
    /// runners gets without naming an image, so that a cross build matches
    /// the native one most CI has. The newest versions xclang works with
    /// are no better: for macOS they are the same; for Windows (MSVC 14.52,
    /// SDK 10.0.28000) no image has them, and their STL, like
    /// windows-latest's (MSVC 14.50 and later), runs on Windows 10 and later
    /// only; windows-2022's MSVC 14.44 serves Windows 7 SP1 and 8.1 too.
    pub fn default_preset(self) -> &'static str {
        match self {
            Vendor::Macos => "macos-latest",
            Vendor::Windows => "windows-latest",
        }
    }
}

impl Preset {
    pub fn vendor(&self) -> Vendor {
        if self.msvc.is_some() {
            Vendor::Windows
        } else {
            Vendor::Macos
        }
    }
}

impl Table {
    pub fn load(file: Option<&str>) -> Result<Table> {
        let text = match file {
            Some(f) => std::fs::read_to_string(f).map_err(|e| crate::Error(format!("{f}: {e}")))?,
            None => BUILT_IN.to_string(),
        };
        Ok(serde_json::from_str(&text)?)
    }

    /// The preset `name` names (an image, or one of its runner labels).
    pub fn preset(&self, name: &str, vendor: Vendor) -> Result<(&str, &Preset)> {
        let presets = || self.presets.iter().filter(|(_, p)| p.vendor() == vendor);
        if let Some(found) =
            presets().find(|(k, p)| *k == name || p.labels.iter().any(|l| l == name))
        {
            return Ok(found);
        }
        let mut names: Vec<&str> = presets()
            .flat_map(|(k, p)| std::iter::once(k).chain(p.labels.iter().map(String::as_str)))
            .collect();
        names.sort();
        names.dedup();
        bail!(
            "no {} preset {name}; there are: {}",
            vendor.name(),
            names.join(" ")
        )
    }

    /// SDK version -> its package: the first the table lists.
    pub fn macos_versions(&self) -> VecMap<&MacPackage> {
        let mut out = VecMap::default();
        for p in &self.macos.packages {
            if !out.contains(&p.sdk) {
                out.0.push((p.sdk.clone(), p));
            }
        }
        out
    }

    /// The table as the file holds it (Python's json.dump with indent=1).
    #[cfg(any(test, feature = "maintainer"))]
    pub fn to_json(&self) -> Result<String> {
        let mut out = vec![];
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b" ");
        let mut ser = serde_json::Serializer::with_formatter(&mut out, formatter);
        self.serialize(&mut ser)?;
        out.push(b'\n');
        Ok(String::from_utf8(out).unwrap())
    }
}

/// The numbers in a version, compared in order: 10.0.26100.8249.
pub fn version_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(u64::MAX))
        .collect()
}

pub fn version_cmp(a: &str, b: &str) -> Ordering {
    version_key(a).cmp(&version_key(b))
}

/// What xclang cannot use, which the defaults pass over: the macOS 27 SDK's
/// .tbd files list arm64e.x1, which ld64.lld 23.1.2 rejects (llvm#222721).
pub fn macos_broken(version: &str) -> bool {
    version_key(version) >= vec![27]
}

/// The version of `versions` that `want` names (whole or in part: 26,
/// 10.0.26100, 14.44), the newest that matches; with no `want`, the newest
/// that is not broken.
pub fn pick<'a>(
    versions: impl Iterator<Item = &'a str>,
    want: Option<&str>,
    broken: impl Fn(&str) -> bool,
    what: &str,
) -> Result<String> {
    let mut known: Vec<&str> = versions.collect();
    known.sort_by(|a, b| version_cmp(a, b));
    if let Some(want) = want {
        let prefix = format!("{want}.");
        return match known
            .iter()
            .rev()
            .find(|v| **v == want || v.starts_with(&prefix))
        {
            Some(v) => Ok(v.to_string()),
            None => bail!("no {what} {want} in the table; it has: {}", known.join(" ")),
        };
    }
    match known.iter().rev().find(|v| !broken(v)) {
        Some(v) => Ok(v.to_string()),
        None => bail!("no {what} in the table"),
    }
}

/// What `--arch` names, as the vendors name it.
pub const MS_ARCH: [(&str, &str); 3] = [("x86_64", "x64"), ("aarch64", "arm64"), ("x86", "x86")];

pub fn ms_arch(arch: &str) -> Option<&'static str> {
    MS_ARCH.iter().find(|(a, _)| *a == arch).map(|(_, m)| *m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let table = Table::load(None).unwrap();
        assert_eq!(table.to_json().unwrap(), BUILT_IN);
    }

    #[test]
    fn picks() {
        let v = [
            "10.0.22621.3233",
            "10.0.26100.1",
            "10.0.26100.8249",
            "10.0.28000.2705",
        ];
        let pick = |want| pick(v.iter().copied(), want, |_| false, "SDK").unwrap();
        assert_eq!(pick(None), "10.0.28000.2705");
        assert_eq!(pick(Some("10.0.26100")), "10.0.26100.8249");
        assert_eq!(pick(Some("10.0.26100.1")), "10.0.26100.1");
        assert!(super::pick(v.iter().copied(), Some("10.0.2"), |_| false, "SDK").is_err());
        let m = ["15.5", "26.5", "27.0"];
        let newest = super::pick(m.iter().copied(), None, macos_broken, "macOS SDK");
        assert_eq!(newest.unwrap(), "26.5");
    }

    #[test]
    fn defaults() {
        let table = Table::load(None).unwrap();
        let (key, p) = table.preset("windows-latest", Vendor::Windows).unwrap();
        assert_eq!(key, "windows-2025-vs2026");
        assert!(p.msvc.is_some());
        assert!(table.preset("macos-latest", Vendor::Windows).is_err());
        assert_eq!(
            table.preset("macos-latest", Vendor::Macos).unwrap().1.sdk,
            "26.5"
        );
    }
}
