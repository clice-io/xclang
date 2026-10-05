//! Reading zip archives (Visual Studio's .vsix, NuGet's .nupkg): the
//! central directory, zip64 included, and stored or deflated members. Each
//! archive is checked by its sha256 before it is read, so CRCs are not.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use flate2::read::DeflateDecoder;

use crate::{Context, Result, bail};

pub struct Member {
    /// As stored: an OPC package (.vsix, .nupkg) percent-encodes its names.
    pub raw_name: String,
    pub method: u16,
    pub compressed: u64,
    pub size: u64,
    offset: u64,
}

impl Member {
    pub fn is_dir(&self) -> bool {
        self.raw_name.ends_with('/')
    }

    /// The name, its %XX escapes decoded (what NuGet and the Visual Studio
    /// installer do).
    pub fn name(&self) -> String {
        percent_decode(&self.raw_name)
    }
}

pub struct Zip {
    file: File,
    path: PathBuf,
    pub members: Vec<Member>,
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}

impl Zip {
    pub fn open(path: &Path) -> Result<Zip> {
        let mut file = File::open(path).context(path.display())?;
        let len = file.metadata()?.len();
        // The end of central directory record, in the last 64 KiB + 22 bytes.
        let tail_len = len.min(65_557);
        let mut tail = vec![0; tail_len as usize];
        file.seek(SeekFrom::Start(len - tail_len))?;
        file.read_exact(&mut tail)?;
        let Some(eocd) = (0..tail.len().saturating_sub(21))
            .rev()
            .find(|&i| u32_at(&tail, i) == 0x0605_4b50)
        else {
            bail!("{}: not a zip archive", path.display())
        };
        let mut count = u16_at(&tail, eocd + 10) as u64;
        let mut cd_size = u32_at(&tail, eocd + 12) as u64;
        let mut cd_offset = u32_at(&tail, eocd + 16) as u64;
        // zip64: a locator right before the record points to the zip64 record.
        if eocd >= 20 && u32_at(&tail, eocd - 20) == 0x0706_4b50 {
            let at = u64_at(&tail, eocd - 20 + 8);
            let mut record = [0u8; 56];
            file.seek(SeekFrom::Start(at))?;
            file.read_exact(&mut record)?;
            if u32_at(&record, 0) != 0x0606_4b50 {
                bail!("{}: bad zip64 record", path.display());
            }
            count = u64_at(&record, 32);
            cd_size = u64_at(&record, 40);
            cd_offset = u64_at(&record, 48);
        }
        let mut cd = vec![0; cd_size as usize];
        file.seek(SeekFrom::Start(cd_offset))?;
        file.read_exact(&mut cd)
            .context(format!("{}: central directory", path.display()))?;
        let mut members = Vec::with_capacity(count as usize);
        let mut at = 0;
        for _ in 0..count {
            if at + 46 > cd.len() || u32_at(&cd, at) != 0x0201_4b50 {
                bail!("{}: bad central directory", path.display());
            }
            let method = u16_at(&cd, at + 10);
            let mut compressed = u32_at(&cd, at + 20) as u64;
            let mut size = u32_at(&cd, at + 24) as u64;
            let (name_len, extra_len, comment_len) = (
                u16_at(&cd, at + 28) as usize,
                u16_at(&cd, at + 30) as usize,
                u16_at(&cd, at + 32) as usize,
            );
            let mut offset = u32_at(&cd, at + 42) as u64;
            let name_start = at + 46;
            let extra_start = name_start + name_len;
            if extra_start + extra_len > cd.len() {
                bail!("{}: bad central directory", path.display());
            }
            let raw_name = String::from_utf8_lossy(&cd[name_start..extra_start]).into_owned();
            // The zip64 extra field holds, in order, those of the three that
            // did not fit.
            let mut extra = &cd[extra_start..extra_start + extra_len];
            while extra.len() >= 4 {
                let (id, n) = (u16_at(extra, 0), u16_at(extra, 2) as usize);
                let data = &extra[4..(4 + n).min(extra.len())];
                if id == 1 {
                    let mut k = 0;
                    for v in [&mut size, &mut compressed, &mut offset] {
                        if *v == 0xffff_ffff && k + 8 <= data.len() {
                            *v = u64_at(data, k);
                            k += 8;
                        }
                    }
                }
                extra = &extra[(4 + n).min(extra.len())..];
            }
            members.push(Member {
                raw_name,
                method,
                compressed,
                size,
                offset,
            });
            at = extra_start + extra_len + comment_len;
        }
        Ok(Zip {
            file,
            path: path.to_path_buf(),
            members,
        })
    }

    /// The data of members[i].
    pub fn read(&mut self, i: usize) -> Result<impl Read + '_> {
        let m = &self.members[i];
        let mut header = [0u8; 30];
        self.file.seek(SeekFrom::Start(m.offset))?;
        self.file.read_exact(&mut header)?;
        if u32_at(&header, 0) != 0x0403_4b50 {
            bail!(
                "{}: bad local header for {}",
                self.path.display(),
                m.raw_name
            );
        }
        let skip = u16_at(&header, 26) as i64 + u16_at(&header, 28) as i64;
        self.file.seek(SeekFrom::Current(skip))?;
        let raw = (&mut self.file).take(m.compressed);
        Ok(match m.method {
            0 => Data::Stored(raw),
            8 => Data::Deflated(DeflateDecoder::new(raw)),
            method => bail!(
                "{}: {} is compressed with method {method}",
                self.path.display(),
                m.raw_name
            ),
        })
    }
}

enum Data<R: Read> {
    Stored(R),
    Deflated(DeflateDecoder<R>),
}

impl<R: Read> Read for Data<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Data::Stored(r) => r.read(buf),
            Data::Deflated(r) => r.read(buf),
        }
    }
}

fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%'
            && i + 2 < b.len()
            && let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2]))
        {
            out.push((h * 16 + l) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_names() {
        assert_eq!(percent_decode("a%20b%2Bc"), "a b+c");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}
