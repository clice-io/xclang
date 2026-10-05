//! The command line: words (the command and its operands) and --options.

use lexopt::ValueExt;

use crate::{Result, bail};

/// Options that take no value.
const FLAGS: &[&str] = &["accept-license", "force", "help"];
/// Options every command takes.
const GLOBAL: &[&str] = &["root", "sdk-dir", "table"];

pub struct Args {
    pub words: Vec<String>,
    values: Vec<(String, String)>,
    flags: Vec<String>,
}

impl Args {
    pub fn parse() -> Result<Args> {
        Self::from(lexopt::Parser::from_env())
    }

    fn from(mut parser: lexopt::Parser) -> Result<Args> {
        use lexopt::Arg::{Long, Short, Value};
        let mut a = Args {
            words: vec![],
            values: vec![],
            flags: vec![],
        };
        while let Some(arg) = parser.next()? {
            match arg {
                Short('h') => a.flags.push("help".into()),
                Short('V') => a.flags.push("version".into()),
                // --version is the program's, but the SDK's in `xclang sdk ...`.
                Long("version") if a.words.first().is_none_or(|w| w != "sdk") => {
                    a.flags.push("version".into())
                }
                Long(name) if FLAGS.contains(&name) => a.flags.push(name.into()),
                Long(name) => {
                    let name = name.to_string();
                    let value = parser.value()?.string()?;
                    a.values.push((name, value));
                }
                Value(v) => a.words.push(v.string()?),
                Short(c) => bail!("unknown option -{c}; see xclang --help"),
            }
        }
        Ok(a)
    }

    pub fn flag(&self, name: &str) -> bool {
        self.flags.iter().any(|f| f == name)
    }

    /// The last value of --name.
    pub fn value(&self, name: &str) -> Option<&str> {
        self.values
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// Fails on an option the command does not take.
    pub fn allow(&self, options: &[&str]) -> Result<()> {
        let known =
            |n: &str| options.contains(&n) || GLOBAL.contains(&n) || n == "help" || n == "version";
        for name in self.values.iter().map(|(n, _)| n).chain(&self.flags) {
            if !known(name) {
                bail!(
                    "{} takes no --{name}; see xclang --help",
                    self.words.join(" ")
                );
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Args {
        Args::from(lexopt::Parser::from_iter(
            std::iter::once("xclang").chain(args.iter().copied()),
        ))
        .unwrap()
    }

    #[test]
    fn version_is_the_sdks_in_sdk_commands() {
        let a = parse(&[
            "sdk",
            "fetch",
            "macos",
            "--version",
            "26",
            "--accept-license",
        ]);
        assert_eq!(a.value("version"), Some("26"));
        assert!(a.flag("accept-license"));
        assert!(!a.flag("version"));
        assert!(parse(&["--version"]).flag("version"));
        assert!(parse(&["target", "list", "--version"]).flag("version"));
    }
}
