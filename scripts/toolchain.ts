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
  const build = async (name: "zlib" | "zstd", subdir: string, extra: string[], target = "install") => {
    const source = path.join(common.WORK, "src", name);
    if (!fs.existsSync(source)) common.extract(await common.fetchSource(name), source);
    const dir = path.join(work, name);
    common.run("cmake", [
      "-G", "Ninja", "-S", path.join(source, subdir), "-B", dir,
      ...common.cmakeToolchainArgs(stage, host),
      "-DCMAKE_BUILD_TYPE=Release", `-DCMAKE_INSTALL_PREFIX=${prefix}`,
      "-DCMAKE_POSITION_INDEPENDENT_CODE=ON", ...extra,
    ]);
    common.run("cmake", ["--build", dir, "--target", target]);
    /// Static only: whatever shared library the install put in goes.
    const manifest = path.join(dir, "install_manifest.txt");
    for (const file of fs.existsSync(manifest) ? fs.readFileSync(manifest, "utf8").split("\n") : []) {
      if (/\.(so(\.\d+)*|dll|dll\.a|dylib)$/.test(file)) fs.rmSync(file, { force: true });
    }
    return { source, dir };
  };
  const args: string[] = [];
  const lib = path.join(prefix, "lib");
  const include = path.join(prefix, "include");
  if (host.os !== "darwin") {
    /// zlib's install wants its DLL too, whose resource script it gives to
    /// windres without --target; only the static library is built, and
    /// put in by hand (zlibstatic is its name on Windows).
    const zlib = await build("zlib", ".", ["-DZLIB_BUILD_EXAMPLES=OFF"], "zlibstatic");
    fs.mkdirSync(lib, { recursive: true });
    fs.mkdirSync(include, { recursive: true });
    fs.copyFileSync(path.join(zlib.source, "zlib.h"), path.join(include, "zlib.h"));
    fs.copyFileSync(path.join(zlib.dir, "zconf.h"), path.join(include, "zconf.h"));
    const archive = ["libz.a", "libzlibstatic.a"].map((f) => path.join(zlib.dir, f)).find((f) => fs.existsSync(f));
    if (!archive) common.fail(`no static zlib in ${zlib.dir}`);
    fs.copyFileSync(archive, path.join(lib, "libz.a"));
    args.push(`-DZLIB_INCLUDE_DIR=${include}`, `-DZLIB_LIBRARY=${path.join(lib, "libz.a")}`);
  }
  await build("zstd", path.join("build", "cmake"), [
    "-DZSTD_BUILD_SHARED=OFF", "-DZSTD_BUILD_STATIC=ON", "-DZSTD_BUILD_PROGRAMS=OFF", "-DZSTD_BUILD_TESTS=OFF",
  ]);
  /// LLVM finds zstd with its own Findzstd.cmake, which reads these.
  const zstd = fs.readdirSync(lib).find((f) => /^libzstd.*\.a$/.test(f));
  if (!zstd) common.fail(`no static zstd in ${lib}`);
  const zstdLib = path.join(lib, zstd);
  args.push(`-Dzstd_INCLUDE_DIR=${include}`, `-Dzstd_LIBRARY=${zstdLib}`, `-Dzstd_STATIC_LIBRARY=${zstdLib}`);
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
/// Find the SDK the way Apple's clang does, with no -isysroot or SDKROOT.
if (host.os === "darwin") args.push("-DCLANG_USE_XCSELECT=ON");
/// Past LLVM's own -ffunction-sections and --gc-sections, as clice links:
/// lld folds identical functions whose address nothing compares, and
/// merges string tails. (The macOS linker deduplicates on its own.)
if (mode === "release" && host.os !== "darwin") args.push("-DCMAKE_EXE_LINKER_FLAGS=-Wl,--icf=safe -Wl,-O2");
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

/// On Windows every name of llvm.exe (a symlink in the install tree)
/// becomes a copy of windows/alias.c, which starts it.
function windowsAliases(dir: string): void {
  const bin = path.join(dir, "bin");
  const links = fs.readdirSync(bin).filter((f) => fs.lstatSync(path.join(bin, f)).isSymbolicLink());
  const strays = links.filter((f) => !fs.existsSync(path.join(bin, f)) || path.basename(fs.realpathSync(path.join(bin, f))) !== "llvm.exe");
  if (strays.length) common.fail(`links to something other than llvm.exe: ${strays.join(", ")}`);
  const exe = path.join(common.WORK, "build", `alias-${host.triple}`, "alias.exe");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  common.run(path.join(stage, "bin", "clang"), [
    `--target=${host.triple}`, "-Os", "-municode", "-s", path.join(common.ROOT, "windows", "alias.c"), "-o", exe,
  ]);
  for (const link of links) {
    fs.rmSync(path.join(bin, link));
    fs.copyFileSync(exe, path.join(bin, link));
  }
  console.log(`${links.length} aliases of llvm.exe: ${links.map((f) => path.basename(f, ".exe")).join(", ")}`);
}

const out = path.join(common.WORK, "out");
if (mode !== "asan") install("install-toolchain-distribution-stripped", path.join(out, `toolchain-${name}`));
if (host.os === "mingw" && mode !== "asan") windowsAliases(path.join(out, `toolchain-${name}`));
/// The option tables of clang, lld, llvm-lib and llvm-dlltool, TableGen's
/// output in this build, for tools that parse those command lines without
/// linking LLVM (catter). Named as in the llvm-option-inc package they
/// replace; clang's has since moved from Driver/ to Options/.
const OPTION_TABLES: Record<string, [string, string]> = {
  "clang-Driver-Options.inc": ["ClangDriverOptions", "tools/clang/include/clang/Options/Options.inc"],
  "lld-ELF-Options.inc": ["ELFOptionsTableGen", "tools/lld/ELF/Options.inc"],
  "lld-COFF-Options.inc": ["COFFOptionsTableGen", "tools/lld/COFF/Options.inc"],
  "lld-MachO-Options.inc": ["MachOOptionsTableGen", "tools/lld/MachO/Options.inc"],
  "lld-MinGW-Options.inc": ["MinGWOptionsTableGen", "tools/lld/MinGW/Options.inc"],
  "lld-wasm-Options.inc": ["WasmOptionsTableGen", "tools/lld/wasm/Options.inc"],
  "llvm-lib-Options.inc": ["LibOptionsTableGen", "lib/ToolDrivers/llvm-lib/Options.inc"],
  "llvm-dlltool-Options.inc": ["DllOptionsTableGen", "lib/ToolDrivers/llvm-dlltool/Options.inc"],
};

if (mode !== "instrumented") {
  const dest = path.join(out, `libclang-${name}`);
  install("install-development-distribution", dest);
  if (mode === "release") {
    const tables = Object.values(OPTION_TABLES);
    common.run("cmake", ["--build", build, "--target", ...tables.map(([target]) => target)]);
    const dir = path.join(dest, "include", "llvm-options-td");
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, [, generated]] of Object.entries(OPTION_TABLES)) {
      fs.copyFileSync(path.join(build, ...generated.split("/")), path.join(dir, file));
    }
  }
  /// The compression libraries the LLVM libraries link, with their
  /// headers: LLVMConfig.cmake looks for them (FindZLIB, LLVM's
  /// Findzstd), and finds them with the libclang directory in
  /// CMAKE_PREFIX_PATH.
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
