/// Put one host's release archives together in work/dist, as .tar.xz:
///
///   xclang-<version>-<host>      the toolchain of work/out/toolchain-<host>,
///                                with every target of work/out/runtimes-*,
///                                and the CMake package in lib/cmake/xclang
///   libclang-<version>-<host>    work/out/libclang-<host>
///   libclang-<version>-<host>-asan  work/out/libclang-<host>-asan, if built
///   llvm-option-inc-<version>    Linux x64 only: clang's, lld's, llvm-lib's
///                                and llvm-dlltool's option tables
///
/// With --cli <dir>, the toolchain carries xclang's own command, bin/xclang,
/// from <dir>/cli-<host> (cli/cli.ts); without it, as until it ships,
/// it does not.
///
/// Every archive has share/licenses: the license files of what it holds,
/// a README.md and an SPDX document of them (toolchain/licenses.ts).
///
/// A Windows toolchain has no links at all: its aliases are small programs
/// (toolchain/launcher/alias.c, put there by toolchain/toolchain.ts), and
/// the Linux sysroots have none (toolchain/sysroot.ts). No two paths differ
/// only in case.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";
import * as licenses from "./licenses.ts";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    revision: { type: "string", default: "1" },
    cli: { type: "string" },
  },
});
if (!values.host) common.fail("--host <triple> [--revision <n>] [--cli <dir>]");
const host = common.target(values.host);
const version = `${common.LLVM_VERSION}.${values.revision}`;
const out = path.join(common.WORK, "out");
const dist = path.join(common.WORK, "dist");
fs.mkdirSync(dist, { recursive: true });

const date = licenses.sourceDate();
const llvmLibraries = "LLVM's and clang's libraries and headers (clang-tidy's too), clang's resource headers";
const libclangLicenses = async () => [
  licenses.xclang(version, "xclang's build of it, and lib/cmake/xclang"),
  await licenses.llvmProject(llvmLibraries),
  ...await licenses.compression(host),
  ...host.os === "mingw" ? [await licenses.mingwW64("the C runtime's headers the libraries are compiled with")] : [],
];

const runtimes = fs.readdirSync(out).filter((d) => d.startsWith("runtimes-")).map((d) => path.join(out, d));
/// One per Linux and MinGW target, one for both macOS targets, one for both
/// MSVC targets.
if (runtimes.length !== 6) common.fail(`expected the runtimes of all targets in ${out}, found ${runtimes.length}`);

/// The archives are reproducible: the same files make the same bytes,
/// whatever the machine, the files' times and permissions, the umask, the
/// directory or the number of threads. tar lists the files sorted by name,
/// with the commit's time (SOURCE_DATE_EPOCH), no owner, 755 or 644, hard
/// links as files, and no pax headers (GNU format). xz always compresses
/// multi-threaded (one thread is -T+1: -T1 would be its single-threaded
/// compressor, whose output differs), in blocks of a fixed size, so its
/// output does not depend on the number of threads (XCLANG_XZ_THREADS, the
/// processors' by default); --no-adjust makes it fail rather than switch
/// to the single-threaded one for lack of memory.
const xzThreads = process.env.XCLANG_XZ_THREADS === "1" ? "+1" : process.env.XCLANG_XZ_THREADS ?? "0";
const epoch = Math.floor(date.getTime() / 1000);

function archive(dir: string, name: string): void {
  const file = path.join(dist, `${name}.tar.xz`);
  common.run("bash", ["-c", [
    "set -o pipefail;",
    `LC_ALL=C tar --sort=name --format=gnu --owner=0 --group=0 --numeric-owner --mtime=@${epoch}`,
    `--mode=a+rX,u+w,go-w --hard-dereference -C "$0" -cf - "$1"`,
    `| xz -9 -T${xzThreads} --block-size=192MiB --no-adjust > "$2"`,
  ].join(" "), path.dirname(dir), path.basename(dir), file]);
}

const toolchain = path.join(out, `toolchain-${host.triple}`);
if (!fs.existsSync(path.join(toolchain, "bin"))) common.fail(`missing ${toolchain}`);
const tree = common.makeTree(path.join(common.WORK, "package", host.triple, "xclang"), toolchain, runtimes, host.os);
fs.copyFileSync(path.join(common.ROOT, "LICENSE"), path.join(tree, "LICENSE"));
/// find_package(xclang) and the toolchain file (packages/cmake).
common.writeCMakePackage(path.join(tree, "lib", "cmake", "xclang"), version);
/// windres, the name CMake looks for to compile a MinGW project's .rc
/// files (Modules/Platform/Windows-GNU.cmake), is llvm-windres: on Windows
/// a copy of its launcher, which passes on the name it runs under.
const bin = path.join(tree, "bin");
if (host.os === "mingw") fs.copyFileSync(path.join(bin, "llvm-windres.exe"), path.join(bin, "windres.exe"));
else fs.symlinkSync("llvm", path.join(bin, "windres"));
const cliLicenses: licenses.Component[] = [];
if (values.cli) {
  const name = host.os === "mingw" ? "xclang.exe" : "xclang";
  const built = path.join(values.cli, `cli-${host.triple}`, name);
  if (!fs.existsSync(built)) common.fail(`missing ${built}`);
  fs.copyFileSync(built, path.join(bin, name));
  fs.chmodSync(path.join(bin, name), 0o755);
  cliLicenses.push(...licenses.collected(path.join(values.cli, `cli-${host.triple}`, "licenses")));
}
licenses.write(tree, `xclang-${version}-${host.triple}`, version, [
  licenses.xclang(version, "xclang's config files, CMake package (lib/cmake/xclang) and xclang command (bin/xclang)"),
  await licenses.llvmProject("clang, lld and the LLVM tools in bin/, clang's resource headers, and libc++, " +
    "libc++abi, libunwind and compiler-rt of every target"),
  ...await licenses.compression(host),
  ...licenses.linuxSysroots(),
  await licenses.mingwW64("the Windows targets' headers, CRT and winpthreads, which Windows hosts' programs link too"),
  ...cliLicenses,
], date);
const files = fs.readdirSync(tree, { recursive: true }) as string[];
if (host.os === "mingw") {
  const links = files.filter((f) => fs.lstatSync(path.join(tree, f)).isSymbolicLink());
  if (links.length) common.fail(`symlinks in a Windows toolchain: ${links.join(", ")}`);
}
/// Every archive unpacks on case-insensitive file systems too: Windows and
/// macOS hosts, and conda packages of the targets shared by all hosts.
const seen = new Map<string, string>();
const clashes = files.filter((f) => seen.get(f.toLowerCase()) !== undefined || !seen.set(f.toLowerCase(), f));
if (clashes.length) common.fail(`paths alike but for case: ${clashes.map((f) => `${f} (${seen.get(f.toLowerCase())})`).join(", ")}`);
archive(tree, `xclang-${version}-${host.triple}`);

/// The option tables (toolchain/toolchain.ts), the same from every host:
/// Linux x64's are published, the source of a noarch package.
if (host.triple === "x86_64-unknown-linux-gnu") {
  const tables = path.join(out, `libclang-${host.triple}`, "include", "llvm-options-td");
  if (!fs.existsSync(tables)) common.fail(`missing ${tables}`);
  const dir = path.join(common.WORK, "package", host.triple, "llvm-option-inc");
  fs.rmSync(dir, { recursive: true, force: true });
  common.copyTree(tables, path.join(dir, "include", "llvm-options-td"));
  licenses.write(dir, `llvm-option-inc-${version}`, version, [
    licenses.xclang(version, "xclang's build of them"),
    await licenses.llvmProject("clang's, lld's, llvm-lib's and llvm-dlltool's option tables, TableGen's output of LLVM's sources"),
  ], date);
  archive(dir, `llvm-option-inc-${version}`);
}

for (const variant of ["", "-asan"]) {
  const libclang = path.join(out, `libclang-${host.triple}${variant}`);
  if (!fs.existsSync(libclang)) continue;
  for (const config of ["lib/cmake/llvm/LLVMConfig.cmake", "lib/cmake/clang/ClangConfig.cmake"]) {
    if (!fs.existsSync(path.join(libclang, config))) common.fail(`no ${config} in ${libclang}`);
  }
  const dir = path.join(common.WORK, "package", host.triple, `libclang${variant}`);
  fs.rmSync(dir, { recursive: true, force: true });
  common.copyTree(libclang, dir);
  licenses.write(dir, `libclang-${version}-${host.triple}${variant}`, version, await libclangLicenses(), date);
  archive(dir, `libclang-${version}-${host.triple}${variant}`);
}

for (const file of fs.readdirSync(dist)) {
  console.log(`${(fs.statSync(path.join(dist, file)).size / 1048576).toFixed(0).padStart(6)} MB  ${file}`);
}
