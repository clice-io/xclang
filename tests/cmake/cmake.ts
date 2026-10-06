/// The CMake package (packages/cmake) as a consumer uses it, with a host's
/// archives unpacked: tests/cmake built and its tests run, with the cmake
/// and ninja in PATH.
///
///   node tests/cmake/cmake.ts --tree <xclang> --sums <SHA256SUMS>
///     [--libclang <libclang>] [--url <archives> [--git <ref>] [--cache <dir>]]
///
/// 1. xclang's bin/ in PATH, as pixi has it, and CMAKE_CXX_COMPILER=clang++:
///    find_package(xclang) by PATH. With --libclang, tests/libclang too,
///    on find_package(Clang).
/// 2. Every other target this host builds for, through the toolchain file
///    and XCLANG_TARGET; run where this machine runs them (x86_64 macOS on
///    arm64, through Rosetta).
/// 3. With --url, nothing installed: FetchContent of xclang's tag (this
///    checkout in its place, through FETCHCONTENT_SOURCE_DIR_XCLANG; with
///    --git, that tag, branch or commit on GitHub), whose xclang.cmake
///    downloads SHA256SUMS and the host's toolchain from --url (a directory
///    or a URL) into --cache (the user's cache by default).
/// 4. With --libclang, the linker's ThinLTO cache (XCLANG_THINLTO_CACHE) on
///    the link of tests/libclang: a second link takes every module's code
///    from it, and the program is the same.
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

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    sums: { type: "string" },
    libclang: { type: "string" },
    url: { type: "string" },
    git: { type: "string" },
    cache: { type: "string" },
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

/// Configure, build and, when it runs here, test one build of tests/cmake.
function build(name: string, args: string[], env: NodeJS.ProcessEnv = process.env, run = true): void {
  const dir = path.join(work, name);
  console.log(`\n=== ${name}`);
  for (const step of [
    ["-G", "Ninja", "-S", source, "-B", dir, "-DCMAKE_BUILD_TYPE=Release", ...args],
    ["--build", dir],
  ]) {
    console.log(`+ cmake ${step.join(" ")}`);
    if (spawnSync("cmake", step, { stdio: "inherit", env }).status !== 0) {
      failures.push(`${name}: cmake ${step[0]}`);
      return;
    }
  }
  if (run && spawnSync("ctest", ["--test-dir", dir, "--output-on-failure"], { stdio: "inherit", env }).status !== 0) {
    failures.push(`${name}: ctest`);
  }
}

/// 1. Natively, by PATH.
const pathEnv = { ...process.env, PATH: `${path.join(tree, "bin")}${path.delimiter}${process.env.PATH}` };
build("path", [
  "-DCMAKE_C_COMPILER=clang",
  "-DCMAKE_CXX_COMPILER=clang++",
  ...(values.libclang ? ["-DXCLANG_TEST_LIBCLANG=ON", `-DCMAKE_PREFIX_PATH=${path.resolve(values.libclang)}`] : []),
], pathEnv);

/// 2. The other targets: macOS ones only on macOS (the SDK); arm64 macOS
/// runs x86_64 programs through Rosetta.
const toolchain = path.join(installed, "toolchain.cmake");
for (const t of common.TARGETS.filter((t) => t !== native && (t.os !== "darwin" || native.os === "darwin"))) {
  build(t.triple, [`--toolchain=${toolchain}`, `-DXCLANG_TARGET=${t.triple}`], process.env,
    t.os === "darwin" && native.arch === "aarch64");
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

if (failures.length) common.fail(`${failures.length} builds failed:\n  ${failures.join("\n  ")}`);
console.log(`\nall builds passed, xclang ${version} on ${native.triple}`);
