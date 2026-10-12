/// The Bazel module of a release (packages/bazel), from its SHA256SUMS:
///
///   node packages/bazel/bazel.ts versions <SHA256SUMS>
///       packages/bazel/bazel/versions.bzl: the release's version and the
///       sha256 of each of its archives; and the version of
///       packages/bazel/MODULE.bazel
///   node packages/bazel/bazel.ts check <SHA256SUMS>
///       fails if those name an older release than that one, or that one
///       with other digests (checks.yml, with the latest release's)
///   node packages/bazel/bazel.ts archive <SHA256SUMS> <dir>
///       <dir>/xclang-bazel-<version>.tar.gz: packages/bazel at that
///       release, its source archive in the clice Bazel registry
///       (published.yml publishes it); prints its integrity
///
/// A release's archives are built before their digests exist, so its draft
/// is made at a commit of its own (stage-draft.yml): the run's, with the
/// module at the release (versions). Its tag, and main fast-forwarded to
/// it, name the release: a git_override of either downloads its archives.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as common from "../../toolchain/common.ts";

const MODULE = import.meta.dirname;
const [command, sums, dir] = process.argv.slice(2);
if (!sums || !["versions", "check", "archive"].includes(command!) || (command === "archive" && !dir)) {
  common.fail("versions <SHA256SUMS> | check <SHA256SUMS> | archive <SHA256SUMS> <dir>");
}

const archives = new Map<string, string>();
for (const line of fs.readFileSync(sums, "utf8").split("\n")) {
  const match = /^([0-9a-f]{64}) [ *](\S+\.tar\.xz)$/.exec(line.trim());
  if (match) archives.set(match[2]!, match[1]!);
}
const version = [...archives.keys()].map((f) => /^llvm-option-inc-(.+)\.tar\.xz$/.exec(f)?.[1]).find(Boolean);
if (!version) common.fail(`no llvm-option-inc archive in ${sums}`);

const versions = `"""The release the module stands for: its version, and the sha256 of each
of its archives (packages/bazel/bazel.ts, from the release's SHA256SUMS)."""

VERSION = "${version}"

SHA256 = {
${[...archives].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, sha]) => `    "${f}": "${sha}",`).join("\n")}
}
`;

/// MODULE.bazel with the version of the module given.
const moduleFile = path.join(MODULE, "MODULE.bazel");
const versionsFile = path.join(MODULE, "bazel", "versions.bzl");
const versioned = (module: string): string => {
  const out = module.replace(/^(    version = )"[^"]*",$/m, `$1"${version}",`);
  if (out === module && !module.includes(`version = "${version}"`)) common.fail("no version in MODULE.bazel");
  return out;
};

if (command === "versions") {
  fs.writeFileSync(versionsFile, versions);
  fs.writeFileSync(moduleFile, versioned(fs.readFileSync(moduleFile, "utf8")));
  console.log(`packages/bazel: ${version}, ${archives.size} archives`);
} else if (command === "check") {
  const named = /^VERSION = "([^"]+)"$/m.exec(fs.readFileSync(versionsFile, "utf8"))?.[1] ?? "";
  const declared = /^    version = "([^"]+)",$/m.exec(fs.readFileSync(moduleFile, "utf8"))?.[1] ?? "";
  /// Versions compared part by part, as numbers.
  const order = (a: string, b: string): number => {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
      if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) - (y![i] ?? 0);
    }
    return 0;
  };
  const fix = `node packages/bazel/bazel.ts versions <its SHA256SUMS>`;
  if (named !== declared) common.fail(`versions.bzl names ${named}, MODULE.bazel ${declared}: ${fix}`);
  if (order(named, version) < 0) {
    common.fail(`packages/bazel names ${named}, older than the release ${version}, whose archives a git_override ` +
      `of this commit would not download: ${fix}`);
  }
  if (named === version && fs.readFileSync(versionsFile, "utf8") !== versions) {
    common.fail(`versions.bzl names ${version} with other digests than its SHA256SUMS: ${fix}`);
  }
  console.log(`packages/bazel: ${named}, not older than ${version}`);
} else {
  const name = `xclang-bazel-${version}`;
  const stage = path.join(common.WORK, "bazel-module");
  const root = path.join(stage, name);
  fs.rmSync(stage, { recursive: true, force: true });
  /// packages/bazel without its scripts (this one, runtimes.ts) and what a
  /// build in it leaves, and the license; MODULE.bazel at the release's
  /// version, bazel/ with its digests.
  fs.cpSync(MODULE, root, {
    recursive: true,
    filter: (src) => !/^(bazel-.*|MODULE\.bazel\.lock|bazel\.ts|runtimes\.ts)$/.test(path.relative(MODULE, src)),
  });
  fs.copyFileSync(path.join(common.ROOT, "LICENSE"), path.join(root, "LICENSE"));
  fs.writeFileSync(path.join(root, "MODULE.bazel"), versioned(fs.readFileSync(moduleFile, "utf8")));
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
