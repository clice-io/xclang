/// Check a repack: archives of a release whose compiler and runtimes are an
/// earlier release's (release.yml with reuse-run, no toolchain stage) against
/// that release's archives of the same names, file by file:
///
///   node tests/release/repack.ts --previous <dir> --dist <dir>
///
/// Every archive of <dist> has its counterpart in <previous>, the version
/// in the name aside. Each pair is read as a stream (xz | tar, nothing
/// unpacked), and every member compared: its kind, mode, link target and
/// the sha256 of its bytes. Only what toolchain/package.ts writes from the
/// checkout may differ: the config files, the CMake package, the xclang
/// command, the license notices and the runtimes' sources (libc++/src,
/// from the pinned LLVM source and patches/). Any other file that differs, comes or
/// goes fails the check; the programs, libraries and headers are the
/// earlier release's, byte for byte. The members that differ are listed,
/// also in the job summary.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";

const { values } = parseArgs({ options: { previous: { type: "string" }, dist: { type: "string" } } });
if (!values.previous || !values.dist) common.fail("--previous <dir> --dist <dir>");

/// What the packaging writes, below an archive's top directory: these may
/// differ between a release and its repack.
const PACKAGING = [
  /^bin\/xclang(\.exe)?$/,
  /^bin\/[^/]+\.cfg$/,
  /^lib\/cmake\/xclang(\/|$)/,
  /^share\/licenses(\/|$)/,
  /^LICENSE$/,
  /^libc\+\+\/src(\/|$)/,
];

/// xclang-<version>-<host>.tar.xz and the like, keyed by the name without
/// the version.
function archives(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of fs.readdirSync(dir)) {
    const m = /^(.*?)-(\d+\.\d+\.\d+\.\d+)(.*)\.tar\.xz$/.exec(file);
    if (m) found.set(`${m[1]}-<version>${m[3]}`, path.join(dir, file));
  }
  return found;
}

interface Member {
  kind: "file" | "dir" | "symlink" | "hardlink";
  mode: number;
  /// The sha256 of a file's bytes; a link's target.
  content: string;
}

/// Reads exact byte counts from a stream of chunks.
class Reader {
  private chunks: Buffer[] = [];
  private length = 0;
  private source: AsyncIterator<Buffer>;
  constructor(source: AsyncIterator<Buffer>) {
    this.source = source;
  }

  private async fill(n: number): Promise<boolean> {
    while (this.length < n) {
      const { value, done } = await this.source.next();
      if (done) return false;
      this.chunks.push(value);
      this.length += value.length;
    }
    return true;
  }

  /// Hand the next n bytes to sink, in pieces.
  async feed(n: number, sink: (piece: Buffer) => void): Promise<void> {
    while (n > 0) {
      if (!await this.fill(1)) common.fail("truncated tar stream");
      const head = this.chunks[0]!;
      const piece = head.subarray(0, Math.min(n, head.length));
      sink(piece);
      n -= piece.length;
      this.length -= piece.length;
      if (piece.length === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(piece.length);
    }
  }

  /// The next n bytes, or null at the end of the stream.
  async take(n: number): Promise<Buffer | null> {
    if (!await this.fill(n)) return null;
    const pieces: Buffer[] = [];
    await this.feed(n, (piece) => pieces.push(piece));
    return Buffer.concat(pieces);
  }
}

const field = (block: Buffer, start: number, length: number) => {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? length : end).toString("utf8");
};
const octal = (block: Buffer, start: number, length: number) => parseInt(field(block, start, length).trim() || "0", 8);

/// The members of a .tar.xz (GNU or ustar format), by their path below the
/// archive's top directory.
async function members(archive: string): Promise<Map<string, Member>> {
  const xz = spawn("xz", ["-dc", "-T0", archive], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise<number | null>((resolve) => xz.on("close", resolve));
  const reader = new Reader(xz.stdout[Symbol.asyncIterator]());
  const found = new Map<string, Member>();
  let longName: string | undefined;
  let longLink: string | undefined;
  for (;;) {
    const block = await reader.take(512);
    if (!block || block.every((b) => b === 0)) break;
    const type = String.fromCharCode(block[156]!);
    const size = octal(block, 124, 12);
    const padded = Math.ceil(size / 512) * 512;
    if (type === "L" || type === "K") {
      const data = (await reader.take(padded))!.subarray(0, size);
      const text = data.toString("utf8").replace(/\0+$/, "");
      if (type === "L") longName = text;
      else longLink = text;
      continue;
    }
    const prefix = field(block, 257, 6) === "ustar" ? field(block, 345, 155) : "";
    const name = (longName ?? (prefix ? `${prefix}/` : "") + field(block, 0, 100)).replace(/\/$/, "");
    const link = longLink ?? field(block, 157, 100);
    longName = longLink = undefined;
    const mode = octal(block, 100, 8) & 0o7777;
    const below = name.slice(name.indexOf("/") + 1);
    if (type === "0" || type === "\0" || type === "7") {
      const hash = createHash("sha256");
      await reader.feed(size, (piece) => hash.update(piece));
      await reader.feed(padded - size, () => {});
      found.set(below, { kind: "file", mode, content: hash.digest("hex") });
    } else {
      await reader.feed(padded, () => {});
      if (!name.includes("/")) continue;
      const kind = type === "5" ? "dir" : type === "2" ? "symlink" : type === "1" ? "hardlink" : undefined;
      if (!kind) common.fail(`${archive}: ${name} is of tar type ${JSON.stringify(type)}`);
      found.set(below, { kind, mode, content: kind === "dir" ? "" : link });
    }
  }
  while (await reader.take(1 << 16));
  const status = await exited;
  if (status !== 0) common.fail(`xz -dc ${archive} exited with ${status}`);
  return found;
}

const previous = archives(values.previous);
const dist = archives(values.dist);
if (!dist.size) common.fail(`no archives in ${values.dist}`);
const lines: string[] = [];
let unexpected = 0;
for (const [key, file] of [...dist].sort()) {
  const before = previous.get(key);
  if (!before) common.fail(`${path.basename(file)} has no counterpart in ${values.previous}`);
  const [old, now] = await Promise.all([members(before), members(file)]);
  const differ: string[] = [];
  let same = 0;
  for (const name of [...new Set([...old.keys(), ...now.keys()])].sort()) {
    const a = old.get(name);
    const b = now.get(name);
    if (a && b && a.kind === b.kind && a.mode === b.mode && a.content === b.content) {
      same++;
      continue;
    }
    const what = !a ? "added" : !b ? "removed" : a.kind !== b.kind ? `${a.kind} → ${b.kind}`
      : a.mode !== b.mode ? `mode ${a.mode.toString(8)} → ${b.mode.toString(8)}` : "content";
    const expected = PACKAGING.some((p) => p.test(name));
    if (!expected) unexpected++;
    differ.push(`  ${expected ? "packaging" : "UNEXPECTED"}  ${name} (${what})`);
  }
  lines.push(`${path.basename(before)} → ${path.basename(file)}: ${now.size} members, ${same} the same, ${differ.length} differ`);
  lines.push(...differ);
  console.log(lines.slice(-1 - differ.length).join("\n"));
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["```", ...lines, "```", ""].join("\n"));
}
if (unexpected) common.fail(`${unexpected} members differ that the packaging does not write`);
