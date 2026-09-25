/// Put one host's release archives together in work/dist:
///
///   xclang-<version>-<host>      the toolchain of work/out/toolchain-<host>,
///                                with every target of work/out/runtimes-*
///   libclang-<version>-<host>    work/out/libclang-<host>
///   libclang-<version>-<host>-asan  work/out/libclang-<host>-asan, if built
///
/// .tar.xz, or .zip for the Windows hosts, where tar cannot be relied on
/// for xz. zip has no symlinks, so a Windows archive keeps the names that
/// matter (clang++, ld.lld, lld-link, ...) as copies and drops the rest.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    revision: { type: "string", default: "1" },
  },
});
if (!values.host) common.fail("--host <triple> [--revision <n>]");
const host = common.target(values.host);
const version = `${common.LLVM_VERSION}.${values.revision}`;
const out = path.join(common.WORK, "out");
const dist = path.join(common.WORK, "dist");
fs.mkdirSync(dist, { recursive: true });

const runtimes = fs.readdirSync(out).filter((d) => d.startsWith("runtimes-")).map((d) => path.join(out, d));
if (runtimes.length !== 5) common.fail(`expected the runtimes of all targets in ${out}, found ${runtimes.length}`);

/// Aliases a Windows toolchain does without: every copy costs the size of
/// the program it names.
const WINDOWS_DROPPED = ["clang-cl", "clang-cpp", "ld64.lld", "wasm-ld", "lld", `clang-${common.LLVM_MAJOR}`];

function archive(dir: string, name: string): void {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  if (host.os === "mingw") {
    const file = path.join(dist, `${name}.zip`);
    fs.rmSync(file, { force: true });
    /// Without -y, zip stores what a symlink points to.
    common.run("zip", ["-q", "-r", "-9", file, base], { cwd: parent });
  } else {
    const file = path.join(dist, `${name}.tar.xz`);
    common.run("bash", ["-c", `set -o pipefail; tar -C "$0" -cf - "$1" | xz -T0 -9 > "$2"`, parent, base, file]);
  }
}

const toolchain = path.join(out, `toolchain-${host.triple}`);
if (!fs.existsSync(path.join(toolchain, "bin"))) common.fail(`missing ${toolchain}`);
const tree = common.makeTree(path.join(common.WORK, "package", host.triple, "xclang"), toolchain, runtimes);
fs.copyFileSync(path.join(common.ROOT, "LICENSE"), path.join(tree, "LICENSE"));
if (host.os === "mingw") {
  /// The kept aliases become copies first: what they point to may be one
  /// of the dropped names (clang-23.exe, lld.exe).
  const bin = path.join(tree, "bin");
  const dropped = new Set(WINDOWS_DROPPED.map((n) => `${n}.exe`));
  for (const name of fs.readdirSync(bin)) {
    const file = path.join(bin, name);
    if (dropped.has(name) || !fs.lstatSync(file).isSymbolicLink()) continue;
    const real = fs.realpathSync(file);
    fs.rmSync(file);
    fs.copyFileSync(real, file);
  }
  for (const name of dropped) fs.rmSync(path.join(bin, name), { force: true });
}
archive(tree, `xclang-${version}-${host.triple}`);

for (const variant of ["", "-asan"]) {
  const libclang = path.join(out, `libclang-${host.triple}${variant}`);
  if (!fs.existsSync(libclang)) continue;
  const dir = path.join(common.WORK, "package", host.triple, `libclang${variant}`);
  fs.rmSync(dir, { recursive: true, force: true });
  common.copyTree(libclang, dir);
  archive(dir, `libclang-${version}-${host.triple}${variant}`);
}

for (const file of fs.readdirSync(dist)) {
  console.log(`${(fs.statSync(path.join(dist, file)).size / 1048576).toFixed(0).padStart(6)} MB  ${file}`);
}
