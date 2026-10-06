/// The macOS targets of a toolchain, aarch64- and x86_64-apple-darwin, on a
/// Linux or Windows machine of the toolchain's host, with Apple's SDK its
/// own command fetches:
///
///   node tests/sdk/macos.ts --tree <xclang> --out <dir>
///       without the SDK, clang names sdk/macos and the CMake package stops;
///       the SDK of the default preset fetched into the tree; for both
///       targets programs built with a bare --target into <dir>/<arch>, and
///       in programs.json what each prints and how it ends: C, C++ with
///       libc++ (exceptions, threads, <filesystem>, <format>), import std,
///       ThinLTO, debug information in a dSYM (dsymutil), CoreFoundation,
///       Objective-C with Foundation, a dylib whose program
///       llvm-install-name-tool changes, UBSan, ASan, TSan, libFuzzer and
///       the profile runtime, each checked here for the libraries it loads
///       (llvm-otool -L: only the system's) and the macOS and SDK versions
///       it names; tests/cmake for both targets through the CMake package;
///       universal programs of both (llvm-lipo) in <dir>/universal.
///   node tests/sdk/macos.ts --run <dir>...
///       run the programs of programs.json in each directory; on arm64,
///       their ad-hoc signature is the linker's; Apple's tools read the
///       dSYMs (dwarfdump's UUIDs, atos).
///
/// Only programs leave the job, with their dSYMs and xclang's sanitizer
/// runtimes next to them: nothing of the SDK.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../scripts/common.ts";

const { values, positionals } = parseArgs({
  options: {
    tree: { type: "string" },
    out: { type: "string" },
    run: { type: "boolean" },
  },
  allowPositionals: true,
});
const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const failures: string[] = [];
const summary: string[] = [];

/// A program of programs.json: its arguments, a text its output must have,
/// whether it must fail (exit with other than 0, or abort, as ASan and TSan
/// do on macOS), a profile it must write (LLVM_PROFILE_FILE), and its dSYM:
/// next to it, with the address of a function of `source`.
interface Program {
  file: string;
  args?: string[];
  expect: string;
  fails?: boolean;
  profile?: boolean;
  dsym?: { address: string; source: string };
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

/// Run a command: its status, the signal that ended it, its output (stdout,
/// then stderr) and stdout.
function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): { status: number | null; signal: string | null; out: string; stdout: string } {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
  const stdout = String(r.stdout ?? "");
  const out = `${stdout}${r.stderr ?? ""}`;
  process.stdout.write(out.length > 20000 ? `${out.slice(0, 10000)}\n...\n${out.slice(-10000)}` : out);
  if (r.error) console.log(`  ${r.error.message}`);
  return { status: r.status, signal: r.signal, out, stdout };
}

function finish(): never {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  }
  if (failures.length) common.fail(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  console.log("all passed");
  process.exit(0);
}

/// Run every program of dir/programs.json, on a Mac.
function runAll(dir: string): void {
  const programs: Program[] = JSON.parse(fs.readFileSync(path.join(dir, "programs.json"), "utf8"));
  const arch = os.arch() === "arm64" ? "arm64" : "x86_64";
  for (const p of programs) {
    const file = path.resolve(dir, p.file);
    /// Artifacts lose the mode.
    fs.chmodSync(file, 0o755);
    const profile = `${file}.profraw`;
    fs.rmSync(profile, { force: true });
    const r = run(file, p.args ?? [], { cwd: dir, env: { ...process.env, LLVM_PROFILE_FILE: profile } });
    const ended = p.fails ? (r.status !== null && r.status !== 0) || r.signal === "SIGABRT" : r.status === 0;
    const ok = ended && r.out.includes(p.expect) && (!p.profile || (fs.existsSync(profile) && fs.statSync(profile).size > 0));
    check(ok, `${p.file}: exit ${r.status ?? r.signal}${p.profile ? ", a profile" : ""}, "${p.expect}"`);
    /// Run unsigned by codesign: on Apple silicon the kernel runs only
    /// signed code, and ld64.lld signs what it links for arm64 ad hoc.
    if (arch === "arm64") {
      const sign = run("codesign", ["-dv", file]);
      check(/Signature=adhoc/.test(sign.out), `${p.file}: an ad-hoc signature`);
    }
    if (p.dsym) {
      const dsym = `${file}.dSYM`;
      const uuids = (f: string) => [...run("dwarfdump", ["--uuid", f]).out.matchAll(/UUID: (\S+) \((\w+)\)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
      const [own, its] = [uuids(file), uuids(dsym)];
      check(own.length > 0 && JSON.stringify(own) === JSON.stringify(its), `${p.file}.dSYM: the program's UUIDs (${own.join(", ")})`);
      const dwarf = path.join(dsym, "Contents", "Resources", "DWARF", path.basename(file));
      const where = run("atos", ["-o", dwarf, "-arch", arch, p.dsym.address]).out;
      check(where.includes(`${p.dsym.source}:`), `atos ${p.dsym.address} in ${p.file}.dSYM: ${where.trim()}`);
    }
  }
}

if (values.run) {
  for (const dir of positionals) runAll(path.resolve(dir));
  finish();
}

if (!values.tree || !values.out) common.fail("--tree <xclang> --out <dir>, or --run <dir>...");
if (process.platform === "darwin") common.fail("macOS hosts build with Xcode's SDK (tests/toolchain/smoke.ts); this is for the others");
const tree = path.resolve(values.tree);
const out = path.resolve(values.out);
const tool = (name: string) => path.join(tree, "bin", name + exe);
const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "xclang-macos-"));
const sources = path.join(common.ROOT, "tests", "sdk");
const write = (name: string, text: string) => {
  fs.writeFileSync(path.join(work, name), text);
  return path.join(work, name);
};
const toolchain = path.join(tree, "lib", "cmake", "xclang", "toolchain.cmake");
const cmakeArgs = (source: string, dir: string, triple: string) => ["-G", "Ninja", "-S", source, "-B", dir,
  "-DCMAKE_BUILD_TYPE=Release", `--toolchain=${toolchain}`, `-DXCLANG_TARGET=${triple}`];
const hello = path.join(sources, "hello.c");

/// 1. Without the SDK: clang warns of the missing sdk/macos and finds no C
/// header; the CMake package says how to fetch it.
{
  const r = run(tool("clang"), ["--target=arm64-apple-macos", "-c", hello, "-o", path.join(work, "hello.o")]);
  check(r.status !== 0 && /sdk[\\/]macos/.test(r.out), "clang without the SDK names sdk/macos");
  const c = run("cmake", cmakeArgs(path.join(common.ROOT, "tests", "cmake"), path.join(work, "cmake-none"), "aarch64-apple-darwin"));
  check(c.status !== 0 && /xclang\s+sdk\s+fetch\s+macos\s+--accept-license/.test(c.out), "the CMake package without the SDK names xclang sdk fetch macos");
}

/// 2. The SDK, from Apple, into the tree: sdk/macos.
const start = Date.now();
const fetched = run(tool("xclang"), ["sdk", "fetch", "macos", "--accept-license"]);
check(fetched.status === 0, "sdk fetch macos");
summary.push(`- \`sdk fetch macos\`: ${((Date.now() - start) / 1000).toFixed(0)} s`);
const sdk = fetched.stdout.trim();
const sdkVersion = JSON.parse(fs.readFileSync(path.join(sdk, "SDKSettings.json"), "utf8")).Version as string;
check(fs.realpathSync.native(path.join(tree, "sdk", "macos")) === fs.realpathSync.native(sdk), `sdk/macos is ${path.basename(sdk)}, macOS SDK ${sdkVersion}`);
/// An -isysroot on the command line comes after the config file's: clang
/// takes the C headers from it, and ld64.lld the libraries.
{
  const other = path.join(work, "other.sdk");
  const r = run(tool("clang"), ["-###", "--target=arm64-apple-macos", "-isysroot", other, hello]);
  const lines = r.out.split("\n");
  /// -### escapes Windows' backslashes.
  const quoted = (p: string) => `"${p.replaceAll("\\", "\\\\")}`;
  const headers = /"-internal-externc-isystem" ("[^"]*)/.exec(lines.find((l) => l.includes('"-cc1"')) ?? "")?.[1];
  const libraries = /"-syslibroot" ("[^"]*)/.exec(lines.find((l) => l.includes("ld64.lld")) ?? "")?.[1];
  check(headers?.startsWith(quoted(other)) === true && libraries === quoted(other),
    `an -isysroot of the command line replaces sdk/macos: headers ${headers}", libraries ${libraries}"`);
}

/// 3. Programs, built for both targets, and what they load.
const asan = write("asan.cpp", `#include <sanitizer/asan_interface.h>
int main(int argc, char**) { int* p = new int[4]; int r = p[argc + 4]; delete[] p; return r; }
`);
const ubsan = write("ubsan.c", `#include <limits.h>
#include <stdio.h>
int main(int argc, char **argv) { (void)argv; int x = INT_MAX; x += argc; printf("ubsan %d\\n", x); return 0; }
`);
const tsan = write("tsan.cpp", `#include <sanitizer/tsan_interface.h>
#include <cstdio>
#include <thread>
int shared;
int main() { std::thread t([] { shared++; }); shared++; t.join(); std::printf("tsan %d\\n", shared); return 0; }
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
const useStd = write("use_std.cpp", `import std;
int main() { std::println("{} {}", "import", std::vector{1, 2, 3}); }
`);
const names = write("names.cpp", `#include <string>
std::string greet(const std::string& name) { return "hello, " + name; }
`);
const greet = write("greet.cpp", `#include <iostream>
#include <string>
std::string greet(const std::string& name);
int main() { std::cout << greet("dylib") << std::endl; }
`);

/// What a program may load: libSystem, which every program loads, and
/// what else it names: the frameworks it uses, libobjc, xclang's sanitizer
/// runtimes and its own dylib (@rpath/...). Not libc++.dylib: libc++ is
/// linked into it.
function loads(file: string, extra: RegExp[] = []): void {
  const libs = [...run(tool("llvm-otool"), ["-L", file]).out.matchAll(/^\s+(\S+) \(compatibility/gm)].map((m) => m[1]!);
  const allowed = [/^\/usr\/lib\/libSystem\.B\.dylib$/, ...extra];
  const others = libs.filter((l) => !allowed.some((a) => a.test(l)));
  check(libs.includes("/usr/lib/libSystem.B.dylib") && others.length === 0, `${path.basename(file)} loads ${[...new Set(libs)].join(" ")}`);
}

/// The macOS it runs on and the SDK it was built with, as LC_BUILD_VERSION
/// names them: the config file's 13.0, and the version of the SDK in use.
function versions(file: string): void {
  const load = run(tool("llvm-otool"), ["-l", file]).out;
  const [minos, sdkv] = [/minos (\S+)/.exec(load)?.[1], /sdk (\S+)/.exec(load)?.[1]];
  check(minos === common.MACOS_MIN && sdkv === sdkVersion, `${path.basename(file)}: minos ${minos}, sdk ${sdkv}`);
}

const ARCHS = [["arm64", "aarch64-apple-darwin"], ["x86_64", "x86_64-apple-darwin"]] as const;
const runtimes = path.join(common.resourceDir(tree), "lib", "darwin");
for (const [a, triple] of ARCHS) {
  const dir = path.join(out, a);
  fs.mkdirSync(dir, { recursive: true });
  const programs: Program[] = [];
  const build = (name: string, driver: string, args: string[], expect: string, extra: RegExp[] = [], more: Partial<Program> = {}): Program | undefined => {
    const file = path.join(dir, name);
    const r = run(tool(driver), [`--target=${triple}`, ...args, "-o", file], { cwd: work });
    check(r.status === 0 && fs.existsSync(file), `${triple}: ${name} (${driver} ${args.filter((x) => !path.isAbsolute(x)).join(" ")})`);
    if (!fs.existsSync(file)) return undefined;
    loads(file, extra);
    versions(file);
    const p = { file: name, expect, ...more };
    programs.push(p);
    return p;
  };
  /// Its dSYM, next to it, with main of `source`; main's address, for atos
  /// to find there.
  const dsym = (p: Program | undefined, source: string): void => {
    if (!p) return;
    const file = path.join(dir, p.file);
    const dump = fs.existsSync(`${file}.dSYM`) ? run(tool("llvm-dwarfdump"), ["--name=main", `${file}.dSYM`]).out : "";
    check(dump.includes(source), `${p.file}.dSYM, by clang's dsymutil, has main of ${source}`);
    const address = /^([0-9a-f]+) T _main$/m.exec(run(tool("llvm-nm"), [file]).out)?.[1];
    if (address) p.dsym = { address: `0x${address}`, source };
  };
  const sanitizer = (name: string) => new RegExp(`^@rpath/libclang_rt\\.${name}_osx_dynamic\\.dylib$`);
  const cpp = path.join(sources, "hello.cpp");
  const cppOut = "threads: 10, file size: 5, pi: 3.142";
  build("c", "clang", ["-O2", hello], "hello, C");
  build("cpp", "clang++", ["-std=c++23", "-O2", cpp], cppOut);
  build("cpp-lto", "clang++", ["-std=c++23", "-O2", "-flto=thin", cpp], cppOut);
  /// Compiled and linked by one command with -g, clang runs dsymutil; with
  /// ThinLTO, on the objects it keeps (-object_path_lto, patches/0007).
  dsym(build("cpp-debug", "clang++", ["-std=c++23", "-g", "-O0", cpp], cppOut), "hello.cpp");
  dsym(build("cpp-lto-debug", "clang++", ["-std=c++23", "-g", "-O2", "-flto=thin", cpp], cppOut), "hello.cpp");
  build("cf", "clang", ["-O2", path.join(sources, "cf.c"), "-framework", "CoreFoundation"], "HELLO, COREFOUNDATION (2 parts)",
    [/^\/System\/Library\/Frameworks\/CoreFoundation\.framework\//]);
  build("objc", "clang", ["-O2", "-fobjc-arc", path.join(sources, "objc.m"), "-framework", "Foundation"], "caught: thrown 1",
    [/^\/System\/Library\/Frameworks\/(Foundation|CoreFoundation)\.framework\//, /^\/usr\/lib\/libobjc\.A\.dylib$/]);
  build("ubsan", "clang", ["-fsanitize=undefined", "-O1", ubsan], "signed integer overflow", [sanitizer("ubsan")]);
  build("asan", "clang++", ["-fsanitize=address", "-g", "-O1", asan], "heap-buffer-overflow", [sanitizer("asan")], { fails: true });
  build("tsan", "clang++", ["-fsanitize=thread", "-g", "-O1", tsan], "ThreadSanitizer: data race", [sanitizer("tsan")], { fails: true });
  /// Sanitizer coverage without another sanitizer links the UBSan runtime,
  /// a dylib on macOS.
  build("fuzzer", "clang++", ["-fsanitize=fuzzer", "-O1", fuzzer], "Done 1000 runs", [sanitizer("ubsan")], { args: ["-runs=1000"] });
  build("profile", "clang", ["-fprofile-instr-generate", "-O1", profile], "profile ", [], { profile: true });
  /// The sanitizers' runtimes are dylibs, which the programs find next to
  /// them (-rpath @executable_path).
  for (const name of ["asan", "ubsan", "tsan"]) {
    const dylib = `libclang_rt.${name}_osx_dynamic.dylib`;
    fs.copyFileSync(path.join(runtimes, dylib), path.join(dir, dylib));
  }

  /// import std: libc++'s std module of the target, from its manifest.
  const manifest = run(tool("clang++"), [`--target=${triple}`, "-print-library-module-manifest-path"]).stdout.trim();
  const std = fs.existsSync(manifest)
    ? JSON.parse(fs.readFileSync(manifest, "utf8")).modules.find((m: { "logical-name": string }) => m["logical-name"] === "std")
    : undefined;
  check(std !== undefined, `${triple}: libc++'s module manifest (${manifest})`);
  if (std) {
    const pcm = path.join(work, `std-${a}.pcm`);
    const flags = ["-std=c++23", "-O2"];
    const precompiled = run(tool("clang++"), [`--target=${triple}`, ...flags, "-Wno-reserved-module-identifier", "--precompile",
      path.resolve(path.dirname(manifest), std["source-path"]), "-o", pcm]).status === 0;
    check(precompiled, `${triple}: std.pcm`);
    if (precompiled) build("import-std", "clang++", [...flags, `-fmodule-file=std=${pcm}`, useStd, pcm], "import [1, 2, 3]");
  }

  /// A dylib with an @rpath install name, and a program that finds it
  /// through an rpath llvm-install-name-tool adds: on arm64, the tool signs
  /// the program again, or it would not run.
  const dylib = path.join(dir, "libnames.dylib");
  const linked = run(tool("clang++"), [`--target=${triple}`, "-O2", "-dynamiclib", "-install_name", "@rpath/libnames.dylib", names, "-o", dylib]).status === 0 &&
    run(tool("clang++"), [`--target=${triple}`, "-O2", greet, dylib, "-o", path.join(dir, "dylib")]).status === 0 &&
    run(tool("llvm-install-name-tool"), ["-add_rpath", "@executable_path", path.join(dir, "dylib")]).status === 0;
  check(linked, `${triple}: a dylib, and llvm-install-name-tool -add_rpath on its program`);
  if (linked) {
    loads(dylib, [/^@rpath\/libnames\.dylib$/]);
    loads(path.join(dir, "dylib"), [/^@rpath\/libnames\.dylib$/]);
    check(/path @executable_path/.test(run(tool("llvm-otool"), ["-l", path.join(dir, "dylib")]).out), "dylib's rpath is @executable_path");
    programs.push({ file: "dylib", expect: "hello, dylib" });
  }

  /// 4. CMake: tests/cmake through the package's toolchain file; its
  /// programs run on the Mac, its GSYM test (a tool of this machine) here.
  const cmakeDir = path.join(work, `cmake-${a}`);
  const built = run("cmake", cmakeArgs(path.join(common.ROOT, "tests", "cmake"), cmakeDir, triple)).status === 0 &&
    run("cmake", ["--build", cmakeDir]).status === 0;
  check(built, `tests/cmake for ${triple}`);
  if (built) {
    check(run("ctest", ["--test-dir", cmakeDir, "-R", "gsym", "--output-on-failure"]).status === 0, `tests/cmake's hello_cpp.gsym for ${triple}`);
    for (const [program, expect] of [
      ["hello/hello_c", "C 2"],
      ["hello/hello_cpp", "hello from xclang, caught 42"],
      ["std/std_test", "3 4 5: 3 sides, caught 7\nfrom std.compat"],
      ["modules/modules_test", "triangle: 3 sides, perimeter 12"],
      ["noexcept/noexcept_test", "no exceptions: 6"],
    ] as const) {
      const name = `cmake-${path.basename(program)}`;
      fs.copyFileSync(path.join(cmakeDir, program), path.join(dir, name));
      loads(path.join(dir, name));
      versions(path.join(dir, name));
      programs.push({ file: name, expect });
    }
  }
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs, null, 1) + "\n");
  summary.push(`- ${triple}: ${programs.length} programs`);
}

/// 5. Universal programs, both architectures in one file (llvm-lipo), for
/// either Mac.
{
  const dir = path.join(out, "universal");
  fs.mkdirSync(dir, { recursive: true });
  const programs: Program[] = [];
  for (const [name, expect] of [["cpp", "threads: 10"], ["objc", "caught: thrown 1"]] as const) {
    const slices = ARCHS.map(([a]) => path.join(out, a, name));
    if (!slices.every((f) => fs.existsSync(f))) continue;
    const file = path.join(dir, name);
    run(tool("llvm-lipo"), ["-create", ...slices, "-output", file]);
    const archs = run(tool("llvm-lipo"), ["-archs", file]).stdout.trim().split(/\s+/).sort().join(" ");
    check(archs === "arm64 x86_64", `universal ${name}: ${archs}`);
    programs.push({ file: name, expect });
  }
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs, null, 1) + "\n");
  summary.push(`- universal: ${programs.length} programs`);
}

/// Only the programs leave the job, with their dSYMs and the sanitizers'
/// runtimes: no objects, no profiles.
for (const a of [...ARCHS.map(([a]) => a), "universal"]) {
  const dir = path.join(out, a);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (/\.(o|pcm|profraw|lto)$/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true });
  }
}
finish();
