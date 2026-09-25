/// Build the runtimes of one target (or of both macOS targets at once:
/// --target darwin) with the bootstrap compiler, into
/// work/out/runtimes-<name>:
///
///   <triple>/                  sysroot, libunwind, libc++abi, libc++
///   lib/clang/<ver>/lib/...    compiler-rt: builtins, crt objects, profile
///
/// Every toolchain tree gets these files as they are, so each target is
/// built once and serves every host.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import * as common from "./common.ts";
import { buildSysroot } from "./sysroot.ts";

const { values } = parseArgs({ options: { target: { type: "string" } } });
if (!values.target) common.fail("--target <triple> or --target darwin");

const bootstrap = path.join(common.WORK, "bootstrap");
if (!fs.existsSync(path.join(bootstrap, "bin", "clang"))) common.fail("run scripts/bootstrap.ts first");
const src = await common.llvmSource();
const caches = path.join(common.ROOT, "cmake", "caches");

/// Runtimes are built without the config files: those link the very
/// libraries being built. CMAKE_SYSROOT (cmake/toolchain.cmake) still
/// names the sysroot.
const NO_CONFIG = ["C", "CXX", "ASM"].map((lang) => `-DCMAKE_${lang}_FLAGS=--no-default-config`);

function cmake(name: string, source: string, args: string[]): void {
  const build = path.join(common.WORK, "build", name);
  fs.rmSync(build, { recursive: true, force: true });
  common.run("cmake", ["-G", "Ninja", "-S", source, "-B", build, ...args]);
  common.run("cmake", ["--build", build, "--target", "install"]);
}

function builtins(t: common.Target, stage: string): void {
  cmake(`builtins-${t.triple}`, path.join(src, "compiler-rt", "lib", "builtins"), [
    ...common.cmakeToolchainArgs(stage, t),
    "-C", path.join(caches, "builtins.cmake"),
    `-DCOMPILER_RT_DEFAULT_TARGET_TRIPLE=${common.normalized(t)}`,
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    `-DCOMPILER_RT_BUILD_CRT=${t.os === "linux" ? "ON" : "OFF"}`,
    ...NO_CONFIG,
  ]);
}

function cxx(t: common.Target, stage: string): void {
  /// Linux keeps the usual sysroot layout (usr/include, usr/lib), where
  /// clang's Linux driver looks; mingw and macOS use the top of the target
  /// directory, as the mingw driver and the config files expect.
  const prefix = t.os === "linux" ? path.join(stage, t.triple, "usr") : path.join(stage, t.triple);
  const darwin = t.os === "darwin";
  cmake(`cxx-${t.triple}`, path.join(src, "runtimes"), [
    ...common.cmakeToolchainArgs(stage, t),
    "-C", path.join(caches, "cxx.cmake"),
    `-DLLVM_ENABLE_RUNTIMES=${darwin ? "libcxxabi;libcxx" : "libunwind;libcxxabi;libcxx"}`,
    /// macOS unwinds with the system's libunwind, part of libSystem.
    `-DLIBCXXABI_USE_LLVM_UNWINDER=${darwin ? "OFF" : "ON"}`,
    `-DLLVM_DEFAULT_TARGET_TRIPLE=${common.normalized(t)}`,
    `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    ...NO_CONFIG,
  ]);
}

function profile(t: common.Target, stage: string): void {
  cmake(`compiler-rt-${t.triple}`, path.join(src, "runtimes"), [
    ...common.cmakeToolchainArgs(stage, t),
    "-C", path.join(caches, "compiler-rt.cmake"),
    `-DCOMPILER_RT_DEFAULT_TARGET_TRIPLE=${common.normalized(t)}`,
    `-DLLVM_DEFAULT_TARGET_TRIPLE=${common.normalized(t)}`,
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    ...NO_CONFIG,
  ]);
}

/// compiler-rt for macOS is one build of universal (arm64 + x86_64)
/// libraries under lib/clang/<ver>/lib/darwin, the layout clang's Darwin
/// driver reads.
function compilerRtDarwin(stage: string): void {
  const bin = path.join(stage, "bin");
  cmake("compiler-rt-darwin", path.join(src, "runtimes"), [
    `-DCMAKE_C_COMPILER=${path.join(bin, "clang")}`,
    `-DCMAKE_CXX_COMPILER=${path.join(bin, "clang++")}`,
    `-DCMAKE_AR=${path.join(bin, "llvm-ar")}`,
    `-DCMAKE_RANLIB=${path.join(bin, "llvm-ranlib")}`,
    `-DCMAKE_LIPO=${path.join(bin, "llvm-lipo")}`,
    `-DCMAKE_LIBTOOL=${path.join(bin, "llvm-libtool-darwin")}`,
    "-C", path.join(caches, "compiler-rt.cmake"),
    "-DCOMPILER_RT_BUILD_BUILTINS=ON",
    "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=OFF",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
    ...["IOS", "WATCHOS", "TVOS", "XROS"].map((p) => `-DCOMPILER_RT_ENABLE_${p}=OFF`),
    "-DDARWIN_osx_ARCHS=arm64;x86_64",
    "-DDARWIN_osx_BUILTIN_ARCHS=arm64;x86_64",
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    ...NO_CONFIG,
  ]);
}

/// Link (and, when this machine can, run) a C++ program for the target
/// with the finished tree: the config file, sysroot and runtimes together.
function check(t: common.Target, stage: string): void {
  const dir = path.join(common.WORK, "build", `check-${t.triple}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "hello.cpp");
  fs.writeFileSync(source, [
    "#include <cstdio>",
    "#include <stdexcept>",
    "#include <string>",
    "#include <vector>",
    "int main() {",
    "  std::vector<std::string> words{\"hello\", \"from\", \"xclang\"};",
    "  try { throw std::runtime_error(words[0] + \" \" + words[2]); }",
    "  catch (const std::exception& e) { std::puts(e.what()); }",
    "}",
    "",
  ].join("\n"));
  const exe = path.join(dir, `hello${t.os === "mingw" ? ".exe" : ""}`);
  common.run(path.join(stage, "bin", "clang++"), [`--target=${t.triple}`, "-O2", source, "-o", exe]);
  const native = common.machineTarget();
  const runnable = t.os === native.os && (t.arch === native.arch || t.os === "darwin");
  if (runnable) common.run(exe, []);
  const tool = t.os === "darwin" ? ["llvm-otool", "-L"] : ["llvm-readobj", "--needed-libs"];
  common.run(path.join(stage, "bin", tool[0]), [tool[1], exe]);
}

function collect(stage: string, name: string, dirs: string[]): void {
  const out = path.join(common.WORK, "out", `runtimes-${name}`);
  fs.rmSync(out, { recursive: true, force: true });
  for (const dir of dirs) common.copyTree(path.join(stage, dir), path.join(out, dir));
  console.log(`runtimes in ${out}`);
  const listing = spawnSync("du", ["-sh", ...dirs], { cwd: out, encoding: "utf8" });
  console.log(listing.stdout);
}

const stage = common.makeTree(path.join(common.WORK, "stage", `runtimes-${values.target}`), bootstrap);
const resource = path.relative(stage, common.resourceDir(stage));

if (values.target === "darwin") {
  if (common.machine() !== "macos") common.fail("the macOS runtimes are built on macOS");
  process.env.SDKROOT ??= spawnSync("xcrun", ["--show-sdk-path"], { encoding: "utf8" }).stdout.trim();
  const targets = common.TARGETS.filter((t) => t.os === "darwin");
  for (const t of targets) {
    await buildSysroot(t, stage);
    cxx(t, stage);
  }
  compilerRtDarwin(stage);
  for (const t of targets) check(t, stage);
  collect(stage, "darwin", [...targets.map((t) => t.triple), path.join(resource, "lib", "darwin")]);
} else {
  const t = common.target(values.target);
  if (common.buildMachine(t) !== common.machine()) common.fail(`${t.triple} is built on ${common.buildMachine(t)}`);
  await buildSysroot(t, stage);
  builtins(t, stage);
  cxx(t, stage);
  profile(t, stage);
  check(t, stage);
  collect(stage, t.triple, [t.triple, path.join(resource, "lib", common.normalized(t))]);
}
