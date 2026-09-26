/// Put one host's release archives together in work/dist, as .tar.xz:
///
///   xclang-<version>-<host>      the toolchain of work/out/toolchain-<host>,
///                                with every target of work/out/runtimes-*
///   libclang-<version>-<host>    work/out/libclang-<host>
///   libclang-<version>-<host>-asan  work/out/libclang-<host>-asan, if built
///
/// A Windows toolchain has no links at all: its aliases are small programs
/// (windows/alias.c, put there by scripts/toolchain.ts).

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

function archive(dir: string, name: string): void {
  const file = path.join(dist, `${name}.tar.xz`);
  common.run("bash", ["-c", `set -o pipefail; tar -C "$0" -cf - "$1" | xz -T0 -9 > "$2"`,
    path.dirname(dir), path.basename(dir), file]);
}

const toolchain = path.join(out, `toolchain-${host.triple}`);
if (!fs.existsSync(path.join(toolchain, "bin"))) common.fail(`missing ${toolchain}`);
const tree = common.makeTree(path.join(common.WORK, "package", host.triple, "xclang"), toolchain, runtimes);
fs.copyFileSync(path.join(common.ROOT, "LICENSE"), path.join(tree, "LICENSE"));
if (host.os === "mingw") {
  const links = fs.readdirSync(path.join(tree, "bin")).filter((f) => fs.lstatSync(path.join(tree, "bin", f)).isSymbolicLink());
  if (links.length) common.fail(`symlinks in a Windows toolchain: ${links.join(", ")}`);
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
