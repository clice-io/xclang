//! Apple's flat packages: a xar archive whose Payload is a pbzx stream (xz
//! chunks, since macOS 10.10's packages) or gzip, of an odc cpio archive.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

use flate2::read::{GzDecoder, ZlibDecoder};

use crate::{Context, Result, bail, xml};

/// A xar archive: its table of contents and its heap.
pub struct Xar {
    file: File,
    heap: u64,
    toc: xml::Element,
}

impl Xar {
    pub fn open(path: &Path) -> Result<Xar> {
        let mut file = File::open(path).context(path.display())?;
        let mut header = [0u8; 28];
        file.read_exact(&mut header).context(path.display())?;
        if &header[..4] != b"xar!" {
            bail!("{}: not a xar archive (.pkg)", path.display());
        }
        let size = u16::from_be_bytes([header[4], header[5]]) as u64;
        let toc_len = u64::from_be_bytes(header[8..16].try_into().unwrap());
        file.seek(SeekFrom::Start(size))?;
        let mut toc = String::new();
        ZlibDecoder::new((&mut file).take(toc_len))
            .read_to_string(&mut toc)
            .context(format!("{}: table of contents", path.display()))?;
        Ok(Xar {
            file,
            heap: size + toc_len,
            toc: xml::parse(&toc)?,
        })
    }

    /// The member's data, decoded (stored or zlib; xar calls zlib gzip).
    pub fn member(&mut self, name: &str) -> Result<Box<dyn Read + Send + '_>> {
        let mut files = vec![];
        self.toc.descendants("file", &mut files);
        let Some(data) = files
            .iter()
            .find(|f| f.child("name").is_some_and(|n| n.text() == name))
            .and_then(|f| f.child("data"))
        else {
            bail!("{name} not found in the package")
        };
        let number = |field: &str| -> Result<u64> {
            let text = data.child(field).map(|e| e.text()).unwrap_or_default();
            text.trim()
                .parse()
                .context(format!("{name}: <{field}> {text:?}"))
        };
        let (offset, length) = (number("offset")?, number("length")?);
        let style = data
            .child("encoding")
            .and_then(|e| e.attr("style"))
            .unwrap_or("application/octet-stream");
        self.file.seek(SeekFrom::Start(self.heap + offset))?;
        let raw = (&mut self.file).take(length);
        Ok(match style {
            "application/octet-stream" => Box::new(raw),
            "application/x-gzip" => Box::new(ZlibDecoder::new(raw)),
            _ => bail!("{name}: unknown xar encoding {style}"),
        })
    }
}

/// A package's Payload as the cpio stream it holds.
pub fn payload<'a>(raw: Box<dyn Read + Send + 'a>) -> Result<Box<dyn Read + Send + 'a>> {
    let mut reader = BufReader::with_capacity(1 << 20, raw);
    let head = reader.fill_buf()?;
    Ok(if head.starts_with(b"pbzx") {
        Box::new(Pbzx::new(reader)?)
    } else if head.starts_with(&[0x1f, 0x8b]) {
        Box::new(GzDecoder::new(reader))
    } else {
        Box::new(reader)
    })
}

/// Apple's pbzx stream: a header, then chunks of xz (or stored) data, each
/// on its own, so a batch of them is decompressed in parallel.
pub struct Pbzx<R> {
    inner: R,
    more: bool,
    ready: VecDeque<Vec<u8>>,
    current: Vec<u8>,
    pos: usize,
}

const XZ_MAGIC: &[u8] = b"\xfd7zXZ\x00";

impl<R: Read> Pbzx<R> {
    pub fn new(mut inner: R) -> Result<Self> {
        let mut header = [0u8; 12];
        inner.read_exact(&mut header)?;
        if &header[..4] != b"pbzx" {
            bail!("Payload is not a pbzx stream");
        }
        let flags = u64::from_be_bytes(header[4..].try_into().unwrap());
        Ok(Pbzx {
            inner,
            more: flags & 0x0100_0000 != 0,
            ready: VecDeque::new(),
            current: vec![],
            pos: 0,
        })
    }

    fn refill(&mut self) -> io::Result<bool> {
        if self.ready.is_empty() {
            let mut batch = vec![];
            while self.more && batch.len() < crate::cpus().min(8) {
                let mut header = [0u8; 16];
                self.inner.read_exact(&mut header)?;
                let flags = u64::from_be_bytes(header[..8].try_into().unwrap());
                let size = u64::from_be_bytes(header[8..].try_into().unwrap());
                let mut chunk = vec![0; size as usize];
                self.inner.read_exact(&mut chunk)?;
                batch.push(chunk);
                self.more = flags & 0x0100_0000 != 0;
            }
            let decoded = crate::parallel(&batch, batch.len(), |chunk| {
                if chunk.starts_with(XZ_MAGIC) {
                    liblzma::decode_all(&chunk[..]).context("pbzx chunk")
                } else {
                    Ok(chunk.clone())
                }
            })
            .map_err(|e| io::Error::other(e.0))?;
            self.ready.extend(decoded);
        }
        match self.ready.pop_front() {
            Some(chunk) => {
                self.current = chunk;
                self.pos = 0;
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

impl<R: Read> Read for Pbzx<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.pos == self.current.len() {
            if !self.refill()? {
                return Ok(0);
            }
        }
        let n = buf.len().min(self.current.len() - self.pos);
        buf[..n].copy_from_slice(&self.current[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

/// An entry of an odc ("070707") cpio archive; its data follows.
pub struct Entry {
    pub name: String,
    pub mode: u32,
    pub nlink: u32,
    /// (device, inode): what the names of one hard-linked file share.
    pub inode: (u64, u64),
    pub size: u64,
}

pub const S_IFMT: u32 = 0o170000;
pub const S_IFDIR: u32 = 0o040000;
pub const S_IFREG: u32 = 0o100000;
pub const S_IFLNK: u32 = 0o120000;

pub struct Cpio<R> {
    inner: R,
    left: u64,
}

impl<R: Read> Cpio<R> {
    pub fn new(inner: R) -> Self {
        Cpio { inner, left: 0 }
    }

    pub fn next_entry(&mut self) -> Result<Option<Entry>> {
        if self.left > 0 {
            io::copy(&mut (&mut self.inner).take(self.left), &mut io::sink())?;
            self.left = 0;
        }
        let mut h = [0u8; 76];
        self.inner.read_exact(&mut h).context("cpio header")?;
        if &h[..6] != b"070707" {
            bail!("bad cpio header {:?}", String::from_utf8_lossy(&h[..6]));
        }
        let field = |from: usize, to: usize| -> Result<u64> {
            let text = std::str::from_utf8(&h[from..to]).unwrap_or("");
            u64::from_str_radix(text, 8).context(format!("cpio header field {text:?}"))
        };
        let (dev, ino, mode, nlink) = (
            field(6, 12)?,
            field(12, 18)?,
            field(18, 24)?,
            field(36, 42)?,
        );
        let (namesize, size) = (field(59, 65)?, field(65, 76)?);
        let mut name = vec![0; namesize as usize];
        self.inner.read_exact(&mut name).context("cpio name")?;
        name.pop_if(|c| *c == 0);
        let name = String::from_utf8(name).context("cpio name")?;
        if name == "TRAILER!!!" {
            return Ok(None);
        }
        self.left = size;
        Ok(Some(Entry {
            name,
            mode: mode as u32,
            nlink: nlink as u32,
            inode: (dev, ino),
            size,
        }))
    }

    /// The current entry's data.
    pub fn read_data(&mut self) -> Result<Vec<u8>> {
        let mut data = Vec::with_capacity(self.left as usize);
        (&mut self.inner).take(self.left).read_to_end(&mut data)?;
        if data.len() as u64 != self.left {
            bail!("cpio archive ends inside an entry");
        }
        self.left = 0;
        Ok(data)
    }

    pub fn copy_data(&mut self, out: &mut impl Write) -> Result<()> {
        let n = io::copy(&mut (&mut self.inner).take(self.left), out)?;
        if n != self.left {
            bail!("cpio archive ends inside an entry");
        }
        self.left = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn odc(name: &str, mode: u32, data: &[u8]) -> Vec<u8> {
        let mut h = format!(
            "070707{:06o}{:06o}{:06o}{:06o}{:06o}{:06o}{:06o}{:011o}{:06o}{:011o}",
            1,
            2,
            mode,
            0,
            0,
            1,
            0,
            0,
            name.len() + 1,
            data.len()
        )
        .into_bytes();
        h.extend(name.as_bytes());
        h.push(0);
        h.extend(data);
        h
    }

    #[test]
    fn pbzx_and_cpio() {
        let mut archive = odc("a/b.txt", S_IFREG | 0o644, b"hello");
        archive.extend(odc("a/link", S_IFLNK | 0o755, b"b.txt"));
        archive.extend(odc("TRAILER!!!", 0, b""));
        // Two chunks: one xz, one stored.
        let (first, second) = archive.split_at(40);
        let xz = liblzma::encode_all(first, 6).unwrap();
        let mut stream = b"pbzx".to_vec();
        stream.extend(0x0100_0000u64.to_be_bytes());
        stream.extend(0x0100_0000u64.to_be_bytes());
        stream.extend((xz.len() as u64).to_be_bytes());
        stream.extend(&xz);
        stream.extend(0u64.to_be_bytes());
        stream.extend((second.len() as u64).to_be_bytes());
        stream.extend(second);
        let mut cpio = Cpio::new(payload(Box::new(io::Cursor::new(stream))).unwrap());
        let e = cpio.next_entry().unwrap().unwrap();
        assert_eq!(
            (e.name.as_str(), e.mode & S_IFMT, e.size),
            ("a/b.txt", S_IFREG, 5)
        );
        assert_eq!(cpio.read_data().unwrap(), b"hello");
        let e = cpio.next_entry().unwrap().unwrap();
        assert_eq!((e.name.as_str(), e.mode & S_IFMT), ("a/link", S_IFLNK));
        assert!(cpio.next_entry().unwrap().is_none());
    }
}
