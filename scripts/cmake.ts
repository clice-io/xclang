/// xclang's CMake package (cmake-package/) of a release, from its SHA256SUMS:
///
///   node scripts/cmake.ts archive <SHA256SUMS> <dir>
///       <dir>/xclang-cmake-<version>.tar.gz: the package with xclang.cmake
///       and the release's SHA256SUMS, for FetchContent before project();
///       xclang.cmake downloads the host's toolchain by its digest there.
///       Prints its sha256.
///
/// The release is tagged before its archives exist, so no file of the tag
/// can hold their digests: this archive does, and the release's
/// SHA256SUMS then holds its own. (Every toolchain archive holds the
/// package too, without xclang.cmake: scripts/package.ts.)

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as common from "./common.ts";

const [command, sums, dir] = process.argv.slice(2);
if (command !== "archive" || !sums || !dir) common.fail("archive <SHA256SUMS> <dir>");

const version = fs.readFileSync(sums, "utf8").split("\n")
  .map((line) => /^[0-9a-f]{64} [ *]xclang-(\d+\.\d+\.\d+\.\d+)-[^ ]+\.tar\.xz$/.exec(line.trim())?.[1])
  .find(Boolean);
if (!version) common.fail(`no xclang toolchain archive in ${sums}`);

const name = `xclang-cmake-${version}`;
const stage = path.join(common.WORK, "cmake-package");
fs.rmSync(stage, { recursive: true, force: true });
common.writeCMakePackage(path.join(stage, name), version, sums);
/// The same bytes from the same sources: sorted, no owners or times.
fs.mkdirSync(dir, { recursive: true });
const out = path.resolve(dir, `${name}.tar.gz`);
common.run("bash", ["-c", `set -o pipefail; tar -C "$0" --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - "$1" | gzip -9n > "$2"`,
  stage, name, out]);
console.log(`${out}\nsha256 ${createHash("sha256").update(fs.readFileSync(out)).digest("hex")}`);
