/// The CMake package (packages/cmake) as a consumer uses it, with a host's
/// archives unpacked: tests/cmake built and its tests run, with the cmake
/// and ninja in PATH.
///
///   node tests/cmake/cmake.ts --tree <xclang> --sums <SHA256SUMS>
///     [--libclang <libclang>] [--url <archives> [--git <ref>] [--cache <dir>]] [--programs <dir>]
///
/// 1. xclang's bin/ in PATH, as pixi has it, and CMAKE_CXX_COMPILER=clang++:
///    find_package(xclang) by PATH. With --libclang, tests/libclang too,
///    on find_package(Clang).
/// 2. Every other target this host builds for, through the toolchain file
///    and XCLANG_TARGET; run where this machine runs them (x86_64 macOS on
///    arm64, through Rosetta; musl's static programs on Linux of their
///    architecture). The musl targets only with archives that carry them.
/// 3. With --url, nothing installed: FetchContent of xclang's tag (this
///    checkout in its place, through FETCHCONTENT_SOURCE_DIR_XCLANG; with
///    --git, that tag, branch or commit on GitHub), whose xclang.cmake
///    downloads SHA256SUMS and the host's toolchain from --url (a directory
///    or a URL) into --cache (the user's cache by default).
/// 4. With --libclang, the linker's ThinLTO cache (XCLANG_THINLTO_CACHE) on
///    the link of tests/libclang: a second link takes every module's code
///    from it, and the program is the same.
/// 5. The C++ runtimes built from source (XCLANG_RUNTIMES=source,
///    packages/cmake/runtimes.cmake), where the tree has their sources:
///    tests/cmake/runtimes for this host's target once per variant, through
///    the toolchain file. With no options they are the prebuilt runtimes
///    again: the same __config_site, and for Linux and MinGW the same
///    objects, the compiler's name in .comment aside. Linux x64 adds
///    MemorySanitizer and libc++ with ThinLTO. With --programs <dir>, the
///    hardening variant for other targets too (from Linux x64: Linux arm64
///    and both MinGW targets; from arm64 macOS: x86_64 macOS), whose
///    programs tests/lib/on-target.ts runs on machines of those targets.
///
/// A tree whose lib/cmake/xclang is not the checkout's (releases before the
/// package, or before a change of it) gets the checkout's.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { programsDir, writePrograms, type Program } from "../lib/on-target.ts";

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    sums: { type: "string" },
    libclang: { type: "string" },
    url: { type: "string" },
    git: { type: "string" },
    cache: { type: "string" },
    programs: { type: "string" },
  },
});
if (!values.tree || !values.sums) {
  common.fail("--tree <xclang> --sums <SHA256SUMS> [--libclang <libclang>] [--url <archives> [--git <ref>] [--cache <dir>]]");
}
const tree = path.resolve(values.tree);
const sums = path.resolve(values.sums);
const windows = process.platform === "win32";
const native = common.TARGETS.find((t) => t.arch === (os.arch() === "arm64" ? "aarch64" : "x86_64") &&
  t.os === (windows ? "mingw" : process.platform === "darwin" ? "darwin" : "linux"))!;
/// The long form of Windows' temporary directory (not RUNNER~1).
const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "xclang-cmake-"));
const source = path.join(common.ROOT, "tests", "cmake");
const failures: string[] = [];

const digests = new Map<string, string>();
for (const line of fs.readFileSync(sums, "utf8").split("\n")) {
  const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim());
  if (match) digests.set(match[2]!, match[1]!);
}
const version = [...digests.keys()].map((f) => new RegExp(`^xclang-(.+)-${native.triple}\\.tar\\.xz$`).exec(f)?.[1]).find(Boolean);
if (!version) common.fail(`no xclang archive of ${native.triple} in ${sums}`);

common.run("cmake", ["--version"]);
common.run("ninja", ["--version"]);

const installed = path.join(tree, "lib", "cmake", "xclang");
const fresh = path.join(work, "package");
common.writeCMakePackage(fresh, version);
const same = fs.readdirSync(fresh).every((f) => fs.existsSync(path.join(installed, f)) &&
  fs.readFileSync(path.join(installed, f)).equals(fs.readFileSync(path.join(fresh, f))));
if (!same) {
  console.log(`${installed} is not the checkout's package: replaced`);
  common.writeCMakePackage(installed, version);
}

/// Configure, build and, when it runs here, test one build of tests/cmake
/// (or of another project). Whether it built.
function build(name: string, args: string[], env: NodeJS.ProcessEnv = process.env, run = true, project = source): boolean {
  const dir = path.join(work, name);
  console.log(`\n=== ${name}`);
  for (const step of [
    ["-G", "Ninja", "-S", project, "-B", dir, "-DCMAKE_BUILD_TYPE=Release", ...args],
    ["--build", dir],
  ]) {
    console.log(`+ cmake ${step.join(" ")}`);
    if (spawnSync("cmake", step, { stdio: "inherit", env }).status !== 0) {
      failures.push(`${name}: cmake ${step[0]}`);
      return false;
    }
  }
  if (run && spawnSync("ctest", ["--test-dir", dir, "--output-on-failure"], { stdio: "inherit", env }).status !== 0) {
    failures.push(`${name}: ctest`);
  }
  return true;
}

/// 1. Natively, by PATH.
const pathEnv = { ...process.env, PATH: `${path.join(tree, "bin")}${path.delimiter}${process.env.PATH}` };
build("path", [
  "-DCMAKE_C_COMPILER=clang",
  "-DCMAKE_CXX_COMPILER=clang++",
  ...(values.libclang ? ["-DXCLANG_TEST_LIBCLANG=ON", `-DCMAKE_PREFIX_PATH=${path.resolve(values.libclang)}`] : []),
], pathEnv);

/// 2. The other targets: macOS ones only on macOS (the SDK); arm64 macOS
/// runs x86_64 programs through Rosetta, Linux the static programs of musl
/// of its architecture.
const toolchain = path.join(installed, "toolchain.cmake");
for (const t of common.TARGETS.filter((t) => t !== native && (t.os !== "darwin" || native.os === "darwin") &&
  (t.os !== "musl" || fs.existsSync(path.join(tree, t.triple))))) {
  build(t.triple, [`--toolchain=${toolchain}`, `-DXCLANG_TARGET=${t.triple}`], process.env,
    (t.os === "darwin" && native.arch === "aarch64") || (t.os === "musl" && native.os === "linux" && t.arch === native.arch));
}

/// 3. Nothing installed: the toolchain downloaded by xclang.cmake.
if (values.url) {
  const url = fs.existsSync(values.url) ? pathToFileURL(path.resolve(values.url)).href : values.url;
  build("fetch", [
    `-DXCLANG_TEST_FETCH=${version}`,
    values.git ? `-DXCLANG_TEST_GIT_TAG=${values.git}` : `-DFETCHCONTENT_SOURCE_DIR_XCLANG=${common.ROOT}`,
    `-DXCLANG_URL=${url}`,
    ...(values.cache ? [`-DXCLANG_CACHE_DIR=${path.resolve(values.cache)}`] : []),
  ]);
}

/// 4. With --libclang, the linker's ThinLTO cache on the path build's link of
/// libclang's bitcode: XCLANG_THINLTO_CACHE's directory made at configure
/// time, filled by the first link, every entry of it used as it is by the
/// next one, and the program the same as without the cache (on Windows,
/// linked without a timestamp).
if (values.libclang && !failures.some((f) => f.startsWith("path:"))) {
  const dir = path.join(work, "path");
  const cache = path.join(work, "thinlto", "cache");
  const program = path.join(dir, "libclang", `consumer${windows ? ".exe" : ""}`);
  const configure = (args: string[]): boolean =>
    spawnSync("cmake", ["-S", source, "-B", dir, ...args], { stdio: "inherit", env: pathEnv }).status === 0;
  const link = (): { seconds: number; bytes: Buffer } | undefined => {
    fs.rmSync(program, { force: true });
    const start = Date.now();
    if (spawnSync("cmake", ["--build", dir, "--target", "consumer"], { stdio: "inherit", env: pathEnv }).status !== 0) return;
    return { seconds: (Date.now() - start) / 1000, bytes: fs.readFileSync(program) };
  };
  /// The cache's entries and their times: an entry written again is a miss.
  const entries = (): Map<string, number> => new Map(fs.readdirSync(cache).filter((f) => f.startsWith("llvmcache-"))
    .map((f) => [f, fs.statSync(path.join(cache, f)).mtimeMs]));
  const thinlto = (): string | undefined => {
    if (windows && !configure(["-DCMAKE_EXE_LINKER_FLAGS=-Wl,--no-insert-timestamp"])) return "configure";
    const none = link();
    if (!none) return "link without the cache";
    if (!configure([`-DXCLANG_THINLTO_CACHE=${cache}`])) return "configure with XCLANG_THINLTO_CACHE";
    if (!fs.existsSync(cache)) return `configure made no ${cache}`;
    const cold = link();
    const filled = entries();
    const warm = link();
    if (!cold || !warm) return "link with the cache";
    const after = entries();
    const missed = [...after].filter(([f, t]) => filled.get(f) !== t).length;
    const same = cold.bytes.equals(none.bytes) && warm.bytes.equals(none.bytes);
    console.log(`ThinLTO cache: link ${none.seconds.toFixed(1)} s without it, ${cold.seconds.toFixed(1)} s cold ` +
      `(${filled.size} entries), ${warm.seconds.toFixed(1)} s warm (${missed} entries written again); ` +
      `the program ${same ? "the same" : "differs"} with and without it`);
    if (filled.size === 0) return "the first link left nothing in the cache";
    if (missed > 0) return `the second link wrote ${missed} entries again`;
    if (!same) return "the program differs with the cache";
  };
  const failed = thinlto();
  if (failed) failures.push(`thinlto: ${failed}`);
}

/// 5. The runtimes from source.
const sources = path.join(tree, "libc++", "src", "runtimes", "CMakeLists.txt");
if (fs.existsSync(sources)) {
  const project = path.join(source, "runtimes");
  const linuxX64 = native.triple === "x86_64-unknown-linux-gnu";
  const variants: [string, string[]][] = [
    ["default", []],
    ["hardening", ["-DXCLANG_LIBCXX_HARDENING=fast"]],
    ["abi", ["-DXCLANG_LIBCXX_ABI_NAMESPACE=__xclang",
      "-DXCLANG_LIBCXX_ABI_DEFINES=_LIBCPP_ABI_BOUNDED_ITERATORS;_LIBCPP_ABI_BOUNDED_ITERATORS_IN_STRING",
      "-DXCLANG_RUNTIMES_EXCEPTIONS=OFF", "-DXCLANG_RUNTIMES_RTTI=OFF", "-DCMAKE_CXX_FLAGS=-fno-exceptions -fno-rtti"]],
    ...(linuxX64 ? [
      ["msan", ["-DXCLANG_SANITIZER=memory", "-DCMAKE_BUILD_TYPE=RelWithDebInfo"]],
      ["lto", ["-DXCLANG_RUNTIMES_FLAGS=-flto=thin", "-DCMAKE_CXX_FLAGS=-flto=thin"]],
    ] as [string, string[]][] : []),
  ];
  for (const [variant, args] of variants) {
    const name = `runtimes-${variant}`;
    if (!build(name, [`--toolchain=${toolchain}`, "-DXCLANG_RUNTIMES=source", ...args], process.env, true, project)) continue;
    const installs = fs.readdirSync(path.join(work, name, "xclang-runtimes"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => path.join(work, name, "xclang-runtimes", e.name, "install"));
    if (installs.length !== 1) {
      failures.push(`${name}: ${installs.length} variants in ${path.join(work, name, "xclang-runtimes")}`);
      continue;
    }
    if (variant === "default") failures.push(...samePrebuilt(native, installs[0]!).map((f) => `${name}: ${f}`));
    /// libc++ of ThinLTO: bitcode, which the program's link compiled.
    if (variant === "lto" && !isBitcode(path.join(installs[0]!, "lib", "libc++.a"))) failures.push(`${name}: libc++.a holds no bitcode`);
  }

  /// The hardening variant for other targets, run on their machines.
  const others = { "x86_64-unknown-linux-gnu": ["aarch64-unknown-linux-gnu", "x86_64-w64-mingw32", "aarch64-w64-mingw32"],
    "aarch64-apple-darwin": ["x86_64-apple-darwin"] }[native.triple] ?? [];
  if (values.programs) {
    for (const triple of others) {
      const name = `runtimes-hardening-${triple}`;
      if (!build(name, [`--toolchain=${toolchain}`, `-DXCLANG_TARGET=${triple}`, "-DXCLANG_RUNTIMES=source",
        "-DXCLANG_LIBCXX_HARDENING=fast"], process.env, false, project)) continue;
      const out = programsDir(path.resolve(values.programs), triple, "cmake-runtimes");
      const exe = triple.includes("mingw") ? ".exe" : "";
      for (const program of ["variant", "variant_std"]) fs.copyFileSync(path.join(work, name, program + exe), path.join(out, program + exe));
      const programs: Program[] = [
        { file: `variant${exe}`, output: "namespace __1 hardening 4 exceptions 1\nstream: 42 3.5" },
        { file: `variant${exe}`, name: "variant oob, a trap", args: ["oob"], trap: true },
        { file: `variant_std${exe}`, expect: "3 elements" },
      ];
      writePrograms(out, programs);
    }
  }
} else {
  console.log(`\n${tree} has no runtimes' sources: no runtimes from source`);
}

if (failures.length) common.fail(`${failures.length} builds failed:\n  ${failures.join("\n  ")}`);
console.log(`\nall builds passed, xclang ${version} on ${native.triple}`);

/// What differs between the runtimes built from source with no options
/// (install, a variant's directory) and the prebuilt ones of target t: their
/// __config_site and module sources; for ELF and COFF targets, the objects
/// of their archives, once without .comment, which names the compiler that
/// built them (the prebuilt ones, the bootstrap's), or else their code: an
/// assertion's __FILE__ (libunwind's) is the path of its source.
function samePrebuilt(t: common.Target, install: string): string[] {
  const differ: string[] = [];
  /// Text files the same but for line ends: CMake writes the configured
  /// ones (__config_site, std.cppm) with CRLF on Windows.
  const sameText = (ours: string, theirs: string): void => {
    if (!fs.existsSync(ours)) return void differ.push(`no ${ours}`);
    const [a, b] = [ours, theirs].map((f) => fs.readFileSync(f, "utf8").replaceAll("\r\n", "\n").split("\n"));
    const line = a!.findIndex((l, i) => l !== b![i]);
    if (line >= 0 || a!.length !== b!.length) {
      const at = line >= 0 ? line : Math.min(a!.length, b!.length);
      differ.push(`${ours} is not ${theirs}: line ${at + 1}, ${JSON.stringify(a![at])} and ${JSON.stringify(b![at])}`);
    }
  };
  sameText(path.join(install, "include", "c++", "v1", "__config_site"), path.join(common.libcxxTargetDir(tree, t), "__config_site"));
  const lib = path.join(tree, t.triple, common.linuxSysroot(t) ? "usr/lib" : "lib");
  const modules = path.join(path.dirname(lib), "share", "libc++", "v1");
  for (const file of fs.readdirSync(modules, { recursive: true }) as string[]) {
    if (fs.statSync(path.join(modules, file)).isFile()) sameText(path.join(install, "share", "libc++", "v1", file), path.join(modules, file));
  }
  if (t.os === "darwin") return differ;
  const exe = windows ? ".exe" : "";
  const code = (file: string) => common.capture(path.join(tree, "bin", `llvm-objdump${exe}`), ["-d", "--no-show-raw-insn", file])
    .split("\n").slice(2).join("\n");
  for (const archive of ["libc++.a", "libc++abi.a", "libunwind.a", "libc++experimental.a"]) {
    const members = (which: string, file: string): Map<string, Buffer> => {
      const dir = path.join(work, "compare", archive, which);
      fs.mkdirSync(dir, { recursive: true });
      common.run(path.join(tree, "bin", `llvm-ar${exe}`), ["x", `--output=${dir}`, file]);
      return new Map(fs.readdirSync(dir).map((m) => {
        common.run(path.join(tree, "bin", `llvm-objcopy${exe}`), ["--remove-section=.comment", path.join(dir, m)]);
        return [m, fs.readFileSync(path.join(dir, m))];
      }));
    };
    const ours = members("source", path.join(install, "lib", archive));
    const theirs = members("prebuilt", path.join(lib, archive));
    const names = [...new Set([...ours.keys(), ...theirs.keys()])].sort();
    const dir = (which: string) => path.join(work, "compare", archive, which);
    const unlike = names.filter((m) => !ours.get(m)?.equals(theirs.get(m) ?? Buffer.alloc(0)) &&
      !(ours.has(m) && theirs.has(m) && code(path.join(dir("source"), m)) === code(path.join(dir("prebuilt"), m))));
    if (unlike.length) differ.push(`${archive}: ${unlike.length} of ${names.length} members differ from ${lib}: ${unlike.join(", ")}`);
  }
  return differ;
}

/// Whether an archive's first member is LLVM bitcode.
function isBitcode(archive: string): boolean {
  const exe = windows ? ".exe" : "";
  const dir = path.join(work, "bitcode");
  fs.mkdirSync(dir, { recursive: true });
  common.run(path.join(tree, "bin", `llvm-ar${exe}`), ["x", `--output=${dir}`, archive]);
  return fs.readdirSync(dir).some((m) => fs.readFileSync(path.join(dir, m)).subarray(0, 4).equals(Buffer.from("BC\xc0\xde", "latin1")));
}
