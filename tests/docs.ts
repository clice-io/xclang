/// Checks of docs/ that need no build:
///
/// - the files and commands the docs show are the ones CI runs. A code
///   block under `<!-- file: <path> -->` must be that file of the
///   repository, byte for byte (but for the final newline). A block under
///   `<!-- excerpt: <path> -->` must be consecutive lines of it, indented
///   alike: a command block is a step of .github/workflows/examples.yml, a
///   fragment a part of a file in examples/;
/// - every command block (sh, powershell, yaml) of a page outside dev/ has
///   one of those markers, or `<!-- not run: <why> -->` saying why CI does
///   not run it;
/// - every directory of examples/ is built by examples.yml and shown by a
///   page, and its pixi.toml and .bazelversion are those of the quick start
///   and the Bazel example, so a release changes one version of each;
/// - every relative link names a page that exists, and a heading of it
///   when it has an anchor, slugged as the docs site (VitePress) does, or
///   an `<a id="...">` of it (the roadmap's rows); so does every link into
///   docs/en from the README, the CHANGELOG and the other top-level pages,
///   as a file or as a docs.clice.io/xclang URL;
/// - what is not shipped is said one way: a table's `status` column holds
///   one of the roadmap's six words, and the phrasings that left a status
///   unclear ("is to be", "being considered", a bare "**Missing.**") are
///   not used.
///
///   node tests/docs.ts

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(ROOT, "docs");

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
const pages = markdown(DOCS);
const parsed = new Map(pages.map((p) => [p, parse(p)]));

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

/// Command blocks: what a reader runs, which CI must run as written.
const COMMANDS = new Set(["sh", "bash", "console", "powershell", "pwsh", "yaml", "yml"]);

let blocks = 0;
let excerpts = 0;
let unrun = 0;
const shown = new Set<string>();
for (const page of pages) {
  const lines = fs.readFileSync(page, "utf8").split("\n");
  const dev = path.relative(DOCS, page).split(path.sep).includes("dev");
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
      if (!dev && COMMANDS.has(open[3]!.toLowerCase()) && !marked) {
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
    const block = /^(\s*)(`{3,}|~{3,})/.exec(lines[j] ?? "");
    if (!block) {
      failures.push(`${where}: no code block after the marker`);
      continue;
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

let links = 0;
for (const [page, { lines }] of parsed) {
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/.test(target) || target.startsWith("/")) continue;
      const where = `${path.relative(ROOT, page)}:${i + 1}`;
      const [file, anchor] = target.split("#");
      const resolved = file ? path.resolve(path.dirname(page), file) : page;
      const doc = parsed.get(resolved.endsWith(".md") ? resolved : `${resolved}.md`);
      links++;
      if (!doc) {
        failures.push(`${where}: ${target}: no such page`);
      } else if (anchor && !doc.ids.has(anchor)) {
        failures.push(`${where}: ${target}: no such heading`);
      }
    }
  });
}

/// Links into the docs from the repository's own pages, as files
/// (docs/en/<group>/<page>.md#<id>) or as the published site
/// (https://docs.clice.io/xclang/<group>/<page>#<id>).
const SITE = "https://docs.clice.io/xclang/";
for (const name of ["README.md", "README.zh-CN.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "packages/README.md"]) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      let target = m[1];
      if (target.startsWith(SITE)) target = `docs/en/${target.slice(SITE.length)}`;
      else if (/^[a-z]+:/.test(target)) continue;
      else target = path.relative(ROOT, path.resolve(path.dirname(file), target));
      if (!target.startsWith("docs/en/")) continue;
      const [page, anchor] = target.split("#");
      if (page === "docs/en" || page === "docs/en/") continue;
      const doc = parsed.get(path.join(ROOT, page.endsWith(".md") ? page : `${page}.md`));
      links++;
      if (!doc) failures.push(`${name}:${i + 1}: ${m[1]}: no such page`);
      else if (anchor && !doc.ids.has(anchor)) failures.push(`${name}:${i + 1}: ${m[1]}: no such heading`);
    }
  });
}

/// The roadmap's status words (docs/en/design/roadmap.md), and phrasings
/// that state no status.
const STATUS = new Set(["Supported", "Unreleased", "Planned", "In research", "Considered", "Not planned"]);
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
      column = cells.findIndex((c) => c.toLowerCase() === "status");
      if (column === -1) column = -2;
      return;
    }
    if (column < 0 || /^\|[-|: ]+\|?\s*$/.test(line)) return;
    statuses++;
    if (!STATUS.has(cells[column] ?? "")) {
      failures.push(`${where}: status "${cells[column]}" is not one of ${[...STATUS].join(", ")}`);
    }
  });
}

if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  process.exit(1);
}
console.log(
  `ok: ${blocks} code blocks are their files, ${excerpts} are lines of them (${unrun} not run, each saying why), ` +
    `${links} links reach their pages and headings, ${statuses} status cells are status words`,
);
