/// Unpack the bootstrap compiler of this machine into work/bootstrap.
///
/// Until there is an xclang release to bootstrap from, that is LLVM's own
/// release build. Only the programs the builds run are kept, with the
/// resource directory and the shared libraries they may load; libc++
/// headers and everything else stay out, so the tree behaves like an xclang
/// tree once targets are added to it.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

const PROGRAMS = [
  "clang", "clang++", "clang-cpp", "clang-scan-deps",
  "lld", "ld.lld", "ld64.lld", "lld-link", "wasm-ld",
  "llvm-ar", "llvm-ranlib", "llvm-lib", "llvm-dlltool",
  "llvm-nm", "llvm-objcopy", "llvm-strip", "llvm-objdump", "llvm-otool",
  "llvm-readobj", "llvm-readelf", "llvm-rc", "llvm-windres",
  "llvm-profdata", "llvm-symbolizer", "llvm-addr2line", "llvm-cxxfilt",
  "llvm-size", "llvm-strings", "llvm-dwarfdump",
  "llvm-libtool-darwin", "llvm-lipo", "llvm-install-name-tool",
];

const { values } = parseArgs({
  options: { dest: { type: "string", default: path.join(common.WORK, "bootstrap") } },
});
const dest = path.resolve(values.dest!);

const archive = await common.fetchSource(`bootstrap-${common.machine()}`);
fs.rmSync(dest, { recursive: true, force: true });

const wanted = new Set(PROGRAMS.map((p) => `bin/${p}`));
const resource = `lib/clang/${common.LLVM_MAJOR}/`;
common.extract(archive, dest, (member) => {
  if (wanted.has(member) || member.startsWith(resource)) return true;
  const name = member.slice(member.lastIndexOf("/") + 1);
  /// clang and lld are links to versioned programs (clang-23), and the
  /// release may link its programs against libLLVM / libclang-cpp.
  if (member.startsWith("bin/")) return name.startsWith("clang-2");
  return member.split("/").length === 2 && member.startsWith("lib/") &&
    (name.includes(".so") || name.endsWith(".dylib"));
});

const bin = path.join(dest, "bin");
for (const name of fs.readdirSync(bin)) {
  const file = path.join(bin, name);
  if (fs.lstatSync(file).isSymbolicLink() && !fs.existsSync(file)) {
    console.log(`dropping dangling link ${name} -> ${fs.readlinkSync(file)}`);
    fs.rmSync(file);
  }
}
const missing = PROGRAMS.filter((p) => !fs.existsSync(path.join(bin, p)));
if (missing.length) console.log(`not in the release build: ${missing.join(", ")}`);
for (const essential of ["clang", "clang++", "ld.lld", "llvm-ar", "llvm-profdata"]) {
  if (!fs.existsSync(path.join(bin, essential))) common.fail(`the bootstrap lacks ${essential}`);
}
common.run(path.join(bin, "clang"), ["--version"]);
console.log(`resource dir: ${common.resourceDir(dest)}`);
