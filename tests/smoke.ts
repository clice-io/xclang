/// Check a release toolchain on the machine it is built for:
///
/// - its own programs do not load a C++ runtime, and on Linux need no
///   glibc newer than 2.17;
/// - a C and a C++ program (exceptions, iostreams, threads) build for every
///   target it carries (macOS ones only on macOS: the SDK) and run where
///   this machine can run them;
/// - natively also `import std;`, a precompiled header and ThinLTO;
/// - dSYM and GSYM debug symbols by the tree's dsymutil and llvm-gsymutil.
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
/// xclang's own command, in the archives that carry it (scripts/cli.ts),
/// built for the release of the archive.
if (fs.existsSync(tool("xclang"))) {
  programs.push(tool("xclang"));
  const said = /^xclang (\S+)$/m.exec(run(tool("xclang"), ["--version"]) ?? "")?.[1];
  const config = path.join(tree, "lib", "cmake", "xclang", "xclang-config-version.cmake");
  const release = /^set\(PACKAGE_VERSION "(.+)"\)$/m.exec(fs.readFileSync(config, "utf8"))?.[1];
  if (!release || said !== release) failures.push(`xclang --version says ${said}, the archive is of ${release}`);
}
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

/// Debug symbols for a program's release, by the tree's own tools: the
/// dSYM of a macOS program (dsymutil, on every host), and GSYM for every
/// target, from the DWARF of the program or of its dSYM, checked against
/// that DWARF (--verify) and holding main. One clang command compiling and
/// linking a macOS program with -g runs the tree's dsymutil too.
for (const t of targets) {
  const suffix = t.endsWith("mingw32") ? ".exe" : "";
  const object = path.join(work, `symbols-${t}.o`);
  const out = path.join(work, `symbols-${t}${suffix}`);
  if (run(tool("clang"), [`--target=${t}`, "-g", "-O1", "-c", helloC, "-o", object]) === undefined ||
      run(tool("clang"), [`--target=${t}`, object, "-o", out]) === undefined) continue;
  let dwarf = out;
  if (t.includes("apple")) {
    const dsym = `${out}.dSYM`;
    if (run(tool("dsymutil"), [out, "-o", dsym]) === undefined) continue;
    dwarf = path.join(dsym, "Contents", "Resources", "DWARF", path.basename(out));
  }
  const gsym = `${out}.gsym`;
  /// (--verify on Windows compares the DWARF's / with its own \ in paths.)
  if (run(tool("llvm-gsymutil"), ["--convert", dwarf, "--out-file", gsym, ...(windows ? [] : ["--verify"])]) === undefined) continue;
  const dump = run(tool("llvm-gsymutil"), [gsym]) ?? "";
  if (!/\bmain\b/.test(dump) || !dump.includes("hello.c")) failures.push(`${gsym} has no main of hello.c`);
}
run(tool("dsymutil"), ["--version"]);
{
  const args = ["--target=arm64-apple-macos", "-g", "-###", helloC];
  const result = spawnSync(tool("clang"), args, { encoding: "utf8", cwd: work });
  /// -### escapes Windows' backslashes.
  let dsymutil = /^ "([^"]*dsymutil[^"]*)"/m.exec(result.stderr ?? "")?.[1]?.replaceAll("\\\\", "\\");
  /// (On Windows, without the .exe Windows adds to start it.)
  if (dsymutil && windows && !dsymutil.endsWith(".exe")) dsymutil += ".exe";
  if (!dsymutil || !fs.existsSync(dsymutil) || fs.realpathSync(dsymutil) !== fs.realpathSync(tool("dsymutil"))) {
    failures.push(`clang ${args.join(" ")} runs ${dsymutil ?? "no dsymutil"}, not ${tool("dsymutil")}`);
  }
}

/// Past the config files, upstream clang's defaults: libclang's driver has
/// the same ones, and clice runs it to stand in for g++ (libstdc++).
{
  const args = ["--no-default-config", "--target=x86_64-unknown-linux-gnu", "-###", helloC];
  const result = spawnSync(tool("clang++"), args, { encoding: "utf8", cwd: work });
  if (!(result.stderr ?? "").includes('"-lstdc++"')) failures.push(`clang++ ${args.join(" ")} links no libstdc++`);
}

/// A macOS target links with ld64.lld, on macOS too (patches/0007).
{
  const args = ["--target=arm64-apple-macos", "-###", helloC];
  const result = spawnSync(tool("clang"), args, { encoding: "utf8", cwd: work });
  if (!/ld64\.lld/.test(result.stderr ?? "")) failures.push(`clang ${args.join(" ")} does not link with ld64.lld`);
}

/// ld64.lld reads .tbd stubs listing arm64e.x1, as the macOS 27 SDK's do
/// (patches/0009), on every host: a dylib linked against such a libSystem.
{
  const sdk = path.join(work, "sdk-arm64e-x1");
  fs.mkdirSync(path.join(sdk, "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(sdk, "usr", "lib", "libSystem.tbd"), `--- !tapi-tbd
tbd-version:      4
targets:          [ arm64-macos, arm64e-macos, arm64e.x1-macos ]
install-name:     '/usr/lib/libSystem.B.dylib'
current-version:  1351
exports:
  - targets:      [ arm64-macos, arm64e-macos, arm64e.x1-macos ]
    symbols:      [ _puts ]
...
`);
  const object = path.join(work, "arm64e-x1.o");
  if (run(tool("clang"), ["--target=arm64-apple-macos", "-c", write("arm64e-x1.c", "int puts(const char*);\nint hello(void) { return puts(\"hello\"); }\n"), "-o", object]) !== undefined) {
    run(tool("ld64.lld"), ["-syslibroot", sdk, "-lSystem", "-dylib", "-arch", "arm64", "-platform_version", "macos", "15", "27",
      object, "-o", path.join(work, "libarm64e-x1.dylib")]);
  }
}

/// The macOS targets' SDK: on a macOS host the one clang finds by itself
/// (Xcode's), elsewhere the one the tree's xclang fetches into sdk/macos,
/// which clang names when it is not there (tests/macos.ts builds with it).
{
  const args = ["--target=arm64-apple-macos", "-c", helloC, "-o", path.join(work, "hello-macos.o")];
  const result = spawnSync(tool("clang"), process.platform === "darwin" ? ["-###", ...args] : args, { encoding: "utf8", cwd: work });
  const named = /sdk[\\/]macos/.test(result.stderr ?? "");
  if (process.platform === "darwin" ? named : !fs.existsSync(path.join(tree, "sdk", "macos")) && (result.status === 0 || !named)) {
    failures.push(`clang ${args.join(" ")} ${process.platform === "darwin" ? "names sdk/macos" : "without the macOS SDK"}: ${result.stderr}`);
  }
}

/// The MSVC targets: compiler-rt in the layout lld-link searches, and the
/// config files of clang and of clang-cl (a plain clang-cl too: none of the
/// host target's options), which read the Windows SDK the tree's xclang
/// fetches into sdk/windows and stop without it (tests/msvc.ts builds with
/// it). clang-cl without the config files warns of nothing.
for (const a of ["x86_64", "aarch64"]) {
  for (const lib of ["builtins", "profile", ...(a === "x86_64" ? ["asan_dynamic"] : [])]) {
    const file = path.join(tree, "lib", "clang", fs.readdirSync(path.join(tree, "lib", "clang"))[0]!, "lib", "windows", `clang_rt.${lib}-${a}.lib`);
    if (!fs.existsSync(file)) failures.push(`missing ${file}`);
  }
}
if (!fs.existsSync(path.join(tree, "sdk", "windows"))) {
  for (const [driver, args, cfg] of [
    ["clang", ["--target=aarch64-pc-windows-msvc", "-c", helloC], "aarch64-pc-windows-msvc.cfg"],
    ["clang-cl", ["/c", "--", helloC], `${arch}-pc-windows-msvc-clang-cl.cfg`],
  ] as const) {
    const result = spawnSync(tool(driver), args, { encoding: "utf8", cwd: work });
    if (result.status === 0 || !new RegExp(`sdk[\\\\/]windows[\\\\/]${cfg}`).test(result.stderr ?? "")) {
      failures.push(`${driver} ${args.join(" ")} without the Windows SDK: ${result.stderr}`);
    }
  }
}
{
  const args = ["--no-default-config", "/WX", "-###", "/c", helloC];
  const result = spawnSync(tool("clang-cl"), args, { encoding: "utf8", cwd: work });
  if (result.status !== 0 || /warning:/.test(result.stderr ?? "")) failures.push(`clang-cl ${args.join(" ")}: ${result.stderr}`);
}

/// Visual Studio through its Setup API (patches/0004), with none of a
/// Developer Command Prompt's variables, on a Windows host that has it:
/// without the config files, which name the fetched SDK instead.
const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
if (windows && fs.existsSync(vswhere)) {
  const env = { ...process.env };
  for (const name of ["VCToolsInstallDir", "VCINSTALLDIR", "INCLUDE"]) delete env[name];
  const args = ["--no-default-config", `--target=${arch}-pc-windows-msvc`, "-###", "-c", helloC];
  const result = spawnSync(tool("clang++"), args, { encoding: "utf8", cwd: work, env });
  if (!/VC\\\\Tools\\\\MSVC\\\\/.test(result.stderr ?? "")) failures.push(`clang++ ${args.join(" ")} finds no Visual Studio: ${result.stderr}`);
}

/// 3. Native: the sanitizers and libFuzzer (Linux, macOS), import std, a
/// precompiled header, ThinLTO.
function expectReport(label: string, program: string, args: string[], text: string): void {
  console.log(`+ ${program} ${args.join(" ")}`);
  const result = spawnSync(program, args, { encoding: "utf8", cwd: work });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  process.stdout.write(output.slice(-3000));
  if (!output.includes(text)) failures.push(`${label}: no "${text}" in its output`);
}
if (!windows) {
  const sanitized: [string, string, string, string][] = [
    ["address", `#include <sanitizer/asan_interface.h>
int main(int argc, char**) { int* p = new int[4]; int r = p[argc + 4]; delete[] p; return r; }
`, "heap-buffer-overflow", ""],
    ["thread", `#include <sanitizer/tsan_interface.h>
#include <thread>
int shared;
int main() { std::thread t([] { shared++; }); shared++; t.join(); return shared == 2 ? 0 : 1; }
`, "ThreadSanitizer: data race", ""],
    ["fuzzer", `#include <cstddef>
#include <cstdint>
#include <fuzzer/FuzzedDataProvider.h>
extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  FuzzedDataProvider input(data, size);
  if (input.ConsumeIntegral<char>() == 'x') { volatile int sum = input.ConsumeIntegral<int>(); (void)sum; }
  return 0;
}
`, "Done 1000 runs", "-runs=1000"],
  ];
  for (const [sanitizer, source, report, arg] of sanitized) {
    const out = path.join(work, `sanitize-${sanitizer}`);
    if (run(tool("clang++"), [`--target=${native}`, `-fsanitize=${sanitizer}`, "-g", "-O1", write(`sanitize-${sanitizer}.cpp`, source), "-o", out]) === undefined) continue;
    expectReport(`-fsanitize=${sanitizer}`, out, arg ? [arg] : [], report);
  }
}

/// libc++'s ASan build (<target>/lib/asan, usr/lib/asan on Linux), as an
/// ASan build takes it: std::string's container checks report an overflow,
/// and a program sharing an instantiation with libc++.a (std::filesystem's
/// vector<string_view>::push_back) gets no false report.
const asanLibcxx = path.join(tree, native, process.platform === "darwin" ? "" : "usr", "lib", "asan");
const asanFlags = ["-fsanitize=address", "-isystem", path.join(asanLibcxx, "include"), "-nostdlib++", path.join(asanLibcxx, "libc++.a")];
if (!windows) {
  const overflow = write("sanitize-string.cpp", `#include <string>
int main(int argc, char**) {
  std::string s(40, 'x');
  s.reserve(100);
  return s.data()[40 + argc];
}
`);
  const out = path.join(work, "sanitize-string");
  if (run(tool("clang++"), [`--target=${native}`, ...asanFlags, "-g", "-O0", overflow, "-o", out]) !== undefined) {
    expectReport("std::string under ASan", out, [], "container-overflow");
  }
  const shared = write("sanitize-libcxx.cpp", `#include <cstdio>
#include <filesystem>
#include <string_view>
#include <vector>
int main(int argc, char**) {
  std::vector<std::string_view> parts;
  for (int i = 0; i < argc * 9; ++i) parts.push_back(std::string_view("x"));
  auto path = std::filesystem::weakly_canonical("/nonexistent/a/b/c/d/e/f/g/h/i/j/k/l/m/n");
  std::printf("%zu %s\\n", parts.size(), path.c_str());
}
`);
  const program = path.join(work, "sanitize-libcxx");
  if (run(tool("clang++"), [`--target=${native}`, "-std=c++23", ...asanFlags, "-g", "-O0", shared, "-o", program]) !== undefined) {
    const result = spawnSync(program, [], { encoding: "utf8", cwd: work });
    if (result.status !== 0 || /AddressSanitizer/.test(result.stderr ?? "")) {
      failures.push(`libc++ under ASan: ${(result.stderr ?? "").slice(0, 2000)}`);
    }
  }
}

/// format_to into a container after an argument of 256 code units
/// (patches/0006): no write past libc++'s stack buffer.
if (!windows) {
  const source = write("format-256.cpp", `#include <cstdio>
#include <format>
#include <iterator>
#include <string>
int main() {
  std::string out, cut;
  std::format_to(std::back_inserter(out), "{}!", std::string(256, 'a'));
  std::format_to_n(std::back_inserter(cut), 300, "{}!", std::string(256, 'a'));
  std::printf("%zu %zu\\n", out.size(), cut.size());
  return out.size() == 257 && cut.size() == 257 ? 0 : 1;
}
`);
  const out = path.join(work, "format-256");
  /// Debug hardening too: through format_to_n the stray write lands inside
  /// the buffer object, where ASan does not look.
  const flags = ["-std=c++23", ...asanFlags, "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG", "-g", "-O0"];
  if (run(tool("clang++"), [`--target=${native}`, ...flags, source, "-o", out]) !== undefined) {
    const result = spawnSync(out, [], { encoding: "utf8", cwd: work });
    if (result.status !== 0) failures.push(`format_to after 256 code units: ${(result.stderr ?? "").slice(0, 2000)}`);
  }
}

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

/// clang -E keeps a raw string literal of a CRLF file as compiling it does,
/// through a text-mode stream too (Windows), and the lines after it
/// (patches/0008): its output compiles to the same program.
{
  const source = write("raw-crlf.cpp", [
    "#include <cstdio>",
    "#include <cstring>",
    "#include <source_location>",
    "const char* s = R\"(a",
    "b)\";",
    "int line = std::source_location::current().line();",
    "int main() {",
    "  std::printf(\"%d %zu\\n\", line, std::strlen(s));",
    "  return line == 6 && std::strcmp(s, \"a\\nb\") == 0 ? 0 : 1;",
    "}",
    "",
  ].join("\r\n"));
  const flags = [`--target=${native}`, "-std=c++20"];
  const preprocessed = path.join(work, "raw-crlf.ii");
  const program = path.join(work, `raw-crlf${exe}`);
  if (run(tool("clang++"), [...flags, "-E", source, "-o", preprocessed]) !== undefined &&
      run(tool("clang++"), [...flags, preprocessed, "-o", program]) !== undefined) {
    run(program, []);
  }
}

const header = write("common.hpp", "#include <map>\n#include <string>\n#include <vector>\n");
const pchUser = write("pch_user.cpp", "int main() { std::map<std::string, std::vector<int>> m; return int(m.size()); }\n");
run(tool("clang++"), [`--target=${native}`, "-x", "c++-header", header, "-o", path.join(work, "common.hpp.pch")]);
run(tool("clang++"), [`--target=${native}`, "-include-pch", path.join(work, "common.hpp.pch"), pchUser, "-o", path.join(work, `pch${exe}`)]);

/// ThinLTO, compiled and linked by one command: on macOS clang passes
/// ld64.lld -object_path_lto, whose empty object needs patches/0007 for
/// the program to catch what it throws.
const lto = path.join(work, `lto${exe}`);
if (run(tool("clang++"), [`--target=${native}`, "-O2", "-flto=thin", helloCxx, "-o", lto]) !== undefined) {
  const output = run(lto, []);
  if (output !== undefined && !output.includes("hello c++")) failures.push(`${lto} printed ${JSON.stringify(output)}`);
}

if (failures.length) fail(`${failures.length} checks failed:\n  ${failures.join("\n  ")}`);
console.log("all checks passed");
