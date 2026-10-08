/// Build the runtimes of one target (or of both macOS targets at once:
/// --target darwin; of both MSVC targets: --target msvc) with the
/// bootstrap compiler, into work/out/runtimes-<name>:
///
///   <triple>/                  sysroot, libunwind, libc++abi, libc++ (and
///                              where there are sanitizers its ASan build)
///   libc++/, mingw-w64/        the headers targets share: libc++'s, with
///                              the target's __config_site in
///                              libc++/include/<target>/c++/v1, and
///                              mingw-w64's (common.shareHeaders)
///   lib/clang/<ver>/lib/...    compiler-rt: builtins, crt objects, profile;
///                              the MSVC targets' libc++ (msvcCxx)
///
/// The MSVC targets' C runtime is Microsoft's, from the user's SDK, and so
/// is vcruntime, their C++ ABI library. Their libc++ (msvcCxx) and
/// compiler-rt are built against the SDK that work/sdk/windows names,
/// fetched by xclang's own command (`xclang sdk fetch windows
/// --accept-license --sdk-dir work/sdk`); none of it is in what is
/// collected. Their <triple>/ holds libc++'s modules, and for x64 the
/// __config_site of its ASan build.
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
if (!fs.existsSync(path.join(bootstrap, "bin", "clang"))) common.fail("run toolchain/bootstrap.ts first");
const src = await common.llvmSource();
const caches = path.join(import.meta.dirname, "cmake", "caches");

/// The builtins and the C++ runtimes are built without the config files,
/// which link the very libraries being built; CMAKE_SYSROOT
/// (toolchain/cmake/toolchain.cmake) still names the sysroot. The builtins
/// come first and nothing can be linked yet, so their checks only compile;
/// the C++ runtimes' checks link against the C runtime and the builtins.
/// Then the headers move to where the config files look for them
/// (common.shareHeaders), and the rest of compiler-rt comes last, built
/// with the config files.
const NO_CONFIG = ["C", "CXX", "ASM"].map((lang) => `-DCMAKE_${lang}_FLAGS=--no-default-config`);

function cmake(name: string, source: string, args: string[]): void {
  const build = path.join(common.WORK, "build", name);
  fs.rmSync(build, { recursive: true, force: true });
  common.run("cmake", ["-G", "Ninja", "-S", source, "-B", build, ...args]);
  common.run("cmake", ["--build", build, "--target", "install"]);
}

/// Where the sanitizers and libFuzzer are built
/// (toolchain/cmake/caches/compiler-rt.cmake).
const SANITIZERS = ["linux", "darwin"];

/// The sanitizer runtimes of Linux carry xclang's libc++abi as their C++ ABI.
const LINUX_SANITIZERS = [
  "-DSANITIZER_CXX_ABI=libc++",
  "-DSANITIZER_USE_STATIC_CXX_ABI=ON",
  "-DCOMPILER_RT_USE_BUILTINS_LIBRARY=ON",
];

/// What compiler-rt has for musl's static programs: UBSan, its standalone
/// runtime (which comes with any sanitizer) and its minimal one. The other
/// sanitizers find the functions they intercept with dlsym, which a static
/// program has not: ASan's, TSan's and LSan's runtimes do not link without
/// a dynamic section (_DYNAMIC), and libFuzzer stops at its first
/// sigaction, whose real one UBSan's interceptor does not find.
const MUSL_SANITIZERS = [
  "-DCOMPILER_RT_BUILD_SANITIZERS=ON",
  "-DCOMPILER_RT_SANITIZERS_TO_BUILD=ubsan_minimal",
  "-DCOMPILER_RT_BUILD_LIBFUZZER=OFF",
  ...LINUX_SANITIZERS,
];

/// compiler-rt names its directory after the compiler's target, so that
/// is the spelling clang's driver looks for: the normalized one.
function compilerRtTarget(stage: string, t: common.Target): string[] {
  return [...common.cmakeToolchainArgs(stage, t), `-DXCLANG_COMPILER_TARGET=${common.normalized(t)}`];
}

function builtins(t: common.Target, stage: string): void {
  cmake(`builtins-${t.triple}`, path.join(src, "compiler-rt", "lib", "builtins"), [
    ...compilerRtTarget(stage, t),
    "-C", path.join(caches, "builtins.cmake"),
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    `-DCOMPILER_RT_BUILD_CRT=${common.linuxSysroot(t) ? "ON" : "OFF"}`,
    ...NO_CONFIG,
  ]);
}

/// Linux keeps the usual sysroot layout (usr/include, usr/lib), where
/// clang's Linux driver looks; mingw and macOS use the top of the target
/// directory, as the mingw driver and the config files expect.
function cxxPrefix(t: common.Target, stage: string): string {
  return common.linuxSysroot(t) ? path.join(stage, t.triple, "usr") : path.join(stage, t.triple);
}

function cxxArgs(t: common.Target, stage: string, prefix: string): string[] {
  const darwin = t.os === "darwin";
  return [
    ...common.cmakeToolchainArgs(stage, t),
    "-C", path.join(caches, "cxx.cmake"),
    `-DLLVM_ENABLE_RUNTIMES=${darwin ? "libcxxabi;libcxx" : "libunwind;libcxxabi;libcxx"}`,
    /// macOS unwinds with the system's libunwind, part of libSystem.
    `-DLIBCXXABI_USE_LLVM_UNWINDER=${darwin ? "OFF" : "ON"}`,
    /// glibc 2.17 predates __cxa_thread_atexit_impl, the floor xclang holds
    /// to; libc++abi then refers to it weakly and uses it where the C
    /// library has it.
    ...(t.os === "linux" ? ["-DLIBCXXABI_HAS_CXA_THREAD_ATEXIT_IMPL=OFF"] : []),
    /// libc++ for musl, whose locale functions differ from glibc's.
    ...(t.os === "musl" ? ["-DLIBCXX_HAS_MUSL_LIBC=ON"] : []),
    `-DLLVM_DEFAULT_TARGET_TRIPLE=${common.normalized(t)}`,
    `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    /// The checks' programs link the C runtime and compiler-rt, and no C++
    /// library or unwinder: those are what is being built. musl's link
    /// statically, as its programs do.
    `-DCMAKE_EXE_LINKER_FLAGS=${darwin ? "-nostdlib++" : `--rtlib=compiler-rt --unwindlib=none -nostdlib++${t.os === "musl" ? " -static" : ""}`}`,
    ...NO_CONFIG,
  ];
}

function cxx(t: common.Target, stage: string): void {
  const prefix = cxxPrefix(t, stage);
  cmake(`cxx-${t.triple}`, path.join(src, "runtimes"), cxxArgs(t, stage, prefix));
  /// GCC's runtime libraries, which build scripts written for GCC name
  /// (-latomic, -lgcc_s, and on Windows -lssp, which clang's MinGW driver
  /// adds for -fstack-protector), are empty archives: what they hold comes
  /// from compiler-rt (atomics too: toolchain/cmake/caches/builtins.cmake),
  /// libunwind and, for the stack protector, mingw-w64's libmingwex.
  const stubs = { linux: GCC_STUBS, musl: GCC_STUBS, mingw: [...GCC_STUBS, "ssp", "ssp_nonshared"], darwin: [], msvc: [] }[t.os];
  for (const name of stubs) fs.writeFileSync(path.join(prefix, "lib", `lib${name}.a`), "!<arch>\n");
}

/// libc++'s ASan build, for the targets with sanitizers, in
/// <prefix>/lib/asan: its libc++.a (libc++abi in it), instrumented like
/// the ASan programs that link it, and its include/__config_site, which
/// turns on std::string's container checks. An ASan build takes both:
/// -isystem <prefix>/lib/asan/include, -nostdlib++ <prefix>/lib/asan/libc++.a.
/// Built after compiler-rt, whose ASan runtime its checks link.
function cxxAsan(t: common.Target, stage: string): void {
  const install = path.join(common.WORK, "build", `cxx-asan-${t.triple}-install`);
  fs.rmSync(install, { recursive: true, force: true });
  /// On macOS the libraries look for the ASan runtime next to the builtins,
  /// which clang does not report there (-print-libgcc-file-name).
  const builtins = path.join(common.resourceDir(stage), "lib", "darwin", "libclang_rt.osx.a");
  cmake(`cxx-asan-${t.triple}`, path.join(src, "runtimes"), [
    ...cxxArgs(t, stage, install),
    "-DLLVM_USE_SANITIZER=Address",
    ...(t.os === "darwin" ? [`-DCOMPILER_RT_LIBRARY_builtins_${t.triple}=${builtins}`] : []),
  ]);
  const dest = path.join(cxxPrefix(t, stage), "lib", "asan");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, "include"), { recursive: true });
  /// libc++.a holds libc++abi already; libc++experimental.a is for
  /// -fexperimental-library.
  for (const lib of ["libc++.a", "libc++experimental.a"]) {
    fs.copyFileSync(path.join(install, "lib", lib), path.join(dest, lib));
  }
  /// Its __config_site differs from the other only in saying so.
  const plain = fs.readFileSync(path.join(common.libcxxTargetDir(stage, t), "__config_site"), "utf8");
  const asan = fs.readFileSync(path.join(install, "include", "c++", "v1", "__config_site"), "utf8");
  const flag = "#define _LIBCPP_INSTRUMENTED_WITH_ASAN";
  if (asan !== plain.replace(`${flag} 0`, `${flag} 1`) || asan === plain) {
    common.fail(`the ASan build's __config_site of ${t.triple} differs from the other in more than ${flag}`);
  }
  fs.writeFileSync(path.join(dest, "include", "__config_site"), asan);
  fs.rmSync(install, { recursive: true, force: true });
}

const GCC_STUBS = ["atomic", "gcc", "gcc_eh", "gcc_s"];

function profile(t: common.Target, stage: string): void {
  cmake(`compiler-rt-${t.triple}`, path.join(src, "runtimes"), [
    ...compilerRtTarget(stage, t),
    "-C", path.join(caches, "compiler-rt.cmake"),
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    `-DCOMPILER_RT_BUILD_SANITIZERS=${SANITIZERS.includes(t.os) ? "ON" : "OFF"}`,
    `-DCOMPILER_RT_BUILD_LIBFUZZER=${SANITIZERS.includes(t.os) ? "ON" : "OFF"}`,
    ...(t.os === "linux" ? LINUX_SANITIZERS : []),
    ...(t.os === "musl" ? MUSL_SANITIZERS : []),
  ]);
  /// What a static program cannot use: the shared runtimes, and LSan's,
  /// which comes with any sanitizer.
  if (t.os === "musl") {
    const dir = path.join(common.resourceDir(stage), "lib", common.normalized(t));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".so") || f.startsWith("libclang_rt.lsan."))) {
      fs.rmSync(path.join(dir, file));
    }
  }
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
    "-DCOMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=OFF",
    "-DCOMPILER_RT_BUILD_SANITIZERS=ON",
    "-DCOMPILER_RT_BUILD_LIBFUZZER=ON",
    "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=OFF",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
    ...["IOS", "WATCHOS", "TVOS", "XROS"].map((p) => `-DCOMPILER_RT_ENABLE_${p}=OFF`),
    "-DDARWIN_osx_ARCHS=arm64;x86_64",
    "-DDARWIN_osx_BUILTIN_ARCHS=arm64;x86_64",
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    ...NO_CONFIG,
  ]);
}

/// compiler-rt for the MSVC targets, with clang-cl and lld-link
/// (toolchain/cmake/toolchain.cmake) against the SDK, in the layout
/// lld-link searches by itself,
/// lib/clang/<ver>/lib/windows/clang_rt.<name>-<arch>.lib: the config files
/// name the builtins in every object (toolchain/config/msvc.cfg), so they
/// are found also when lld-link links on its own. Without the config
/// files, whose hybrid CRT would otherwise be in every object of these
/// libraries too. The builtins (/Zl) name no C runtime; the rest is built
/// as compiler-rt builds it for Windows: the profile runtime /MT, ASan's
/// DLL /MD.
function compilerRtMsvc(t: common.Target, stage: string): void {
  const sdk = path.join(stage, "sdk", "windows");
  const flags = ["C", "CXX", "ASM"].map((lang) => `-DCMAKE_${lang}_FLAGS=--no-default-config /winsysroot ${sdk}`);
  const args = [
    ...compilerRtTarget(stage, t),
    `-DCOMPILER_RT_INSTALL_PATH=${common.resourceDir(stage)}`,
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
    ...flags,
  ];
  cmake(`builtins-${t.triple}`, path.join(src, "compiler-rt", "lib", "builtins"), [
    "-C", path.join(caches, "builtins.cmake"), ...args, "-DCOMPILER_RT_BUILD_CRT=OFF",
  ]);
  /// What compiler-rt has for Windows: UBSan, and for x64 only
  /// AddressSanitizer and libFuzzer.
  cmake(`compiler-rt-${t.triple}`, path.join(src, "runtimes"), [
    "-C", path.join(caches, "compiler-rt.cmake"), ...args,
    "-DCOMPILER_RT_BUILD_SANITIZERS=ON",
    "-DCOMPILER_RT_BUILD_LIBFUZZER=ON",
  ]);
}

/// libc++ of an MSVC target, with clang-cl against the SDK
/// (toolchain/cmake/caches/cxx-msvc.cmake), laid out as the config files
/// and lld-link look for it:
///
///   lib/clang/<ver>/lib/windows/libc++-<arch>.lib
///   lib/clang/<ver>/lib/windows/libc++experimental-<arch>.lib
///                         next to compiler-rt, in the one directory lld-link
///                         searches by itself: the config files cannot give
///                         clang-cl's links, or lld-link's own, another
///                         (clang-cl ignores -L), and both architectures
///                         share it, so their names say the architecture
///   <triple>/include/c++/v1
///                         the headers, shared with the other targets but
///                         for __config_site (common.shareHeaders), which
///                         names the library in every object that includes
///                         libc++ (msvcConfigSite)
///   <triple>/lib/libc++.modules.json, <triple>/share/libc++/v1
///                         the std and std.compat modules
function msvcCxx(t: common.Target, stage: string): void {
  const install = msvcCxxBuild(t, stage, []);
  const windows = path.join(common.resourceDir(stage), "lib", "windows");
  const libs = path.join(install, "lib");
  for (const name of ["libc++", "libc++experimental"]) {
    if (!fs.existsSync(path.join(libs, `${name}.lib`))) common.fail(`no ${name}.lib of ${t.triple} in ${libs}: ${fs.readdirSync(libs).join(", ")}`);
    fs.renameSync(path.join(libs, `${name}.lib`), path.join(windows, `${name}-${t.arch}.lib`));
  }
  const prefix = path.join(stage, t.triple);
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(path.join(prefix, "lib"), { recursive: true });
  fs.renameSync(path.join(libs, "libc++.modules.json"), path.join(prefix, "lib", "libc++.modules.json"));
  fs.renameSync(path.join(install, "share"), path.join(prefix, "share"));
  fs.renameSync(path.join(install, "include"), path.join(prefix, "include"));
  const site = path.join(prefix, "include", "c++", "v1", "__config_site");
  fs.writeFileSync(site, msvcConfigSite(fs.readFileSync(site, "utf8"), t, `libc++-${t.arch}.lib`));
  fs.rmSync(install, { recursive: true, force: true });
}

/// Build libc++ of an MSVC target into a directory of its own, and return it.
function msvcCxxBuild(t: common.Target, stage: string, args: string[]): string {
  const sdk = path.join(stage, "sdk", "windows");
  const name = `cxx${args.length ? "-asan" : ""}-${t.triple}`;
  const install = path.join(common.WORK, "build", `${name}-install`);
  fs.rmSync(install, { recursive: true, force: true });
  cmake(name, path.join(src, "runtimes"), [
    ...common.cmakeToolchainArgs(stage, t),
    "-C", path.join(caches, "cxx-msvc.cmake"),
    `-DLLVM_DEFAULT_TARGET_TRIPLE=${t.triple}`,
    `-DCMAKE_INSTALL_PREFIX=${install}`,
    ...["C", "CXX"].map((lang) => `-DCMAKE_${lang}_FLAGS=--no-default-config /winsysroot ${sdk}`),
    ...args,
  ]);
  return install;
}

/// libc++'s ASan build for x64, the MSVC target with ASan, as cxxAsan
/// builds it for the others: lib/clang/<ver>/lib/windows/libc++asan-x86_64.lib,
/// and <triple>/lib/asan/include/__config_site, which names it instead of
/// libc++-x86_64.lib. An ASan build takes -isystem <triple>/lib/asan/include;
/// its objects then link the ASan libc++ by themselves. It names no ASan
/// runtime either: the link of the program does, for its C runtime.
function msvcCxxAsan(t: common.Target, stage: string): void {
  const install = msvcCxxBuild(t, stage, ["-DLLVM_USE_SANITIZER=Address"]);
  fs.renameSync(path.join(install, "lib", "libc++.lib"), path.join(common.resourceDir(stage), "lib", "windows", `libc++asan-${t.arch}.lib`));
  const plain = fs.readFileSync(path.join(common.libcxxTargetDir(stage, t), "__config_site"), "utf8");
  const asan = msvcConfigSite(fs.readFileSync(path.join(install, "include", "c++", "v1", "__config_site"), "utf8"), t,
    `libc++asan-${t.arch}.lib`);
  const flag = "#define _LIBCPP_INSTRUMENTED_WITH_ASAN";
  if (asan.replace(`libc++asan-${t.arch}.lib`, `libc++-${t.arch}.lib`) !== plain.replace(`${flag} 0`, `${flag} 1`) || asan === plain) {
    common.fail(`the ASan build's __config_site of ${t.triple} differs from the other in more than ${flag} and its library`);
  }
  const dest = path.join(stage, t.triple, "lib", "asan", "include");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "__config_site"), asan);
  fs.rmSync(install, { recursive: true, force: true });
}

/// The __config_site of an MSVC target names its libraries, as libc++'s
/// own auto-linking does (__config), by their names in
/// lib/clang/<ver>/lib/windows: every object that includes libc++ links it,
/// whatever links it, and objects that do not, C or with Microsoft's STL,
/// do not.
function msvcConfigSite(text: string, t: common.Target, library: string): string {
  const end = "#endif // _LIBCPP___CONFIG_SITE";
  if (!text.trimEnd().endsWith(end)) common.fail(`the __config_site of ${t.triple} does not end with ${end}`);
  const block = [
    "// xclang: the static libc++ of this target, named by its architecture in",
    "// lib/clang/<version>/lib/windows, which lld-link searches by itself;",
    "// libc++'s own auto-linking would name libc++.lib.",
    "#define _LIBCPP_NO_AUTO_LINK",
    `#pragma comment(lib, "${library}")`,
    "#if __has_feature(experimental_library)",
    `#  pragma comment(lib, "libc++experimental-${t.arch}.lib")`,
    "#endif",
    "",
  ].join("\n");
  const at = text.lastIndexOf(end);
  return text.slice(0, at) + block + "\n" + text.slice(at);
}

/// Link (and, when it is this machine's own, run) a C++ program for the
/// target with the finished tree: the config file, sysroot and runtimes
/// together. x86_64 macOS programs are not run on arm64 through Rosetta;
/// tests/toolchain/smoke.ts runs them on an x86_64 Mac.
function check(t: common.Target, stage: string): void {
  const dir = path.join(common.WORK, "build", `check-${t.triple}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "hello.cpp");
  fs.writeFileSync(source, [
    "#include <cstdio>",
    "#include <stdexcept>",
    "#ifndef _LIBCPP_VERSION",
    "#error not libc++",
    "#endif",
    "#include <string>",
    "#include <vector>",
    "int main() {",
    "  std::vector<std::string> words{\"hello\", \"from\", \"xclang\"};",
    "  try { throw std::runtime_error(words[0] + \" \" + words[2]); }",
    "  catch (const std::exception& e) { std::puts(e.what()); }",
    "}",
    "",
  ].join("\n"));
  const exe = path.join(dir, `hello${t.os === "mingw" || t.os === "msvc" ? ".exe" : ""}`);
  common.run(path.join(stage, "bin", "clang++"), [`--target=${t.triple}`, "-O2", source, "-o", exe]);
  if (common.runsHere(t)) common.run(exe, []);
  const tool = t.os === "darwin" ? ["llvm-otool", "-L"] : ["llvm-readobj", "--needed-libs"];
  common.run(path.join(stage, "bin", tool[0]), [tool[1], exe]);
  /// musl's static programs with UBSan, its standalone runtime.
  if (t.os === "musl") {
    const ubsanExe = path.join(dir, "hello-ubsan");
    common.run(path.join(stage, "bin", "clang++"), [`--target=${t.triple}`, "-O1", "-fsanitize=undefined", source, "-o", ubsanExe]);
    if (common.runsHere(t)) common.run(ubsanExe, []);
  }
  /// The same with ASan and libc++'s ASan build (cxxAsan), run natively.
  if (!SANITIZERS.includes(t.os)) return;
  const asan = path.join(cxxPrefix(t, stage), "lib", "asan");
  const asanExe = path.join(dir, "hello-asan");
  common.run(path.join(stage, "bin", "clang++"), [
    `--target=${t.triple}`, "-O1", "-fsanitize=address", "-isystem", path.join(asan, "include"),
    "-nostdlib++", path.join(asan, "libc++.a"), source, "-o", asanExe,
  ]);
  if (common.runsHere(t)) common.run(asanExe, []);
}

/// compiler-rt's headers, which its builds install into the resource
/// directory next to clang's own: <sanitizer/asan_interface.h>,
/// <fuzzer/FuzzedDataProvider.h>, ...
const COMPILER_RT_HEADERS = ["sanitizer", "fuzzer", "profile", "xray", "orc"];

function collect(stage: string, name: string, dirs: string[]): void {
  const out = path.join(common.WORK, "out", `runtimes-${name}`);
  fs.rmSync(out, { recursive: true, force: true });
  const headers = COMPILER_RT_HEADERS.map((d) => path.join(resource, "include", d));
  for (const dir of [...dirs, ...headers.filter((d) => fs.existsSync(path.join(stage, d)))]) {
    common.copyTree(path.join(stage, dir), path.join(out, dir));
  }
  console.log(`runtimes in ${out}`);
  const listing = spawnSync("du", ["-sh", ...dirs], { cwd: out, encoding: "utf8" });
  console.log(listing.stdout);
}

const stage = common.makeTree(path.join(common.WORK, "stage", `runtimes-${values.target}`), bootstrap);
const resource = path.relative(stage, common.resourceDir(stage));
/// The bootstrap's compiler-rt headers go: the ones collected are those
/// the builds here install.
for (const d of COMPILER_RT_HEADERS) fs.rmSync(path.join(stage, resource, "include", d), { recursive: true, force: true });

if (values.target === "msvc") {
  const sdk = path.join(common.WORK, "sdk");
  if (!fs.existsSync(path.join(sdk, "windows", ".xclang-sdk.json"))) {
    common.fail(`no Windows SDK in ${sdk}/windows: xclang sdk fetch windows --accept-license --sdk-dir ${sdk}`);
  }
  /// Where the tree's config files look for it.
  fs.symlinkSync(sdk, path.join(stage, "sdk"));
  for (const t of common.MSVC_TARGETS) compilerRtMsvc(t, stage);
  for (const t of common.MSVC_TARGETS) msvcCxx(t, stage);
  common.shareHeaders(stage);
  msvcCxxAsan(common.target("x86_64-pc-windows-msvc"), stage);
  /// The config files again, now with libc++ (common.writeConfigs).
  common.writeConfigs(stage, common.machineTarget().os);
  for (const t of common.MSVC_TARGETS) check(t, stage);
  collect(stage, "msvc", [...common.MSVC_TARGETS.map((t) => t.triple), "libc++", path.join(resource, "lib", "windows")]);
} else if (values.target === "darwin") {
  if (common.machine() !== "macos") common.fail("the macOS runtimes are built on macOS");
  process.env.SDKROOT ??= spawnSync("xcrun", ["--show-sdk-path"], { encoding: "utf8" }).stdout.trim();
  /// Apple's ld, which links the sanitizers' dylibs, writes the times of
  /// their objects into the debug map (and so into the UUID) unless this
  /// says not to: a rebuild is then the same bytes.
  process.env.ZERO_AR_DATE = "1";
  const targets = common.TARGETS.filter((t) => t.os === "darwin");
  for (const t of targets) {
    await buildSysroot(t, stage);
    cxx(t, stage);
  }
  common.shareHeaders(stage);
  compilerRtDarwin(stage);
  for (const t of targets) cxxAsan(t, stage);
  for (const t of targets) check(t, stage);
  collect(stage, "darwin", [...targets.map((t) => t.triple), "libc++", path.join(resource, "lib", "darwin")]);
} else {
  const t = common.target(values.target);
  if (common.buildMachine(t) !== common.machine()) common.fail(`${t.triple} is built on ${common.buildMachine(t)}`);
  await buildSysroot(t, stage);
  builtins(t, stage);
  cxx(t, stage);
  common.shareHeaders(stage);
  profile(t, stage);
  if (SANITIZERS.includes(t.os)) cxxAsan(t, stage);
  check(t, stage);
  collect(stage, t.triple, [t.triple, "libc++", ...(t.os === "mingw" ? ["mingw-w64"] : []),
    path.join(resource, "lib", common.normalized(t))]);
}
