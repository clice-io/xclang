/// Checks of docs/ that need no build:
///
/// - the files and commands the docs show are the ones CI runs. A code
///   block under `<!-- file: <path> -->` must be that file of the
///   repository, byte for byte (but for the final newline). A block under
///   `<!-- excerpt: <path> -->` must be consecutive lines of it, indented
///   alike: a command block is a step of .github/workflows/examples.yml, a
///   fragment a part of a file in examples/;
/// - every command block (sh, powershell, yaml) has one of those markers,
///   or `<!-- not run: <why> -->` saying why CI does not run it;
/// - every directory of examples/ is built by examples.yml and shown by a
///   page, and its pixi.toml and .bazelversion are those of the quick start
///   and the Bazel example, so a release changes one version of each;
/// - every relative link names a page that exists, and a heading of it
///   when it has an anchor, slugged as the docs site (VitePress) does, or
///   an `<a id="...">` of it (the roadmap's rows); so does every link into
///   docs/en from the README, the CHANGELOG and the other top-level pages,
///   as a file or as a docs.clice.io/xclang URL; every link to a file of
///   the repository, relative or on GitHub's main, reaches one;
/// - what is not shipped is said one way: a table's `status` column holds
///   one of the roadmap's six words, and the phrasings that left a status
///   unclear ("is to be", "being considered", a bare "**Missing.**") are
///   not used;
/// - prose holds no bare `<placeholder>`, which the docs site reads as an
///   HTML element;
/// - docs/zh, the Chinese pages, are checked alike. Their links keep the
///   English anchors, which the docs site gives the Chinese headings in
///   their place, so an anchor into a zh page is one of its en page's (the
///   pairing of the two pages is tests/docs/translations.ts's).
///
///   node tests/docs/docs.ts

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DOCS = path.join(ROOT, "docs");
const EN = path.join(DOCS, "en");
const ZH = path.join(DOCS, "zh");

function markdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return markdown(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

/// VitePress's heading ids (@mdit-vue/shared's slugify), from the heading's
/// text without its markup.
function slug(heading: string): string {
  const text = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "");
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

/// The text of a page outside its code blocks, and its headings' and
/// anchors' ids.
function parse(page: string): { lines: string[]; ids: Set<string> } {
  const lines: string[] = [];
  const ids = new Set<string>();
  const seen = new Map<string, number>();
  let fence = "";
  for (const line of fs.readFileSync(page, "utf8").split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f && (!fence || f[1].startsWith(fence))) {
      fence = fence ? "" : f[1];
      lines.push("");
      continue;
    }
    if (fence) {
      lines.push("");
      continue;
    }
    lines.push(line);
    for (const a of line.matchAll(/<a id="([^"]+)"><\/a>/g)) ids.add(a[1]);
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const id = slug(h[1]);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      ids.add(n ? `${id}-${n}` : id);
    }
  }
  return { lines, ids };
}

const failures: string[] = [];
const pages = [EN, ZH].filter((d) => fs.existsSync(d)).flatMap(markdown);
const parsed = new Map(pages.map((p) => [p, parse(p)]));

/// The anchors a link into a page may name: a zh page's are its en page's.
function anchors(page: string): Set<string> {
  const en = page.startsWith(ZH + path.sep) ? parsed.get(path.join(EN, path.relative(ZH, page))) : undefined;
  return (en ?? parsed.get(page)!).ids;
}

/// Whether `block` is consecutive lines of `file`, all indented by what
/// indents the first (a step's lines in a YAML `run: |`, a list item).
function excerptOf(block: string[], file: string[]): boolean {
  outer: for (let i = 0; i + block.length <= file.length; i++) {
    const first = file[i]!;
    if (!first.endsWith(block[0]!)) continue;
    const indent = first.slice(0, first.length - block[0]!.length);
    if (indent.trim() !== "") continue;
    for (let k = 1; k < block.length; k++) {
      const line = file[i + k]!;
      if (block[k] === "" ? line.trim() !== "" : line !== indent + block[k]) continue outer;
    }
    return true;
  }
  return false;
}

/// Command blocks: what a reader runs, which CI must run as written. An
/// excerpt of one is of a workflow's steps or of examples/, never of a page.
const COMMANDS = new Set(["sh", "bash", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "cmd", "bat", "yaml", "yml"]);
const RUN = /^(\.github\/workflows\/|examples\/)/;

let blocks = 0;
let excerpts = 0;
let unrun = 0;
const shown = new Set<string>();
for (const page of pages) {
  const lines = fs.readFileSync(page, "utf8").split("\n");
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const where = `${path.relative(ROOT, page)}:${i + 1}`;
    const open = /^(\s*)(`{3,}|~{3,})(\S*)/.exec(lines[i]!);
    if (open && fence) {
      if (open[2]!.startsWith(fence)) fence = "";
      continue;
    }
    if (open) {
      fence = open[2]!;
      /// The marker, on the last non-blank line before the block.
      let k = i - 1;
      while (k >= 0 && lines[k]!.trim() === "") k--;
      const marked = k >= 0 && /^\s*<!-- (file|excerpt|not run): .*-->\s*$/.test(lines[k]!);
      if (COMMANDS.has(open[3]!.toLowerCase()) && !marked) {
        failures.push(`${where}: a ${open[3]} block without a file, excerpt or not run marker`);
      }
      continue;
    }
    if (fence) continue;
    if (/^\s*<!-- not run: \S.*-->\s*$/.test(lines[i]!)) {
      unrun++;
      continue;
    }
    const marker = /^\s*<!-- (file|excerpt): (\S+) -->\s*$/.exec(lines[i]!);
    if (!marker) continue;
    const [kind, name] = [marker[1]!, marker[2]!];
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    const block = /^(\s*)(`{3,}|~{3,})(\S*)/.exec(lines[j] ?? "");
    if (!block) {
      failures.push(`${where}: no code block after the marker`);
      continue;
    }
    if (kind === "excerpt" && COMMANDS.has(block[3]!.toLowerCase()) && !RUN.test(name)) {
      failures.push(`${where}: a ${block[3]} block is an excerpt of ${name}, which no workflow runs`);
    }
    /// The block's lines, without the indentation of its fence (a block in
    /// a list item).
    const [indent, ticks] = [block[1]!, block[2]!];
    const body: string[] = [];
    for (j++; j < lines.length && !lines[j]!.startsWith(indent + ticks); j++) {
      body.push(lines[j]!.startsWith(indent) ? lines[j]!.slice(indent.length) : lines[j]!);
    }
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) {
      failures.push(`${where}: ${name} does not exist`);
      continue;
    }
    shown.add(name);
    const want = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (kind === "file") {
      if (body.join("\n") !== want) failures.push(`${where}: the block is not ${name}`);
      blocks++;
    } else {
      if (!body.length || !excerptOf(body, want.split("\n"))) failures.push(`${where}: the block is not lines of ${name}`);
      excerpts++;
    }
  }
}

/// examples/: each directory built by examples.yml and shown by a page,
/// with the quick start's pixi.toml and the Bazel example's .bazelversion.
const EXAMPLES = path.join(ROOT, "examples");
const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "examples.yml"), "utf8");
const same: [string, string][] = [
  ["pixi.toml", "examples/quickstart/pixi.toml"],
  [".bazelversion", "examples/bazel/.bazelversion"],
];
for (const dir of fs.readdirSync(EXAMPLES, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const name = `examples/${dir.name}`;
  if (!new RegExp(`${name}(?![\\w-])`).test(workflow)) failures.push(`${name}: not built by examples.yml`);
  if (![...shown].some((f) => f.startsWith(`${name}/`))) failures.push(`${name}: no page shows a file of it`);
  for (const [file, model] of same) {
    const p = path.join(EXAMPLES, dir.name, file);
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8") !== fs.readFileSync(path.join(ROOT, model), "utf8")) {
      failures.push(`${name}/${file}: not the same as ${model}`);
    }
  }
}

/// A link to a file of this repository on GitHub's main, which the docs
/// on docs.clice.io follow: that file of the checkout.
const REPO = /^https:\/\/github\.com\/clice-io\/xclang\/(?:blob|tree)\/main\/([^#?]+)/;
let links = 0;
for (const [page, { lines }] of parsed) {
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      const where = `${path.relative(ROOT, page)}:${i + 1}`;
      const repoFile = REPO.exec(target)?.[1];
      if (repoFile) {
        links++;
        if (!fs.existsSync(path.join(ROOT, repoFile))) failures.push(`${where}: ${target}: no ${repoFile} in the repository`);
        continue;
      }
      if (/^[a-z]+:/.test(target) || target.startsWith("/")) continue;
      const [file, anchor] = target.split("#");
      const resolved = file ? path.resolve(path.dirname(page), file) : page;
      const doc = parsed.get(resolved.endsWith(".md") ? resolved : `${resolved}.md`);
      links++;
      if (!doc) {
        failures.push(`${where}: ${target}: no such page`);
      } else if (anchor && !anchors(resolved.endsWith(".md") ? resolved : `${resolved}.md`).has(anchor)) {
        failures.push(`${where}: ${target}: no such heading`);
      }
    }
  });
}

/// The home pages' frontmatter links (`link: ./guide/quick-start`), which
/// VitePress resolves as it does a page's links.
for (const [page] of parsed) {
  const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(page, "utf8"));
  if (!front) continue;
  for (const m of front[1]!.matchAll(/^\s*link: (\.{1,2}\/\S+)$/gm)) {
    const [file, anchor] = m[1]!.split("#");
    const target = path.resolve(path.dirname(page), `${file}.md`);
    links++;
    if (!parsed.has(target)) failures.push(`${path.relative(ROOT, page)}: ${m[1]}: no such page`);
    else if (anchor && !anchors(target).has(anchor)) failures.push(`${path.relative(ROOT, page)}: ${m[1]}: no such heading`);
  }
}

/// Links into the docs from the repository's own pages, as files
/// (docs/en/<group>/<page>.md#<id>, or docs/zh/...) or as the published
/// site (https://docs.clice.io/xclang/<group>/<page>#<id>, or
/// https://docs.clice.io/zh/xclang/...); their links to other files of the
/// repository, relative or on GitHub's main, reach a file.
const SITE = "https://docs.clice.io/xclang/";
const SITE_ZH = "https://docs.clice.io/zh/xclang/";
for (const name of ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "packages/README.md"]) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      let target = m[1];
      if (target.startsWith(SITE)) target = `docs/en/${target.slice(SITE.length)}`;
      else if (target.startsWith(SITE_ZH)) target = `docs/zh/${target.slice(SITE_ZH.length)}`;
      else if (REPO.test(target)) target = REPO.exec(target)![1]!;
      else if (/^[a-z]+:/.test(target)) continue;
      else target = path.relative(ROOT, path.resolve(path.dirname(file), target));
      if (!/^docs\/(en|zh)\//.test(target)) {
        links++;
        const there = target.split("#")[0]!;
        if (!fs.existsSync(path.join(ROOT, there))) failures.push(`${name}:${i + 1}: ${m[1]}: no ${there} in the repository`);
        continue;
      }
      const [page, anchor] = target.split("#");
      if (/^docs\/(en|zh)\/?$/.test(page)) continue;
      const doc = path.join(ROOT, page.endsWith(".md") ? page : `${page}.md`);
      links++;
      if (!parsed.has(doc)) failures.push(`${name}:${i + 1}: ${m[1]}: no such page`);
      else if (anchor && !anchors(doc).has(anchor)) failures.push(`${name}:${i + 1}: ${m[1]}: no such heading`);
    }
  });
}

/// The roadmap's status words (docs/en/design/roadmap.md), in a column
/// `status` (`状态` in docs/zh, with the words' fixed translations), and
/// phrasings that state no status.
const STATUS = new Set(["Supported", "Unreleased", "Planned", "In research", "Considered", "Not planned"]);
const STATUS_ZH = new Set(["已支持", "未发布", "计划中", "研究中", "考虑中", "不计划"]);
const VAGUE: [RegExp, string][] = [
  [/\b(is|are) to be\b/i, '"is to be": say planned, in research or considered'],
  [/\bbeing considered\b/i, '"being considered": the status is "considered"'],
  [/\*\*Missing\.\*\*/, '"**Missing.**": say "Not yet supported" or "Known issues"'],
  [/\bnot there yet\b/i, '"not there yet": give the status'],
  [/\bseed\b/i, '"seed": give the status'],
  [/^#+\s+Open\s*$/, 'a heading "Open": use "Not Yet Supported"'],
];

let statuses = 0;
for (const [page, { lines }] of parsed) {
  const zh = page.startsWith(ZH + path.sep);
  const [header, words] = zh ? ["状态", STATUS_ZH] : ["status", STATUS];
  let column = -1;
  lines.forEach((line, i) => {
    const where = `${path.relative(ROOT, page)}:${i + 1}`;
    for (const [re, why] of VAGUE) if (re.test(line)) failures.push(`${where}: ${why}`);
    if (!line.startsWith("|")) {
      column = -1;
      return;
    }
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    if (column === -1 && !/^\|[-|: ]+\|?\s*$/.test(line)) {
      column = cells.findIndex((c) => c.toLowerCase() === header);
      if (column === -1) column = -2;
      return;
    }
    if (column < 0 || /^\|[-|: ]+\|?\s*$/.test(line)) return;
    statuses++;
    if (!words.has(cells[column] ?? "")) {
      failures.push(`${where}: status "${cells[column]}" is not one of ${[...words].join(", ")}`);
    }
  });
}

/// Prose holds no bare `<word>`: VitePress reads it as an HTML element, and
/// one without an end tag fails the site's build. A placeholder goes in a
/// code span. Code blocks, code spans (which may span lines, not
/// paragraphs) and comments are blanked first, keeping offsets for line
/// numbers.
/// A line that starts with `<word` is an HTML block to VitePress even in
/// the middle of a code span that spans lines (GitHub's CommonMark keeps it
/// in the span): such a span is reflowed so the line starts with a word.
const HTML = new Set(["a", "br", "details", "summary", "div", "span", "sup", "sub", "kbd", "img", "table", "tr", "td", "th"]);
for (const page of pages) {
  let fenced = false;
  const outsideBlocks = fs
    .readFileSync(page, "utf8")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      return fenced || /^\s*```/.test(line) ? " ".repeat(line.length) : line;
    })
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  outsideBlocks.split("\n").forEach((text, i) => {
    const m = /^\s*<\/?([A-Za-z][\w-]*)/.exec(text);
    if (m && !HTML.has(m[1]!.toLowerCase())) {
      failures.push(`${path.relative(ROOT, page)}:${i + 1}: a line that starts with <${m[1]} is an HTML block to VitePress, also inside a code span: reflow it`);
    }
  });
  const text = outsideBlocks.replace(/(`+)(?:(?!\n\s*\n)[\s\S])*?\1/g, (m) => m.replace(/[^\n]/g, " "));
  for (const m of text.matchAll(/<\/?([A-Za-z][\w-]*)[^<>\n]*>/g)) {
    if (HTML.has(m[1]!.toLowerCase())) continue;
    const line = text.slice(0, m.index).split("\n").length;
    failures.push(`${path.relative(ROOT, page)}:${line}: ${m[0]} outside code reads as an HTML element: put it in backticks`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  process.exit(1);
}
console.log(
  `ok: ${blocks} code blocks are their files, ${excerpts} are lines of them (${unrun} not run, each saying why), ` +
    `${links} links reach their pages and headings, ${statuses} status cells are status words`,
);
