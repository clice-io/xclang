//! Just enough XML for a xar archive's table of contents and Apple's
//! property lists: elements, attributes, text, the five entities and
//! character references; declarations, comments and a DOCTYPE skipped.

use crate::{Result, bail};

#[derive(Debug, Default)]
pub struct Element {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

#[derive(Debug)]
pub enum Node {
    Element(Element),
    Text(String),
}

impl Element {
    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|n| match n {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        })
    }

    pub fn child(&self, name: &str) -> Option<&Element> {
        self.elements().find(|e| e.name == name)
    }

    pub fn text(&self) -> String {
        self.children
            .iter()
            .filter_map(|n| match n {
                Node::Text(t) => Some(t.as_str()),
                Node::Element(_) => None,
            })
            .collect()
    }

    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// Every element below this one named `name`, depth first.
    pub fn descendants<'a>(&'a self, name: &str, out: &mut Vec<&'a Element>) {
        for e in self.elements() {
            if e.name == name {
                out.push(e);
            }
            e.descendants(name, out);
        }
    }
}

pub fn parse(s: &str) -> Result<Element> {
    let mut stack = vec![Element::default()];
    let mut i = 0;
    let find = |from: usize, what: &str| match s[from..].find(what) {
        Some(k) => Ok(from + k),
        None => Err(crate::Error(format!("XML: no {what} after offset {from}"))),
    };
    while i < s.len() {
        let rest = &s[i..];
        if !rest.starts_with('<') {
            let end = rest.find('<').map_or(s.len(), |k| i + k);
            if stack.len() > 1 {
                stack
                    .last_mut()
                    .unwrap()
                    .children
                    .push(Node::Text(unescape(&s[i..end])?));
            }
            i = end;
        } else if rest.starts_with("<?") {
            i = find(i, "?>")? + 2;
        } else if rest.starts_with("<!--") {
            i = find(i, "-->")? + 3;
        } else if let Some(cdata) = rest.strip_prefix("<![CDATA[") {
            let end = find(i, "]]>")?;
            let text = &cdata[..end - i - 9];
            stack
                .last_mut()
                .unwrap()
                .children
                .push(Node::Text(text.to_string()));
            i = end + 3;
        } else if rest.starts_with("<!") {
            // <!DOCTYPE ...>, perhaps with an internal subset in brackets.
            let mut depth = 0;
            let end = rest.char_indices().find(|&(_, c)| {
                match c {
                    '[' => depth += 1,
                    ']' => depth -= 1,
                    '>' if depth == 0 => return true,
                    _ => {}
                }
                false
            });
            match end {
                Some((k, _)) => i += k + 1,
                None => bail!("XML: unterminated declaration"),
            }
        } else if let Some(close) = rest.strip_prefix("</") {
            let end = find(i, ">")?;
            let name = close[..end - i - 2].trim();
            let element = stack.pop().unwrap();
            if element.name != name || stack.is_empty() {
                bail!("XML: </{name}> closes <{}>", element.name);
            }
            stack
                .last_mut()
                .unwrap()
                .children
                .push(Node::Element(element));
            i = end + 1;
        } else {
            let end = tag_end(s, i)?;
            let inner = &s[i + 1..end];
            let (inner, empty) = match inner.strip_suffix('/') {
                Some(inner) => (inner, true),
                None => (inner, false),
            };
            let element = start_tag(inner)?;
            if empty {
                stack
                    .last_mut()
                    .unwrap()
                    .children
                    .push(Node::Element(element));
            } else {
                stack.push(element);
            }
            i = end + 1;
        }
    }
    if stack.len() != 1 {
        bail!("XML: <{}> is not closed", stack.last().unwrap().name);
    }
    let mut document = stack.pop().unwrap();
    match document.children.drain(..).find_map(|n| match n {
        Node::Element(e) => Some(e),
        Node::Text(_) => None,
    }) {
        Some(root) => Ok(root),
        None => bail!("XML: no root element"),
    }
}

/// The '>' that ends the tag starting at i, past quoted attribute values.
fn tag_end(s: &str, i: usize) -> Result<usize> {
    let mut quote = None;
    for (k, c) in s[i..].char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), _) if q == c => quote = None,
            (None, '>') => return Ok(i + k),
            _ => {}
        }
    }
    bail!("XML: unterminated tag at offset {i}")
}

fn start_tag(inner: &str) -> Result<Element> {
    let name_end = inner
        .find(|c: char| c.is_ascii_whitespace())
        .unwrap_or(inner.len());
    let mut element = Element {
        name: inner[..name_end].to_string(),
        ..Default::default()
    };
    let mut rest = inner[name_end..].trim_start();
    while !rest.is_empty() {
        let Some(eq) = rest.find('=') else {
            bail!("XML: attribute without a value in <{inner}>")
        };
        let name = rest[..eq].trim().to_string();
        let value = rest[eq + 1..].trim_start();
        let Some(q) = value.chars().next().filter(|&c| c == '"' || c == '\'') else {
            bail!("XML: unquoted attribute in <{inner}>")
        };
        let Some(end) = value[1..].find(q) else {
            bail!("XML: unterminated attribute in <{inner}>")
        };
        element.attrs.push((name, unescape(&value[1..1 + end])?));
        rest = value[end + 2..].trim_start();
    }
    Ok(element)
}

fn unescape(s: &str) -> Result<String> {
    if !s.contains('&') {
        return Ok(s.to_string());
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(k) = rest.find('&') {
        out.push_str(&rest[..k]);
        let Some(end) = rest[k..].find(';') else {
            bail!("XML: unterminated entity in {s:?}")
        };
        let entity = &rest[k + 1..k + end];
        let c = match entity {
            "lt" => '<',
            "gt" => '>',
            "amp" => '&',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let code = match entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => entity.strip_prefix('#').and_then(|d| d.parse().ok()),
                };
                match code.and_then(char::from_u32) {
                    Some(c) => c,
                    None => bail!("XML: unknown entity &{entity};"),
                }
            }
        };
        out.push(c);
        rest = &rest[k + end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses() {
        let doc = parse(
            "<?xml version=\"1.0\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"x\">\n\
             <xar><!-- c --><toc><file id='1'><name>Pay&amp;load</name><data><encoding style=\"a/b\"/>\
             <offset>20</offset></data></file></toc></xar>",
        )
        .unwrap();
        let mut files = vec![];
        doc.descendants("file", &mut files);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].attr("id"), Some("1"));
        assert_eq!(files[0].child("name").unwrap().text(), "Pay&load");
        let data = files[0].child("data").unwrap();
        assert_eq!(data.child("encoding").unwrap().attr("style"), Some("a/b"));
        assert_eq!(data.child("offset").unwrap().text(), "20");
    }
}
