/// The Bazel module of a release (MODULE.bazel, bazel/), from its SHA256SUMS:
///
///   node scripts/bazel.ts versions <SHA256SUMS>
///       bazel/versions.bzl: the release's version and the sha256 of each
///       of its archives
///   node scripts/bazel.ts archive <SHA256SUMS> <dir>
///       <dir>/xclang-bazel-<version>.tar.gz: the module at that release,
///       the source a consumer's archive_override names; prints its
///       integrity
///
/// The release is tagged before its archives exist, so the module of the
/// tag cannot hold their digests: the archive made here, an asset of the
/// release, does.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as common from "./common.ts";

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
  fs.writeFileSync(path.join(common.ROOT, "bazel", "versions.bzl"), versions);
  console.log(`bazel/versions.bzl: ${version}, ${archives.size} archives`);
} else {
  const name = `xclang-bazel-${version}`;
  const stage = path.join(common.WORK, "bazel-module");
  const root = path.join(stage, name);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "bazel"), { recursive: true });
  /// MODULE.bazel at the release's version, bazel/ with its digests.
  const module = fs.readFileSync(path.join(common.ROOT, "MODULE.bazel"), "utf8");
  const versioned = module.replace(/^(    version = )"[^"]*",$/m, `$1"${version}",`);
  if (versioned === module && !module.includes(`version = "${version}"`)) common.fail("no version in MODULE.bazel");
  fs.writeFileSync(path.join(root, "MODULE.bazel"), versioned);
  for (const file of ["LICENSE", "REPO.bazel"]) fs.copyFileSync(path.join(common.ROOT, file), path.join(root, file));
  common.copyTree(path.join(common.ROOT, "bazel"), path.join(root, "bazel"));
  fs.writeFileSync(path.join(root, "bazel", "versions.bzl"), versions);
  /// The same bytes from the same sources: sorted, no owners or times.
  fs.mkdirSync(dir!, { recursive: true });
  const out = path.resolve(dir!, `${name}.tar.gz`);
  common.run("bash", ["-c", `set -o pipefail; tar -C "$0" --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - "$1" | gzip -9n > "$2"`,
    stage, name, out]);
  const integrity = `sha256-${createHash("sha256").update(fs.readFileSync(out)).digest("base64")}`;
  console.log(`${out}\nintegrity ${integrity}`);
}
