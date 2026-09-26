/// Check a release toolchain on the machine it is built for:
///
/// - its own programs do not load a C++ runtime, and on Linux need no
///   glibc newer than 2.17;
/// - a C and a C++ program (exceptions, iostreams, threads) build for every
///   target it carries (macOS ones only on macOS: the SDK) and run where
///   this machine can run them;
/// - natively also `import std;`, a precompiled header and ThinLTO.
///
///   node tests/smoke.ts --tree <xclang>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { tree: { type: "string" } } });
if (!values.tree) fail("--tree <xclang>");
const tree = path.resolve(values.tree);
const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const native = windows ? `${arch}-w64-mingw32`
  : process.platform === "darwin" ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-smoke-"));
const failures: string[] = [];

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function tool(name: string): string {
  return path.join(tree, "bin", name + exe);
}

function run(cmd: string, args: string[]): string | undefined {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const result = spawnSync(cmd, args, { encoding: "utf8", cwd: work });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    failures.push(`${path.basename(cmd)} ${args.join(" ")}`);
    return undefined;
  }
  return result.stdout;
}

function write(name: string, text: string): string {
  const file = path.join(work, name);
  fs.writeFileSync(file, text);
  return file;
}

const helloC = write("hello.c", `#include <stdio.h>
int main(void) { puts("hello c"); return 0; }
`);
const helloCxx = write("hello.cpp", `#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
int main() {
  std::vector<std::string> words{"hello", "c++"};
  std::string joined;
  std::thread worker([&] { for (const auto& w : words) joined += w + " "; });
  worker.join();
  try { throw std::runtime_error(joined); }
  catch (const std::exception& e) { std::cout << e.what() << std::endl; }
}
`);

/// 1. The toolchain's own programs.
run(tool("clang"), ["--version"]);
/// llvm is clang, lld and most tools; elsewhere they are its names (on
/// Windows, programs that start it). FileCheck stands alone.
const programs = [tool("llvm"), tool("clang"), tool("ld.lld"), tool("llvm-ar"), tool("FileCheck")];
if (process.platform === "darwin") programs.push(path.join(tree, "lib", "libLTO.dylib"));
for (const file of programs) {
  const program = path.basename(file);
  if (!fs.existsSync(file)) {
    failures.push(`missing ${file}`);
    continue;
  }
  if (process.platform === "darwin") {
    const libs = run(tool("llvm-otool"), ["-L", file]) ?? "";
    if (/libc\+\+/.test(libs)) failures.push(`${program} loads libc++: ${libs}`);
  } else {
    const libs = run(tool("llvm-readobj"), ["--needed-libs", file]) ?? "";
    if (/libc\+\+|libstdc\+\+|libgcc|libunwind|winpthread/i.test(libs)) failures.push(`${program} loads a C++ runtime`);
    if (process.platform === "linux") {
      const versions = run(tool("llvm-readelf"), ["--version-info", file]) ?? "";
      const glibc = [...versions.matchAll(/GLIBC_2\.(\d+)/g)].map((m) => Number(m[1]));
      const newest = Math.max(0, ...glibc);
      console.log(`${program} needs glibc 2.${newest}`);
      if (newest > 17) failures.push(`${program} needs glibc 2.${newest}`);
    }
  }
}

run(tool("FileCheck"), [write("check.txt", "CHECK: hello\nCHECK-NEXT: world\n"),
  `--input-file=${write("input.txt", "hello\nworld\n")}`]);

/// 2. Every target this machine can build for.
const targets = [
  "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-w64-mingw32", "aarch64-w64-mingw32",
  ...(process.platform === "darwin" ? ["aarch64-apple-darwin", "x86_64-apple-darwin"] : []),
];
/// What runs here: the native target, x86_64 macOS on arm64 macOS
/// (Rosetta) and x86_64 Windows on arm64 Windows (emulation).
const runnable = (t: string) => t === native ||
  (native === "aarch64-apple-darwin" && t === "x86_64-apple-darwin") ||
  (native === "aarch64-w64-mingw32" && t === "x86_64-w64-mingw32");
for (const t of targets) {
  const suffix = t.endsWith("mingw32") ? ".exe" : "";
  for (const [source, driver, expected] of [[helloC, "clang", "hello c"], [helloCxx, "clang++", "hello c++"]]) {
    const out = path.join(work, `${path.basename(source)}-${t}${suffix}`);
    if (run(tool(driver), [`--target=${t}`, "-O2", source, "-o", out]) === undefined) continue;
    run(tool("llvm-readobj"), ["--file-headers", out]);
    if (runnable(t)) {
      const output = run(out, []);
      if (output !== undefined && !output.includes(expected)) failures.push(`${out} printed ${JSON.stringify(output)}`);
    }
  }
}

/// Atomics too wide to be lock-free, from compiler-rt; -latomic as GCC's
/// toolchains want it.
const atomics = write("atomics.cpp", `#include <atomic>
#include <cstdio>
struct Big { long a, b, c; };
std::atomic<Big> big{Big{1, 2, 3}};
std::atomic<__int128> wide{41};
int main() {
  Big b = big.load();
  big.store({b.a, b.b, b.c + 1});
  wide.fetch_add(1);
  std::printf("atomics %ld %d\\n", big.load().c, static_cast<int>(wide.load()));
}
`);
for (const t of targets) {
  const out = path.join(work, `atomics-${t}${t.endsWith("mingw32") ? ".exe" : ""}`);
  const latomic = t.includes("apple") ? [] : ["-latomic"];
  if (run(tool("clang++"), [`--target=${t}`, "-O2", atomics, "-o", out, ...latomic]) === undefined || !runnable(t)) continue;
  const output = run(out, []);
  if (output !== undefined && !output.includes("atomics 4 42")) failures.push(`${out} printed ${JSON.stringify(output)}`);
}

/// Hardening flags, GCC's runtime libraries named explicitly, and fully
/// static Linux programs.
for (const t of targets) {
  const out = path.join(work, `hardened-${t}${t.endsWith("mingw32") ? ".exe" : ""}`);
  const gcc = t.includes("apple") ? [] : ["-lgcc", "-lgcc_eh", "-lgcc_s"];
  if (run(tool("clang"), [`--target=${t}`, "-O2", "-D_FORTIFY_SOURCE=2", "-fstack-protector-strong", helloC, "-o", out, ...gcc]) !== undefined && runnable(t)) {
    run(out, []);
  }
  if (!t.includes("linux")) continue;
  const staticOut = path.join(work, `static-${t}`);
  if (run(tool("clang++"), [`--target=${t}`, "-static", "-O2", helloCxx, "-o", staticOut]) !== undefined && runnable(t)) {
    const output = run(staticOut, []);
    if (output !== undefined && !output.includes("hello c++")) failures.push(`${staticOut} printed ${JSON.stringify(output)}`);
  }
}

/// A version resource through windres, as CMake compiles a MinGW
/// project's .rc files.
const rc = write("version.rc", `#include <winver.h>
1 VERSIONINFO FILEVERSION 1,2,3,4
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "ProductName", "xclang smoke"
    END
  END
END
`);
for (const t of targets.filter((t) => t.endsWith("mingw32"))) {
  const res = path.join(work, `version-${t}.o`);
  if (run(tool("windres"), [`--target=${t}`, rc, "-O", "coff", "-o", res]) === undefined) continue;
  run(tool("clang"), [`--target=${t}`, helloC, res, "-o", path.join(work, `resource-${t}.exe`)]);
}

/// Compressed debug sections (zlib and zstd in clang and lld), on an ELF
/// target, which every host carries.
for (const gz of ["zlib", "zstd"]) {
  run(tool("clang"), ["--target=x86_64-unknown-linux-gnu", "-g", `-gz=${gz}`, helloC, "-o", path.join(work, `gz-${gz}`)]);
}

/// 3. Native: import std, a precompiled header, ThinLTO.
const manifest = run(tool("clang++"), [`--target=${native}`, "-print-library-module-manifest-path"])?.trim();
if (manifest && fs.existsSync(manifest)) {
  const std = JSON.parse(fs.readFileSync(manifest, "utf8")).modules.find((m: { "logical-name": string }) => m["logical-name"] === "std");
  const stdSource = path.resolve(path.dirname(manifest), std["source-path"]);
  const useStd = write("use_std.cpp", `import std;
int main() { std::println("{} {}", "import", std::vector{1, 2, 3}); }
`);
  const pcm = path.join(work, "std.pcm");
  const flags = [`--target=${native}`, "-std=c++23", "-O2"];
  if (run(tool("clang++"), [...flags, "-Wno-reserved-module-identifier", "--precompile", stdSource, "-o", pcm]) !== undefined) {
    const program = path.join(work, `use_std${exe}`);
    run(tool("clang++"), [...flags, `-fmodule-file=std=${pcm}`, useStd, pcm, "-o", program]);
    if (fs.existsSync(program)) run(program, []);
  }
} else {
  failures.push(`no module manifest for ${native}: ${manifest}`);
}

const header = write("common.hpp", "#include <map>\n#include <string>\n#include <vector>\n");
const pchUser = write("pch_user.cpp", "int main() { std::map<std::string, std::vector<int>> m; return int(m.size()); }\n");
run(tool("clang++"), [`--target=${native}`, "-x", "c++-header", header, "-o", path.join(work, "common.hpp.pch")]);
run(tool("clang++"), [`--target=${native}`, "-include-pch", path.join(work, "common.hpp.pch"), pchUser, "-o", path.join(work, `pch${exe}`)]);

const lto = path.join(work, `lto${exe}`);
if (run(tool("clang++"), [`--target=${native}`, "-O2", "-flto=thin", helloCxx, "-o", lto]) !== undefined) {
  const output = run(lto, []);
  if (output !== undefined && !output.includes("hello c++")) failures.push(`${lto} printed ${JSON.stringify(output)}`);
}

if (failures.length) fail(`${failures.length} checks failed:\n  ${failures.join("\n  ")}`);
console.log("all checks passed");
