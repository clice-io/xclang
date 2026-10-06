/// The Bazel module of a release (packages/bazel), from its SHA256SUMS:
///
///   node scripts/bazel.ts versions <SHA256SUMS>
///       packages/bazel/bazel/versions.bzl: the release's version and the
///       sha256 of each of its archives
///   node scripts/bazel.ts archive <SHA256SUMS> <dir>
///       <dir>/xclang-bazel-<version>.tar.gz: packages/bazel at that
///       release, its source archive in the clice Bazel registry (bazel.yml
///       publishes it); prints its integrity
///
/// The release is tagged before its archives exist, so the module of the
/// tag cannot hold their digests: the archive made here does.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as common from "./common.ts";

const MODULE = path.join(common.ROOT, "packages", "bazel");
const [command, sums, dir] = process.argv.slice(2);
if (!sums || !["versions", "archive"].includes(command!) || (command === "archive" && !dir)) {
  common.fail("versions <SHA256SUMS> | archive <SHA256SUMS> <dir>");
}

const archives = new Map<string, string>();
for (const line of fs.readFileSync(sums, "utf8").split("\n")) {
  const match = /^([0-9a-f]{64}) [ *](\S+\.tar\.xz)$/.exec(line.trim());
  if (match) archives.set(match[2]!, match[1]!);
}
const version = [...archives.keys()].map((f) => /^llvm-option-inc-(.+)\.tar\.xz$/.exec(f)?.[1]).find(Boolean);
if (!version) common.fail(`no llvm-option-inc archive in ${sums}`);

const versions = `"""The release the module stands for: its version, and the sha256 of each
of its archives (scripts/bazel.ts, from the release's SHA256SUMS)."""

VERSION = "${version}"

SHA256 = {
${[...archives].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, sha]) => `    "${f}": "${sha}",`).join("\n")}
}
`;

if (command === "versions") {
  fs.writeFileSync(path.join(MODULE, "bazel", "versions.bzl"), versions);
  console.log(`packages/bazel/bazel/versions.bzl: ${version}, ${archives.size} archives`);
} else {
  const name = `xclang-bazel-${version}`;
  const stage = path.join(common.WORK, "bazel-module");
  const root = path.join(stage, name);
  fs.rmSync(stage, { recursive: true, force: true });
  /// packages/bazel without what a build in it leaves, and the license;
  /// MODULE.bazel at the release's version, bazel/ with its digests.
  fs.cpSync(MODULE, root, {
    recursive: true,
    filter: (src) => !/^(bazel-.*|MODULE\.bazel\.lock)$/.test(path.relative(MODULE, src)),
  });
  fs.copyFileSync(path.join(common.ROOT, "LICENSE"), path.join(root, "LICENSE"));
  const module = fs.readFileSync(path.join(MODULE, "MODULE.bazel"), "utf8");
  const versioned = module.replace(/^(    version = )"[^"]*",$/m, `$1"${version}",`);
  if (versioned === module && !module.includes(`version = "${version}"`)) common.fail("no version in MODULE.bazel");
  fs.writeFileSync(path.join(root, "MODULE.bazel"), versioned);
  fs.writeFileSync(path.join(root, "bazel", "versions.bzl"), versions);
  /// The same bytes from the same files, on any host (tests/bazel/bazel.ts makes
  /// one on each): a ustar archive written here, sorted, with no owners or
  /// times, gzipped by Node's zlib with the header's OS byte "unknown".
  const blocks: Buffer[] = [];
  const add = (entry: string) => {
    const file = path.join(stage, entry);
    if (fs.statSync(file).isDirectory()) {
      blocks.push(header(`${entry}/`, 0, "5", 0o755));
      for (const child of fs.readdirSync(file).sort()) add(`${entry}/${child}`);
    } else {
      const data = fs.readFileSync(file);
      blocks.push(header(entry, data.length, "0", 0o644), data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  };
  add(name);
  blocks.push(Buffer.alloc(1024));
  const gz = zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
  gz[9] = 255;
  fs.mkdirSync(dir!, { recursive: true });
  const out = path.resolve(dir!, `${name}.tar.gz`);
  fs.writeFileSync(out, gz);
  console.log(`${out}\nintegrity sha256-${createHash("sha256").update(gz).digest("base64")}`);
}

function header(entry: string, size: number, type: string, mode: number): Buffer {
  const block = Buffer.alloc(512);
  const field = (offset: number, length: number, value: string) => block.write(value, offset, length, "ascii");
  const octal = (offset: number, length: number, value: number) => field(offset, length, value.toString(8).padStart(length - 1, "0"));
  if (entry.length > 100) common.fail(`${entry}: too long for a ustar name`);
  field(0, 100, entry);
  octal(100, 8, mode);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  field(148, 8, " ".repeat(8));
  field(156, 1, type);
  field(257, 8, "ustar\u000000");
  const sum = block.reduce((total, byte) => total + byte, 0);
  field(148, 8, `${sum.toString(8).padStart(6, "0")}\u0000 `);
  return block;
}
