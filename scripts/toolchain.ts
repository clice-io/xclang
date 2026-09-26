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

/// Static zlib and zstd for the host, in a prefix of their own; macOS has
/// zlib in the system. libclang carries them too (its libraries need them).
async function compression(): Promise<{ prefix: string; args: string[] }> {
  const work = path.join(common.WORK, "build", `compression-${host.triple}`);
  const prefix = path.join(work, "prefix");
  fs.rmSync(work, { recursive: true, force: true });
  const build = async (name: "zlib" | "zstd", subdir: string, extra: string[]) => {
    const source = path.join(common.WORK, "src", name);
    if (!fs.existsSync(source)) common.extract(await common.fetchSource(name), source);
    const dir = path.join(work, name);
    common.run("cmake", [
      "-G", "Ninja", "-S", path.join(source, subdir), "-B", dir,
      ...common.cmakeToolchainArgs(stage, host),
      "-DCMAKE_BUILD_TYPE=Release", `-DCMAKE_INSTALL_PREFIX=${prefix}`,
      "-DCMAKE_POSITION_INDEPENDENT_CODE=ON", ...extra,
    ]);
    common.run("cmake", ["--build", dir, "--target", "install"]);
    /// Static only: whatever shared library the install put in goes.
    for (const file of fs.readFileSync(path.join(dir, "install_manifest.txt"), "utf8").split("\n")) {
      if (/\.(so(\.\d+)*|dll|dll\.a|dylib)$/.test(file)) fs.rmSync(file, { force: true });
    }
  };
  const args: string[] = [];
  if (host.os !== "darwin") {
    await build("zlib", ".", ["-DZLIB_BUILD_EXAMPLES=OFF"]);
    /// zlib names its static library zlibstatic on Windows.
    const lib = path.join(prefix, "lib");
    for (const file of fs.readdirSync(lib)) if (/^lib(zlibstatic|zlib)\.a$/.test(file)) fs.renameSync(path.join(lib, file), path.join(lib, "libz.a"));
    args.push(`-DZLIB_INCLUDE_DIR=${path.join(prefix, "include")}`, `-DZLIB_LIBRARY=${path.join(lib, "libz.a")}`);
  }
  await build("zstd", path.join("build", "cmake"), [
    "-DZSTD_BUILD_SHARED=OFF", "-DZSTD_BUILD_STATIC=ON", "-DZSTD_BUILD_PROGRAMS=OFF", "-DZSTD_BUILD_TESTS=OFF",
  ]);
  args.push(`-Dzstd_DIR=${path.join(prefix, "lib", "cmake", "zstd")}`);
  return { prefix, args };
}
const compressionLibs = await compression();

const name = mode === "release" ? host.triple : `${host.triple}-${mode}`;
const build = path.join(common.WORK, "build", `toolchain-${name}`);
fs.rmSync(build, { recursive: true, force: true });

const args = [
  "-G", "Ninja", "-S", path.join(src, "llvm"), "-B", build,
  ...common.cmakeToolchainArgs(stage, host),
  /// macOS links with the system's ld, which does LTO through xclang's
  /// libLTO.dylib (config/darwin.cfg); read by clang.cmake.
  ...(host.os === "darwin" ? ["-DXCLANG_EXTRA_TOOLCHAIN_COMPONENTS=LTO"] : []),
  "-C", path.join(caches, "clang.cmake"),
  ...(mode === "release" ? [] : ["-C", path.join(caches, `${mode}.cmake`)]),
  /// Installed with DESTDIR, then moved out of it (install() below); "/"
  /// itself would make GNUInstallDirs put everything under usr/.
  "-DCMAKE_INSTALL_PREFIX=/xclang",
  `-DLLVM_DEFAULT_TARGET_TRIPLE=${host.triple}`,
  ...compressionLibs.args,
];
if (cross) args.push(`-DLLVM_HOST_TRIPLE=${host.triple}`);
if (cross && host.os !== "darwin") args.push(`-DLLVM_NATIVE_TOOL_DIR=${nativeTools()}`);
/// clice and its tests expect backslash-preferred paths on Windows.
if (host.os === "mingw") args.push("-DLLVM_WINDOWS_PREFER_FORWARD_SLASH=OFF");
/// Find the SDK the way Apple's clang does, with no -isysroot or SDKROOT,
/// and link with the system's ld like it (see config/darwin.cfg).
if (host.os === "darwin") args.push("-DCLANG_USE_XCSELECT=ON", "-DCLANG_DEFAULT_LINKER=");
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
  const destdir = `${dest}.destdir`;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.rmSync(destdir, { recursive: true, force: true });
  const start = Date.now();
  common.run("cmake", ["--build", build, "--target", target], { env: { ...process.env, DESTDIR: destdir } });
  fs.renameSync(path.join(destdir, "xclang"), dest);
  fs.rmSync(destdir, { recursive: true, force: true });
  console.log(`${target}: ${Math.round((Date.now() - start) / 60000)} min`);
}

/// On Windows every alias (a symlink in the install tree) becomes a copy of
/// windows/alias.c, which starts the program it stands for; clang-23 gives
/// way to clang itself.
function windowsAliases(dir: string): void {
  const bin = path.join(dir, "bin");
  const stem = (file: string) => path.basename(file, ".exe");
  const versioned = path.join(bin, `clang-${common.LLVM_MAJOR}.exe`);
  if (fs.lstatSync(path.join(bin, "clang.exe")).isSymbolicLink() && fs.existsSync(versioned)) {
    fs.rmSync(path.join(bin, "clang.exe"));
    fs.renameSync(versioned, path.join(bin, "clang.exe"));
    fs.symlinkSync("clang.exe", versioned);
  }
  const aliases: [string, string][] = [];
  for (const file of fs.readdirSync(bin)) {
    const full = path.join(bin, file);
    if (!fs.lstatSync(full).isSymbolicLink()) continue;
    const real = fs.existsSync(full) ? stem(fs.realpathSync(full)) : undefined;
    aliases.push([stem(file), real === stem(versioned) ? "clang" : real ?? ""]);
  }
  const broken = aliases.filter(([, real]) => !real);
  if (broken.length) common.fail(`dangling aliases: ${broken.map(([a]) => a).join(", ")}`);
  const work = path.join(common.WORK, "build", `alias-${host.triple}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "aliases.h"),
    "static const wchar_t *const ALIASES[][2] = {\n" +
    aliases.map(([a, r]) => `  {L"${a}", L"${r}"},\n`).join("") + "};\n");
  const exe = path.join(work, "alias.exe");
  common.run(path.join(stage, "bin", "clang"), [
    `--target=${host.triple}`, "-Os", "-municode", "-s", `-I${work}`,
    path.join(common.ROOT, "windows", "alias.c"), "-o", exe,
  ]);
  for (const [alias] of aliases) {
    fs.rmSync(path.join(bin, `${alias}.exe`));
    fs.copyFileSync(exe, path.join(bin, `${alias}.exe`));
  }
  console.log(`${aliases.length} aliases: ${aliases.map(([a, r]) => `${a} -> ${r}`).join(", ")}`);
}

const out = path.join(common.WORK, "out");
if (mode !== "asan") install("install-toolchain-distribution-stripped", path.join(out, `toolchain-${name}`));
if (host.os === "mingw" && mode !== "asan") windowsAliases(path.join(out, `toolchain-${name}`));
if (mode !== "instrumented") {
  const dest = path.join(out, `libclang-${name}`);
  install("install-development-distribution", dest);
  /// The compression libraries the LLVM libraries link, with their
  /// headers and zstd's CMake package: a consumer finds them with the
  /// libclang directory in CMAKE_PREFIX_PATH.
  common.copyTree(compressionLibs.prefix, dest);
  /// clice reaches into Sema's private headers.
  const sema = path.join(dest, "include", "clang", "Sema");
  fs.mkdirSync(sema, { recursive: true });
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
