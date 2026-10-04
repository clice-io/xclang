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
import zlib from "node:zlib";
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
/// The same bytes from the same sources, on any host (tests/cmake.ts makes
/// one on each): a ustar archive written here, sorted, with no owners or
/// times, gzipped by Node's zlib with the header's OS byte "unknown".
const files = fs.readdirSync(path.join(stage, name)).sort();
const blocks: Buffer[] = [header(`${name}/`, 0, "5", 0o755)];
for (const file of files) {
  const data = fs.readFileSync(path.join(stage, name, file));
  blocks.push(header(`${name}/${file}`, data.length, "0", 0o644), data, Buffer.alloc((512 - (data.length % 512)) % 512));
}
blocks.push(Buffer.alloc(1024));
const gz = zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
gz[9] = 255;
fs.mkdirSync(dir, { recursive: true });
const out = path.resolve(dir, `${name}.tar.gz`);
fs.writeFileSync(out, gz);
console.log(`${out}\nsha256 ${createHash("sha256").update(gz).digest("hex")}`);

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
