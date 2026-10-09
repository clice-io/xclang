/// The MSVC targets of a toolchain, x86_64- and aarch64-pc-windows-msvc, on a
/// machine of the toolchain's host, with the Windows SDK its own command
/// fetches:
///
///   node tests/sdk/msvc.ts --tree <xclang> --out <dir> [--kotatsu <source>]
///
/// Without an SDK, what needs none compiles, and on Windows clang finds
/// Visual Studio (elsewhere it looks in sdk/windows); the SDK of the
/// default preset fetched into the tree, and windows-2022's for x64 (then
/// the first in use again: sdk use, which the config files follow); for
/// both targets programs built with clang, clang++ and clang-cl into
/// <dir>/<target>/msvc-<host>, and in
/// programs.json what each prints and how it ends (tests/lib/on-target.ts
/// runs them on Windows): C, C++ with libc++ (exceptions, threads,
/// <filesystem>, <format>) and with Microsoft's STL (-stdlib=platform), __int128,
/// Win32, the hybrid CRT and /MT, /MD and /MTd (/MDd linked only), debug
/// information, ThinLTO, UBSan, the profile runtime, and for x64 ASan and
/// libFuzzer; the DLLs each program imports checked here. tests/cmake for
/// both targets through the CMake package, with libc++ and with the STL
/// (XCLANG_MSVC_STL); with --kotatsu, kotatsu's tests for x64. Programs
/// built for this machine run here too.
///
/// A toolchain before 23.1.2.10 has no libc++ for the MSVC targets
/// (checks.yml tests this checkout with the latest release): its C++
/// programs are the STL's either way.
///
/// Only programs leave the job, and xclang's ASan DLL next to them: nothing
/// of the SDK.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { programsDir, runPrograms, writePrograms, type Program } from "../lib/on-target.ts";

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    out: { type: "string" },
    kotatsu: { type: "string" },
  },
});
const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const failures: string[] = [];
const summary: string[] = [];

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

/// Run a command: its status, its output (stdout, then stderr) and stdout.
function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): { status: number | null; out: string; stdout: string } {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
  const stdout = String(r.stdout ?? "");
  const out = `${stdout}${r.stderr ?? ""}`;
  process.stdout.write(out.length > 20000 ? `${out.slice(0, 10000)}\n...\n${out.slice(-10000)}` : out);
  if (r.error) console.log(`  ${r.error.message}`);
  return { status: r.status, out, stdout };
}

function finish(): never {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  }
  if (failures.length) common.fail(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  console.log("all passed");
  process.exit(0);
}

if (!values.tree || !values.out) common.fail("--tree <xclang> --out <dir> [--kotatsu <source>]");
const tree = path.resolve(values.tree);
const out = path.resolve(values.out);
const tool = (name: string) => path.join(tree, "bin", name + exe);
const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "xclang-msvc-"));
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const sources = path.join(common.ROOT, "tests", "sdk");
/// libc++ of the MSVC targets, the C++ library of their config files where
/// the tree has it (toolchain/common.ts, writeConfigs).
const libcxx = fs.existsSync(path.join(common.resourceDir(tree), "lib", "windows", "libc++-x86_64.lib"));
const library = (stl: boolean) => `library: ${libcxx && !stl ? "libc++" : "msvc-stl"}`;
{
  const release = /^set\(PACKAGE_VERSION "(.+)"\)$/m
    .exec(fs.readFileSync(path.join(tree, "lib", "cmake", "xclang", "xclang-config-version.cmake"), "utf8"))?.[1] ?? "";
  const since = release.split(".").map(Number).reduce((v, n) => v * 1000 + n, 0) >= 23001002010;
  check(libcxx === since, `libc++ for the MSVC targets ${since ? "in" : "not in"} ${release}`);
}
const write = (name: string, text: string) => {
  fs.writeFileSync(path.join(work, name), text);
  return path.join(work, name);
};

/// 1. Without an SDK: what needs none compiles for both targets, with clang
/// and clang-cl (a plain one too), as clice queries the compiler
/// (-ffreestanding -undef -nostdinc); clang-cl with /WX, as no option of
/// the config files may be reported unused (patches/0011). On Windows
/// clang finds Visual Studio, without a Developer Command Prompt's
/// variables: programs build and run, libc++'s too, and so does
/// tests/cmake through the CMake package. Elsewhere a compile that includes
/// the CRT stops, and clang looks for it in the tree's sdk/windows.
const hello = path.join(sources, "hello.c");
const bare = write("bare.c", "int f(void) { return 0; }\n");
const freestanding = write("freestanding.c", "#include <stddef.h>\n#include <stdint.h>\nint32_t f(size_t n) { return (int32_t)n; }\n");
const noPrompt = { ...process.env };
for (const name of ["VCToolsInstallDir", "VCINSTALLDIR", "INCLUDE", "LIB"]) delete noPrompt[name];
for (const a of ["x86_64", "aarch64"]) {
  const target = `--target=${a}-pc-windows-msvc`;
  for (const [driver, args] of [
    ["clang", [target, "-ffreestanding", "-undef", "-nostdinc", "-fsyntax-only", bare]],
    ["clang++", [target, "-ffreestanding", "-fsyntax-only", "-x", "c++", freestanding]],
    ["clang-cl", [target, "/Zs", "/WX", "--", bare]],
    ["clang-cl", [target, "/Zs", "/WX", "/clang:-ffreestanding", "--", freestanding]],
    ["clang-cl", [target, "/Zs", "/WX", "/clang:-ffreestanding", "/TP", "--", freestanding]],
    ...(a === arch ? [["clang-cl", ["/Zs", "/WX", "--", bare]]] as const : []),
  ] as const) {
    const r = run(tool(driver), [...args], { cwd: work, env: noPrompt });
    check(r.status === 0, `without an SDK: ${driver} ${args.filter((x) => !path.isAbsolute(x)).join(" ")}`);
  }
}
if (windows) {
  const program = (driver: string) => path.join(work, `vs-${driver}.exe`);
  for (const [driver, args, expect] of [
    ["clang", ["-O2", hello, "-o", program("clang")], "hello, C"],
    ["clang-cl", ["/O2", `/Fe${program("clang-cl")}`, "--", hello], "hello, C"],
    /// libc++ on Visual Studio's vcruntime and UCRT.
    ["clang++", ["-O2", path.join(sources, "library.cpp"), "-o", program("clang++")], library(false)],
  ] as const) {
    const built = run(tool(driver), [`--target=${arch}-pc-windows-msvc`, ...args], { cwd: work, env: noPrompt });
    check(built.status === 0 && run(program(driver), []).out.includes(expect),
      `without an SDK: ${driver} finds Visual Studio, and the program runs (${expect})`);
  }
  const dir = path.join(work, "cmake-vs");
  const toolchain = path.join(tree, "lib", "cmake", "xclang", "toolchain.cmake");
  const built = run("cmake", ["-G", "Ninja", "-S", path.join(common.ROOT, "tests", "cmake"), "-B", dir,
    "-DCMAKE_BUILD_TYPE=Release", `--toolchain=${toolchain}`, `-DXCLANG_TARGET=${arch}-pc-windows-msvc`], { env: noPrompt }).status === 0 &&
    run("cmake", ["--build", dir], { env: noPrompt }).status === 0 &&
    run("ctest", ["--test-dir", dir, "--output-on-failure"]).status === 0;
  check(built, `without an SDK: tests/cmake for ${arch}-pc-windows-msvc with Visual Studio`);
} else {
  const r = run(tool("clang"), ["--target=x86_64-pc-windows-msvc", "-c", hello], { cwd: work });
  check(r.status !== 0 && /'stdio\.h' file not found/.test(r.out), "without an SDK: clang finds no stdio.h");
  const v = run(tool("clang"), ["--target=x86_64-pc-windows-msvc", "-###", "-c", hello], { cwd: work });
  check(/sdk[\\/]windows[\\/]VC[\\/]Tools/.test(v.out), "without an SDK: clang looks in sdk/windows");
}

/// 2. The SDK, from Microsoft: the default preset's, then windows-2022's
/// (MSVC 14.44) for x64, then the first in use again.
const xclang = (args: string[]) => run(tool("xclang"), args);
const fetch = (args: string[]): string => {
  const start = Date.now();
  const r = xclang(["sdk", "fetch", "windows", "--accept-license", ...args]);
  check(r.status === 0, `sdk fetch windows ${args.join(" ")}`);
  summary.push(`- \`sdk fetch windows ${args.join(" ")}\`: ${((Date.now() - start) / 1000).toFixed(0)} s`);
  return path.basename(r.stdout.trim());
};
const latest = fetch([]);
const older = fetch(["--preset", "windows-2022", "--arch", "x86_64"]);
const inUse = () => /^\s+(\S+)\s.*\(in use\)$/m.exec(xclang(["sdk", "list", "windows"]).out)?.[1];
check(inUse() === older, `sdk list: ${older} in use after its fetch`);
/// The config files read the SDK in use through bin/<triple>-sdk.cfg and
/// bin/<triple>-clang-cl-sdk.cfg, for the architectures it has, which the
/// xclang command writes since 23.1.2.9. checks.yml tests this checkout's
/// config files in the latest release, whose command may be older: they
/// then read no SDK, and on Windows clang takes Visual Studio.
const version = /^xclang (\d+)\.(\d+)\.(\d+)\.(\d+)$/m.exec(xclang(["--version"]).out)?.slice(1).map(Number);
const selects = !version || version.reduce((a, n) => a * 1000 + n, 0) >= [23, 1, 2, 9].reduce((a, n) => a * 1000 + n, 0);
const reads = (a: string) => ["", "-clang-cl"].every((cl) => fs.readFileSync(path.join(tree, "bin", `${a}-pc-windows-msvc${cl}-sdk.cfg`), "utf8")
  .split(/\r?\n/).includes(`@../sdk/windows/${a}-pc-windows-msvc${cl}.cfg`));
const follows = (ok: boolean, what: string) => selects ? check(ok, what) : console.log(`SKIP ${what}: the tree's xclang is older`);
follows(reads("x86_64") && !reads("aarch64"), `${older} in use: the x64 config files read it, the arm64 ones none`);

/// 3. Programs, built for both targets, and what they import.
const int128 = write("int128.c", `#include <stdio.h>
int main(int argc, char **argv) {
  (void)argv;
  unsigned __int128 a = ((unsigned __int128)0x0123456789abcdefULL << 64) | 0xfedcba9876543210ULL;
  unsigned __int128 b = 1000000006u + (unsigned)argc;
  unsigned __int128 q = a / b, r = a % b;
  __int128 s = -(__int128)a / (__int128)b;
  printf("int128 %llu %llu %lld\\n", (unsigned long long)q, (unsigned long long)r, (long long)s);
  return q * b + r == a && s == -(__int128)q ? 0 : 1;
}
`);
const asan = write("asan.cpp", `#include <sanitizer/asan_interface.h>
int main(int argc, char**) { int* p = new int[4]; int r = p[argc + 4]; delete[] p; return r; }
`);
/// std::set_new_handler, which vcruntime's <new.h> declares for libc++.
const newHandler = write("new-handler.cpp", `#include <cstdio>
#include <new>
static void handler() { std::puts("handler"); std::set_new_handler(nullptr); }
int main() {
  std::set_new_handler(handler);
  std::puts("new_handler set");
}
`);
/// Past a std::string's size, within its capacity: only an instrumented
/// libc++ annotates it (examples/sanitizers/overflow.cpp).
const overflow = path.join(common.ROOT, "examples", "sanitizers", "overflow.cpp");
/// Out of a std::vector's buffer, which libc++ allocates.
const asanVector = write("asan-vector.cpp", `#include <string>
#include <vector>
int main(int argc, char**) {
  std::vector<int> v(4, 1);
  std::string s(32, 'x');
  return v[argc + 4] + s[0];
}
`);
const ubsan = write("ubsan.c", `#include <limits.h>
#include <stdio.h>
int main(int argc, char **argv) { (void)argv; int x = INT_MAX; x += argc; printf("ubsan %d\\n", x); return 0; }
`);
const fuzzer = write("fuzzer.cpp", `#include <cstddef>
#include <cstdint>
#include <fuzzer/FuzzedDataProvider.h>
extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  FuzzedDataProvider input(data, size);
  if (input.ConsumeIntegral<char>() == 'x') { volatile int sum = input.ConsumeIntegral<int>(); (void)sum; }
  return 0;
}
`);
const profile = write("profile.c", `#include <stdio.h>
int main(int argc, char **argv) { (void)argv; int n = 0; for (int i = 0; i < 1000 * argc; ++i) n += i % 7; printf("profile %d\\n", n); return 0; }
`);

/// What a program may import: the hybrid CRT imports UCRT's API sets and
/// no VC runtime DLL, /MT neither, /MD both; nothing imports a debug CRT.
type Crt = "hybrid" | "static" | "dll";
function imports(file: string, crt: Crt): void {
  const dlls = [...run(tool("llvm-readobj"), ["--needed-libs", file]).out.matchAll(/^\s+(\S+\.dll)\r?$/gim)].map((m) => m[1]!.toLowerCase());
  const ucrt = dlls.some((d) => d.startsWith("api-ms-win-crt-"));
  const vc = dlls.some((d) => /^(vcruntime|msvcp)\d+\.dll$/.test(d));
  const debug = dlls.some((d) => /^(ucrtbased|vcruntime\d+d|msvcp\d+d)\.dll$/.test(d));
  const ok = !debug && !dlls.includes("ucrtbase.dll") &&
    { hybrid: ucrt && !vc, static: !ucrt && !vc, dll: ucrt && vc }[crt];
  check(ok, `${path.basename(file)} imports as ${crt}: ${dlls.join(" ")}`);
}

const native = windows && arch === "x86_64";
for (const a of ["x86_64", "aarch64"]) {
  const triple = `${a}-pc-windows-msvc`;
  const dir = programsDir(out, triple, "msvc");
  const programs: Program[] = [];
  const build = (name: string, driver: string, args: string[], expect: string, crt: Crt | null, extra: Partial<Program> = {}) => {
    const file = path.join(dir, `${name}.exe`);
    /// clang-cl: options before the inputs, which come after -- (a macOS
    /// path, /Users/..., would be /U).
    const cl = driver === "clang-cl";
    const r = run(tool(driver), cl
      ? [`--target=${triple}`, `/Fe${file}`, ...args]
      : [`--target=${triple}`, ...args, "-o", file], { cwd: work });
    check(r.status === 0 && fs.existsSync(file), `${triple}: ${name} (${driver} ${args.filter((x) => !path.isAbsolute(x)).join(" ")})`);
    if (!fs.existsSync(file)) return;
    if (crt) imports(file, crt);
    programs.push({ file: path.basename(file), expect, ...extra });
  };
  const cpp = path.join(sources, "hello.cpp");
  const cppOut = "threads: 10, file size: 5, pi: 3.142";
  const lib = path.join(sources, "library.cpp");
  build("c", "clang", ["-O2", hello], "hello, C", "hybrid");
  build("c-cl", "clang-cl", ["/O2", "--", hello], "hello, C", "hybrid");
  build("cpp", "clang++", ["-std=c++23", "-O2", cpp], cppOut, "hybrid");
  build("cpp-debug", "clang++", ["-std=c++23", "-g", "-O0", cpp], cppOut, "hybrid");
  build("cpp-lto", "clang++", ["-std=c++23", "-O2", "-flto=thin", cpp], cppOut, "hybrid");
  build("cpp-md", "clang++", ["-std=c++23", "-O2", "-fms-runtime-lib=dll", cpp], cppOut, "dll");
  /// Fully static: UCRT's static library instead of its DLLs' ucrt.lib.
  build("cpp-mt", "clang++", ["-std=c++23", "-O2", cpp, "-Wl,/nodefaultlib:ucrt.lib", "-llibucrt"], cppOut, "static");
  build("cpp-cl", "clang-cl", ["/EHsc", "/std:c++latest", "/O2", "--", cpp], cppOut, "hybrid");
  build("cpp-cl-md", "clang-cl", ["/EHsc", "/std:c++latest", "/O2", "/MD", "--", cpp], cppOut, "dll");
  /// The input as /Tp<file> rather than after --, which /link would follow.
  build("cpp-cl-mt", "clang-cl", ["/EHsc", "/std:c++latest", "/O2", `/Tp${cpp}`, "/link", "/nodefaultlib:ucrt.lib", "libucrt.lib"], cppOut, "static");
  /// The static debug CRT, without the DLLs' ucrt.lib the hybrid CRT adds:
  /// an option of the link, which comes before the objects' own.
  build("cpp-mtd", "clang++", ["-std=c++23", "-g", "-fms-runtime-lib=static_dbg", cpp, "-Wl,/nodefaultlib:ucrt.lib"], cppOut, "static");
  build("cpp-cl-mtd", "clang-cl", ["/EHsc", "/std:c++latest", "/MTd", "/Zi", `/Tp${cpp}`, "/link", "/nodefaultlib:ucrt.lib"], cppOut, "static");
  /// The C++ library each driver takes, and Microsoft's STL instead with
  /// -stdlib=platform.
  build("library", "clang++", ["-O2", lib], library(false), "hybrid");
  build("new-handler", "clang++", ["-O2", newHandler], "new_handler set", "hybrid");
  build("library-cl", "clang-cl", ["/EHsc", "/O2", "--", lib], library(false), "hybrid");
  build("library-stl", "clang++", ["-O2", "-stdlib=platform", lib], library(true), "hybrid");
  build("library-cl-stl", "clang-cl", ["/EHsc", "/O2", "/clang:-stdlib=platform", "--", lib], library(true), "hybrid");
  build("cpp-stl", "clang++", ["-std=c++23", "-O2", "-stdlib=platform", cpp], cppOut, "hybrid");
  build("cpp-cl-stl", "clang-cl", ["/EHsc", "/std:c++latest", "/O2", "/clang:-stdlib=platform", "--", cpp], cppOut, "hybrid");
  /// The DLL debug CRT: Visual Studio's debug DLLs, which no Windows has
  /// by itself; linked here, not run.
  const mdd = path.join(work, `cpp-mdd-${a}.exe`);
  const mddBuilt = run(tool("clang++"), [`--target=${triple}`, "-std=c++23", "-g", "-fms-runtime-lib=dll_dbg", cpp,
    "-Wl,/nodefaultlib:ucrt.lib", "-o", mdd], { cwd: work }).status === 0;
  const mddDlls = mddBuilt ? run(tool("llvm-readobj"), ["--needed-libs", mdd]).out.toLowerCase() : "";
  check(mddBuilt && mddDlls.includes("ucrtbased.dll") && /vcruntime\d+d\.dll/.test(mddDlls), `${triple}: cpp-mdd links with the DLL debug CRT`);
  build("int128", "clang", ["-O2", int128], "int128 ", "hybrid");
  build("int128-cl", "clang-cl", ["/O2", "--", int128], "int128 ", "hybrid");
  build("win32", "clang", ["-O2", path.join(sources, "win32.c"), "-luser32", "-ladvapi32"], "thread: 42", "hybrid");
  build("ubsan", "clang", ["-fsanitize=undefined", "-O1", ubsan], "signed integer overflow", null);
  build("profile", "clang", ["-fprofile-instr-generate", "-O1", profile], "profile ", "hybrid", { profile: true });
  if (a === "x86_64") {
    build("asan", "clang++", ["-fsanitize=address", "-g", "-O1", asan], "heap-buffer-overflow", null, { fails: true });
    build("asan-md", "clang++", ["-fsanitize=address", "-fms-runtime-lib=dll", "-g", "-O1", asan], "heap-buffer-overflow", null, { fails: true });
    /// libc++'s containers, and the ASan libc++, whose std::string
    /// annotates its capacity. (The STL's, under ASan, name its stl_asan.lib,
    /// which the SDK lacks.)
    if (libcxx) {
      build("asan-vector", "clang++", ["-fsanitize=address", "-g", "-O1", asanVector], "heap-buffer-overflow", null, { fails: true });
      build("asan-vector-cl", "clang-cl", ["-fsanitize=address", "/EHsc", "/Zi", "/O1", "--", asanVector], "heap-buffer-overflow", null, { fails: true });
      const include = path.join(tree, triple, "lib", "asan", "include");
      build("asan-libcxx", "clang++", ["-fsanitize=address", "-isystem", include, "-g", "-O1", overflow], "container-overflow", null, { fails: true });
      build("asan-libcxx-md", "clang++", ["-fsanitize=address", "-fms-runtime-lib=dll", "-isystem", include, "-g", "-O1", overflow],
        "container-overflow", null, { fails: true });
      build("asan-libcxx-cl", "clang-cl", ["-fsanitize=address", "/EHsc", "/Zi", "/O1", `/clang:-isystem${include}`, "--", overflow],
        "container-overflow", null, { fails: true });
    }
    build("fuzzer", "clang++", ["-std=c++17", "-fsanitize=fuzzer", "-O1", fuzzer], "Done 1000 runs", null, { args: ["-runs=1000"] });
    /// ASan's runtime is a DLL, which the program finds next to it.
    const dll = "clang_rt.asan_dynamic-x86_64.dll";
    fs.copyFileSync(path.join(common.resourceDir(tree), "lib", "windows", dll), path.join(dir, dll));
  }
  /// The older SDK, in use for a moment: x64 only, as fetched.
  if (a === "x86_64") {
    xclang(["sdk", "use", older]);
    build("cpp-2022", "clang++", ["-std=c++23", "-O2", cpp], cppOut, "hybrid");
    xclang(["sdk", "use", latest]);
    check(inUse() === latest, `sdk use ${latest}`);
    follows(reads("x86_64") && reads("aarch64"), `sdk use ${latest}: the config files read it`);
  }
  writePrograms(dir, programs);
  summary.push(`- ${triple}: ${programs.length} programs`);
}

/// 4. CMake: tests/cmake through the package's toolchain file, with libc++
/// and with Microsoft's STL, whose std.ixx the package copies into the
/// build (xclang_std/std.cppm).
const toolchain = path.join(tree, "lib", "cmake", "xclang", "toolchain.cmake");
for (const a of ["x86_64", "aarch64"]) {
  for (const stl of [false, true]) {
    const triple = `${a}-pc-windows-msvc`;
    const dir = path.join(work, `cmake-${a}${stl ? "-stl" : ""}`);
    const what = `tests/cmake for ${triple}${stl ? " with XCLANG_MSVC_STL" : ""}`;
    const configure = run("cmake", ["-G", "Ninja", "-S", path.join(common.ROOT, "tests", "cmake"), "-B", dir,
      "-DCMAKE_BUILD_TYPE=Release", `--toolchain=${toolchain}`, `-DXCLANG_TARGET=${triple}`, `-DXCLANG_MSVC_STL=${stl ? "ON" : "OFF"}`]);
    const built = configure.status === 0 && run("cmake", ["--build", dir]).status === 0;
    check(built, what);
    if (!built) continue;
    check(fs.existsSync(path.join(dir, "xclang_std", "std.cppm")) === (stl || !libcxx), `${what}: xclang::std from ${stl || !libcxx ? "the STL" : "libc++"}`);
    if (native && a === "x86_64") check(run("ctest", ["--test-dir", dir, "--output-on-failure"]).status === 0, `${what}: its tests`);
  }
}

/// 5. kotatsu, a real project: its tests for x64, run in its source tree.
if (values.kotatsu) {
  const source = path.resolve(values.kotatsu);
  const dir = path.join(work, "kotatsu");
  const ok = run("cmake", ["-G", "Ninja", "-S", source, "-B", dir, "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
    `--toolchain=${toolchain}`, "-DXCLANG_TARGET=x86_64-pc-windows-msvc", "-DKOTA_ENABLE_TEST=ON",
    /// Its tests include <winsock2.h> without it.
    "-DCMAKE_CXX_FLAGS=-DNOMINMAX"]).status === 0 &&
    run("cmake", ["--build", dir, "--target", "unit_tests", "system_tests"]).status === 0;
  check(ok, "kotatsu for x86_64-pc-windows-msvc");
  if (ok) {
    const x64 = programsDir(out, "x86_64-pc-windows-msvc", "msvc");
    const programs: Program[] = JSON.parse(fs.readFileSync(path.join(x64, "programs.json"), "utf8"));
    for (const name of ["unit_tests.exe", "system_tests.exe"]) {
      fs.copyFileSync(path.join(dir, name), path.join(x64, name));
      imports(path.join(x64, name), "hybrid");
      programs.push({ file: name, args: ["--snapshot-dir=tests/snapshots"], cwd: "$KOTATSU_SRC" });
    }
    writePrograms(x64, programs);
  }
}

/// Only the programs leave the job (and ASan's DLL): no PDBs, no import
/// libraries.
for (const a of ["x86_64", "aarch64"]) {
  const dir = programsDir(out, `${a}-pc-windows-msvc`, "msvc");
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(exe|dll)$|^programs\.json$/.test(f)) fs.rmSync(path.join(dir, f));
  }
}

/// 6. Here, what runs here.
if (native) check(runPrograms([path.join(out, "x86_64-pc-windows-msvc")]) === 0, "the x64 programs run here");

/// 7. sdk remove of the SDK in use: the config files read none again.
xclang(["sdk", "remove", latest]);
follows(!reads("x86_64") && !reads("aarch64") &&
  run(tool("clang"), ["--target=aarch64-pc-windows-msvc", "-ffreestanding", "-fsyntax-only", freestanding]).status === 0,
  `sdk remove ${latest}: the config files read no SDK, and load`);
finish();
