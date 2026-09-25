/// Build one host's clang, lld and binary tools, and its libclang from the
/// same build, with an xclang tree of the bootstrap compiler and the
/// runtimes (work/out/runtimes-*):
///
///   --mode release        work/out/toolchain-<host>, work/out/libclang-<host>
///                         (PGO with --profile, ThinLTO)
///   --mode instrumented   work/out/toolchain-<host>-instrumented, the clang
///                         and lld that record the training profile
///   --mode asan           work/out/libclang-<host>-asan

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    mode: { type: "string", default: "release" },
    profile: { type: "string" },
  },
});
const mode = values.mode!;
if (!values.host || !["release", "instrumented", "asan"].includes(mode)) {
  common.fail("--host <triple> [--mode release|instrumented|asan] [--profile <file>]");
}
const host = common.target(values.host);
if (common.buildMachine(host) !== common.machine()) common.fail(`${host.triple} is built on ${common.buildMachine(host)}`);
const profile = values.profile ? path.resolve(values.profile) : undefined;
if (profile && !fs.existsSync(profile)) common.fail(`no profile at ${profile}`);

const native = common.machineTarget();
const runtimes = (t: common.Target) =>
  path.join(common.WORK, "out", `runtimes-${t.os === "darwin" ? "darwin" : t.triple}`);
const parts = [...new Set([runtimes(host), runtimes(native)])];
for (const part of parts) if (!fs.existsSync(part)) common.fail(`missing ${part}`);

const bootstrap = path.join(common.WORK, "bootstrap");
const stage = common.makeTree(path.join(common.WORK, "stage", `toolchain-${host.triple}-${mode}`), bootstrap, parts);
const src = await common.llvmSource();
const caches = path.join(common.ROOT, "cmake", "caches");
if (common.machine() === "macos") {
  process.env.SDKROOT ??= spawnSync("xcrun", ["--show-sdk-path"], { encoding: "utf8" }).stdout.trim();
}

/// Another OS or architecture needs table generators that run here; macOS
/// runs the x86_64 ones through Rosetta.
const cross = host.os !== native.os || host.arch !== native.arch;

function nativeTools(): string {
  const build = path.join(common.WORK, "build", "native-tools");
  const bin = path.join(build, "bin");
  if (fs.existsSync(path.join(bin, "clang-tblgen"))) return bin;
  common.run("cmake", [
    "-G", "Ninja", "-S", path.join(src, "llvm"), "-B", build,
    ...common.cmakeToolchainArgs(stage, native),
    "-DCMAKE_BUILD_TYPE=Release",
    "-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra;lld",
    "-DLLVM_TARGETS_TO_BUILD=",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_ENABLE_ZLIB=OFF",
    "-DLLVM_ENABLE_ZSTD=OFF",
    "-DLLVM_ENABLE_LIBXML2=OFF",
  ]);
  common.run("cmake", [
    "--build", build, "--target",
    "llvm-tblgen", "llvm-min-tblgen", "clang-tblgen", "clang-tidy-confusable-chars-gen",
  ]);
  return bin;
}

const name = mode === "release" ? host.triple : `${host.triple}-${mode}`;
const build = path.join(common.WORK, "build", `toolchain-${name}`);
fs.rmSync(build, { recursive: true, force: true });

const args = [
  "-G", "Ninja", "-S", path.join(src, "llvm"), "-B", build,
  ...common.cmakeToolchainArgs(stage, host),
  "-C", path.join(caches, "clang.cmake"),
  ...(mode === "release" ? [] : ["-C", path.join(caches, `${mode}.cmake`)]),
  "-DCMAKE_INSTALL_PREFIX=/",
  `-DLLVM_DEFAULT_TARGET_TRIPLE=${host.triple}`,
];
if (cross) args.push(`-DLLVM_HOST_TRIPLE=${host.triple}`);
if (cross && host.os !== "darwin") args.push(`-DLLVM_NATIVE_TOOL_DIR=${nativeTools()}`);
/// clice and its tests expect backslash-preferred paths on Windows.
if (host.os === "mingw") args.push("-DLLVM_WINDOWS_PREFER_FORWARD_SLASH=OFF");
/// Find the SDK the way Apple's clang does, with no -isysroot or SDKROOT.
if (host.os === "darwin") args.push("-DCLANG_USE_XCSELECT=ON");
if (profile) {
  const flags = [
    `-fprofile-remapping-file=${path.join(common.ROOT, "pgo", "remap.txt")}`,
    "-Wno-profile-instr-unprofiled",
    "-Wno-profile-instr-out-of-date",
    "-Wno-profile-instr-missing",
  ].join(" ");
  args.push(`-DLLVM_PROFDATA_FILE=${profile}`, `-DCMAKE_C_FLAGS=${flags}`, `-DCMAKE_CXX_FLAGS=${flags}`);
}
common.run("cmake", args);

function install(target: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  const start = Date.now();
  common.run("cmake", ["--build", build, "--target", target], { env: { ...process.env, DESTDIR: dest } });
  console.log(`${target}: ${Math.round((Date.now() - start) / 60000)} min`);
}

const out = path.join(common.WORK, "out");
if (mode !== "asan") install("install-toolchain-stripped", path.join(out, `toolchain-${name}`));
if (mode !== "instrumented") {
  const dest = path.join(out, `libclang-${name}`);
  install("install-development", dest);
  /// clice reaches into Sema's private headers.
  const sema = path.join(dest, "include", "clang", "Sema");
  for (const header of ["CoroutineStmtBuilder.h", "TypeLocBuilder.h", "TreeTransform.h"]) {
    fs.copyFileSync(path.join(src, "clang", "lib", "Sema", header), path.join(sema, header));
  }
  const manifest = {
    LLVM_VERSION: common.LLVM_VERSION,
    TARGET_TRIPLE: host.triple,
    BUILD_TYPE: mode === "asan" ? "Debug" : "Release",
    LTO: mode === "asan" ? "OFF" : "Thin",
    PGO: profile ? path.basename(profile) : "OFF",
    ASAN: mode === "asan" ? "ON" : "OFF",
    ASSERTIONS: mode === "asan" ? "ON" : "OFF",
    RTTI: "OFF",
    STDLIB: "libc++",
    LIBCXX_HARDENING_MODE: "none",
    OSX_DEPLOYMENT_TARGET: host.os === "darwin" ? common.MACOS_MIN : "",
  };
  const file = path.join(dest, "lib", "cmake", "xclang", "libclang.cmake");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Object.entries(manifest).map(([k, v]) => `set(XCLANG_${k} "${v}")\n`).join(""));
}
