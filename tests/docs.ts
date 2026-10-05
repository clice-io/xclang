/// Checks of docs/ that need no build:
///
/// - the files the docs show are the files examples.yml builds: every code
///   block under a `<!-- file: <path> -->` line must be that file of the
///   repository, byte for byte (but for the final newline);
/// - every relative link names a page that exists, and a heading of it
///   when it has an anchor, slugged as the docs site (VitePress) does, or
///   an `<a id="...">` of it (the roadmap's rows);
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

let blocks = 0;
for (const page of pages) {
  const lines = fs.readFileSync(page, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*<!-- file: (\S+) -->\s*$/.exec(lines[i]);
    if (!marker) continue;
    const where = `${path.relative(ROOT, page)}:${i + 1}`;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const fence = /^(\s*)(`{3,}|~{3,})/.exec(lines[j] ?? "");
    if (!fence) {
      failures.push(`${where}: no code block after the marker`);
      continue;
    }
    /// The block's lines, without the indentation of its fence (a block in
    /// a list item).
    const [indent, ticks] = [fence[1], fence[2]];
    const body: string[] = [];
    for (j++; j < lines.length && !lines[j].startsWith(indent + ticks); j++) {
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    const file = path.join(ROOT, marker[1]);
    if (!fs.existsSync(file)) {
      failures.push(`${where}: ${marker[1]} does not exist`);
      continue;
    }
    const want = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (body.join("\n") !== want) failures.push(`${where}: the block is not ${marker[1]}`);
    blocks++;
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
  `ok: ${blocks} code blocks are their files, ${links} links reach their pages and headings, ` +
    `${statuses} status cells are status words`,
);
