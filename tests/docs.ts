/// The files the docs show are the files examples.yml builds: every code
/// block under a `<!-- file: <path> -->` line in docs/ must be that file of
/// the repository, byte for byte (but for the final newline).
///
///   node tests/docs.ts

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function markdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return markdown(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

const failures: string[] = [];
let checked = 0;
for (const page of markdown(path.join(ROOT, "docs"))) {
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
    checked++;
  }
}

if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  process.exit(1);
}
console.log(`ok: ${checked} code blocks are their files`);
