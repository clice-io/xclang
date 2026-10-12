/// The CMake package (packages/cmake) as a consumer uses it, with a host's
/// archives unpacked: tests/cmake built and its tests run, with the cmake
/// and ninja in PATH.
///
///   node tests/cmake/cmake.ts --tree <xclang> --sums <SHA256SUMS>
///     [--libclang <libclang>] [--url <archives> [--git <ref>] [--cache <dir>]] [--programs <dir>]
///
/// 1. xclang's bin/ in PATH, as pixi has it, and CMAKE_CXX_COMPILER=clang++:
///    find_package(xclang) by PATH. With --libclang, tests/libclang too,
///    on find_package(Clang). On macOS, Apple's atos reads the dSYM that
///    xclang_debug_symbols made of a DWARF 5 program.
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
///    objects, the compiler's name in .comment aside. Once through this
///    checkout's toolchain file, with XCLANG_ROOT. Linux x64 adds
///    MemorySanitizer, ThreadSanitizer and libc++ with ThinLTO; Linux x64
///    and arm64 macOS, AddressSanitizer. With --programs <dir>, the
///    hardening variant for other targets too (from Linux x64: Linux arm64
///    and both MinGW targets; from arm64 macOS: x86_64 macOS), whose
///    programs tests/lib/on-target.ts runs on machines of those targets.
/// 6. The platform's C++ library (XCLANG_STDLIB=platform), with a compiler
///    that selects bin/<triple>-system.cfg for it (patches/0018, 23.1.2.11
///    and later): tests/cmake/platform for this host's target, with a
///    CMAKE_CXX_FLAGS of its own, with GCC's libstdc++ on Linux (where the
///    host has it) and the SDK's libc++ on macOS (its headers' version, not
///    the toolchain's, and /usr/lib/libc++.1.dylib loaded), run; a musl
///    target without CMAKE_SYSROOT is refused. (Windows: tests/sdk/msvc.ts,
///    with Microsoft's STL.)
/// 7. The build's sanitizers (XCLANG_SANITIZER) with the prebuilt runtimes:
///    tests/cmake/runtimes for this host's target, reporting what each
///    finds, on Linux and macOS (ASan with the ASan libc++, UBSan, TSan,
///    LSan), and UBSan for a Linux host's musl target. MemorySanitizer is
///    refused without the runtimes from source, and for the targets that
///    have none.
/// 8. tests/cmake/policies, a project of CMake 3.2's policies (on CMake 4,
///    which refuses those, 3.5's), through the toolchain file, which keeps
///    its own; its build directory configured again for another target is
///    refused.
///
/// A tree whose lib/cmake/xclang is not the checkout's (releases before the
/// package, or before a change of it) gets the checkout's; with --url a
/// directory, a run's archives (tests/lib/archives.ts --dist), not the
/// checkout's package fails: the archive carries it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { programsDir, writePrograms, type Program } from "../lib/on-target.ts";
import { since } from "../lib/version.ts";

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
/// A file's text with LF lines: a Windows checkout's are CRLF.
const text = (file: string) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const differ = fs.readdirSync(fresh).filter((f) => !fs.existsSync(path.join(installed, f)) ||
  text(path.join(installed, f)) !== text(path.join(fresh, f)));
if (differ.length) {
  if (values.url && fs.existsSync(values.url)) {
    common.fail(`${installed} is not the checkout's package (${differ.join(", ")}), which a run's archive carries`);
  }
  console.log(`${installed} is not the checkout's package (${differ.join(", ")}): replaced`);
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
  if (run && spawnSync("ctest", ["--test-dir", dir, "--output-on-failure", "--no-tests=error"], { stdio: "inherit", env }).status !== 0) {
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

/// On macOS, Apple's atos reads the dSYM of hello_icf, in DWARF 5: main at
/// its line of icf.cpp, where the line tables of dsymutil's parallel linker
/// crash it (xclang_debug_symbols runs the classic one).
if (native.os === "darwin" && !failures.some((f) => f.startsWith("path:"))) {
  const program = path.join(work, "path", "hello", "hello_icf");
  const address = /^([0-9a-f]+) T _main$/m.exec(spawnSync(path.join(tree, "bin", "llvm-nm"), [program], { encoding: "utf8" }).stdout)?.[1];
  const dwarf = path.join(`${program}.dSYM`, "Contents", "Resources", "DWARF", "hello_icf");
  const atos = address
    ? spawnSync("atos", ["-o", dwarf, "-arch", native.arch === "aarch64" ? "arm64" : "x86_64", `0x${address}`], { encoding: "utf8" })
    : undefined;
  console.log(`atos: ${atos ? `${atos.stdout.trim()} ${atos.stderr.trim()} (${atos.signal ?? atos.status})` : "no main in hello_icf"}`);
  if (!atos || atos.status !== 0 || !/icf\.cpp:\d/.test(atos.stdout)) failures.push("path: atos on hello_icf.dSYM");
}

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
    /// Its booleans in other spellings CMake takes.
    ["abi", ["-DXCLANG_LIBCXX_ABI_NAMESPACE=__xclang",
      "-DXCLANG_LIBCXX_ABI_DEFINES=_LIBCPP_ABI_BOUNDED_ITERATORS;_LIBCPP_ABI_BOUNDED_ITERATORS_IN_STRING",
      "-DXCLANG_RUNTIMES_EXCEPTIONS=off", "-DXCLANG_RUNTIMES_RTTI=NO", "-DCMAKE_CXX_FLAGS=-fno-exceptions -fno-rtti"]],
    /// The toolchain file of this checkout, outside the tree (XCLANG_ROOT),
    /// whose CMake caches are toolchain/cmake/caches.
    ["checkout", [`-DXCLANG_ROOT=${tree}`, "-DXCLANG_LIBCXX_HARDENING=fast"]],
    ...(linuxX64 ? [
      ["msan", ["-DXCLANG_SANITIZER=memory", "-DCMAKE_BUILD_TYPE=RelWithDebInfo"]],
      ["lto", ["-DXCLANG_RUNTIMES_FLAGS=-flto=thin", "-DCMAKE_CXX_FLAGS=-flto=thin"]],
      ["tsan", ["-DXCLANG_SANITIZER=thread"]],
    ] as [string, string[]][] : []),
    /// ASan (and UBSan) through the variant's instrumented libc++, address
    /// named last: its annotations whatever the order.
    ...(linuxX64 || native.triple === "aarch64-apple-darwin"
      ? [["asan", ["-DXCLANG_SANITIZER=undefined,address"]]] as [string, string[]][]
      : []),
  ];
  for (const [variant, args] of variants) {
    const name = `runtimes-${variant}`;
    const file = variant === "checkout" ? path.join(common.ROOT, "packages", "cmake", "toolchain.cmake") : toolchain;
    if (!build(name, [`--toolchain=${file}`, "-DXCLANG_RUNTIMES=source", ...args], process.env, true, project)) continue;
    const installs = fs.readdirSync(path.join(work, name, "xclang-runtimes"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => path.join(work, name, "xclang-runtimes", e.name, "install"));
    if (installs.length !== 1) {
      failures.push(`${name}: ${installs.length} variants in ${path.join(work, name, "xclang-runtimes")}`);
      continue;
    }
    if (variant === "default") failures.push(...samePrebuilt(native, installs[0]!).map((f) => `${name}: ${f}`));
    /// libc++ and libc++abi built without exceptions and RTTI: the CMake
    /// cache of the variant's build says so.
    if (variant === "abi") {
      const cache = fs.readFileSync(path.join(path.dirname(installs[0]!), "runtimes.cmake"), "utf8");
      for (const option of ["LIBCXX_ENABLE_EXCEPTIONS", "LIBCXXABI_ENABLE_EXCEPTIONS", "LIBCXX_ENABLE_RTTI"]) {
        if (!cache.includes(`set(${option} OFF `)) failures.push(`${name}: no ${option} OFF in the variant's CMake cache`);
      }
    }
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

/// 6. The platform's C++ library, with a CMAKE_CXX_FLAGS given, which
/// leaves the toolchain file's -stdlib=platform (an option, not a flag):
/// libstdc++ on Linux; on macOS the SDK's libc++, by its headers, whose
/// version is not the toolchain's LLVM's (<major>xxxx), and its library,
/// the system's.
if (since("23.1.2.11")) {
  const project = path.join(source, "platform");
  const [a, b] = [...version.split(".")[0]!];
  const expect = native.os === "linux" ? "^libstdc\\+\\+ thrown"
    : native.os === "darwin" ? `^libc\\+\\+ ([^${a}][0-9]|${a}[^${b}])[0-9][0-9][0-9][0-9] thrown` : undefined;
  if (expect && (native.os !== "linux" || fs.existsSync("/usr/include/c++")) &&
    build("platform", [`--toolchain=${toolchain}`, "-DXCLANG_STDLIB=platform", "-DCMAKE_CXX_FLAGS=-O1",
      `-DXCLANG_TEST_EXPECT=${expect}`], process.env, true, project) && native.os === "darwin") {
    const dylibs = spawnSync(path.join(tree, "bin", "llvm-objdump"), ["--macho", "--dylibs-used", path.join(work, "platform", "platform")],
      { encoding: "utf8" }).stdout;
    if (!dylibs.includes("/usr/lib/libc++.1.dylib")) failures.push(`platform: loads no /usr/lib/libc++.1.dylib: ${dylibs}`);
  }
  if (native.os === "linux") {
    const args = ["-G", "Ninja", "-S", project, "-B", path.join(work, "platform-musl"), `--toolchain=${toolchain}`,
      `-DXCLANG_TARGET=${native.arch}-unknown-linux-musl`, "-DXCLANG_STDLIB=platform"];
    const result = spawnSync("cmake", args, { encoding: "utf8" });
    if (result.status === 0 || !/CMAKE_SYSROOT/.test(result.stdout + result.stderr)) {
      failures.push(`platform-musl: cmake ${args.join(" ")} was not refused for want of CMAKE_SYSROOT`);
    }
  }
} else {
  console.log(`\n${tree}: a release before the platform's C++ library (23.1.2.11)`);
}

/// 7. The build's sanitizers (XCLANG_SANITIZER) with the prebuilt runtimes:
/// tests/cmake/runtimes for this host's target, whose program reports what
/// each finds, on the Linux and macOS hosts: ASan with the ASan libc++ (its
/// container-overflow) and UBSan, TSan, LSan; UBSan for the musl target of a
/// Linux host's architecture. MemorySanitizer refused, saying why: without
/// the runtimes from source, and on a MinGW, musl or (on macOS) macOS target.
{
  const project = path.join(source, "runtimes");
  if (native.os === "linux" || native.os === "darwin") {
    for (const [name, list] of [["address", "address;undefined"], ["thread", "thread"], ["leak", "leak"]]) {
      build(`sanitizer-${name}`, [`--toolchain=${toolchain}`, `-DXCLANG_SANITIZER=${list}`], process.env, true, project);
    }
  }
  const musl = `${native.arch}-unknown-linux-musl`;
  if (native.os === "linux" && fs.existsSync(path.join(tree, musl))) {
    build("sanitizer-musl", [`--toolchain=${toolchain}`, `-DXCLANG_TARGET=${musl}`, "-DXCLANG_SANITIZER=undefined"],
      process.env, true, project);
  }
  const refused = (name: string, args: string[], why: RegExp): void => {
    const all = ["-G", "Ninja", "-S", project, "-B", path.join(work, name), `--toolchain=${toolchain}`, ...args];
    const result = spawnSync("cmake", all, { encoding: "utf8" });
    if (result.status === 0 || !why.test(result.stdout + result.stderr)) {
      failures.push(`${name}: cmake ${all.join(" ")} was not refused with ${why}`);
    } else {
      console.log(`ok: ${name} refused`);
    }
  };
  if (native.os === "linux") refused("msan-prebuilt", ["-DXCLANG_SANITIZER=memory"], /XCLANG_RUNTIMES=source/);
  const without = [`${native.arch}-w64-mingw32`, ...(fs.existsSync(path.join(tree, musl)) ? [musl] : []),
    ...(native.os === "darwin" ? [native.triple] : [])];
  for (const triple of without) {
    refused(`msan-${triple}`, [`-DXCLANG_TARGET=${triple}`, "-DXCLANG_RUNTIMES=source", "-DXCLANG_SANITIZER=memory"],
      /MemorySanitizer is for the Linux targets \(glibc\)/);
  }
}

/// 8. A project of old policies, through the toolchain file: CMake 3.2's,
/// whose if() has no IN_LIST, and on CMake 4, which refuses those, 3.5's
/// (CMAKE_POLICY_VERSION_MINIMUM, which CMake 3 ignores). Its build
/// directory configured again for another target is refused: CMake keeps
/// the first one's.
{
  const project = path.join(source, "policies");
  const env = { ...process.env, CMAKE_POLICY_VERSION_MINIMUM: "3.5" };
  if (build("policies", [`--toolchain=${toolchain}`], env, true, project)) {
    const other = native.os === "mingw" ? `${native.arch}-unknown-linux-gnu` : `${native.arch}-w64-mingw32`;
    const args = ["-S", project, "-B", path.join(work, "policies"), `-DXCLANG_TARGET=${other}`];
    const result = spawnSync("cmake", args, { encoding: "utf8", env });
    if (result.status === 0 || !/configured\s+for[\s\S]*cmake\s+--fresh/.test(result.stdout + result.stderr)) {
      failures.push(`policies: cmake ${args.join(" ")} was not refused for another target`);
    } else {
      console.log("ok: another target refused in a configured build directory");
    }
  }
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
