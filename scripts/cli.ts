/// Build xclang's own command (cli/, Rust) for toolchain hosts, with an
/// xclang toolchain as the C compiler and linker of every target, and check
/// that it loads nothing at run time but what its OS has:
///
///   node scripts/cli.ts [--xclang <tree>] [--host <triple>,...] [--revision <n>]
///
/// The toolchain is a released one (SOURCES' cli-linux, cli-macos) unless
/// --xclang names another; the hosts are those this machine builds
/// toolchains for (Linux: Linux and Windows; macOS: macOS). Each binary
/// goes to work/out/cli-<host>/xclang[.exe]; --revision makes it say it is
/// of release <llvm version>.<revision>.
///
/// Rust's targets are the hosts' triples, but *-pc-windows-gnullvm for the
/// MinGW hosts: its std links libunwind and UCRT, as xclang's MinGW
/// sysroots have them. cargo is told, per target:
///
///   CARGO_TARGET_<T>_LINKER   xclang's clang, which reads <triple>.cfg
///   CC_<t>, CXX_<t>, AR_<t>   the same for crates' C code (ring, liblzma)
///   rustflags                 --target for the clang that links; on Linux
///                             -l:libunwind.a, as Rust's std links with
///                             -nodefaultlibs and asks for libgcc_s, whose
///                             xclang stub is empty; on x86_64 Linux
///                             -Clinker-features=-lld, so that xclang's lld
///                             links rather than the rust-lld rustc ships
///
/// The target of this machine is built without --target, so that the same
/// flags reach the build scripts, which cargo links with the same linker.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

const { values } = parseArgs({
  options: {
    xclang: { type: "string" },
    host: { type: "string" },
    revision: { type: "string" },
  },
});
const cli = path.join(common.ROOT, "cli");
const hosts = (values.host?.split(",") ??
  common.TARGETS.filter((t) => common.buildMachine(t) === common.machine()).map((t) => t.triple)).map(common.target);

function rustTarget(t: common.Target): string {
  return t.os === "mingw" ? `${t.arch}-pc-windows-gnullvm` : t.triple;
}

async function toolchain(): Promise<string> {
  if (values.xclang) return path.resolve(values.xclang);
  const name = common.machine() === "macos" ? "cli-macos" : "cli-linux";
  const tree = path.join(common.WORK, "src", name);
  if (!fs.existsSync(path.join(tree, "bin"))) common.extract(await common.fetchSource(name), tree);
  return tree;
}

const tree = await toolchain();
const tool = (name: string) => path.join(tree, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const channel = /channel = "([^"]+)"/.exec(fs.readFileSync(path.join(cli, "rust-toolchain.toml"), "utf8"))![1]!;
common.run("rustup", ["toolchain", "install", channel, "--profile", "minimal", "--component", "clippy,rustfmt",
  "--target", hosts.map(rustTarget).join(",")]);

const summary: string[] = [];
for (const host of hosts) {
  const target = rustTarget(host);
  const native = host.triple === common.machineTarget().triple;
  const T = target.toUpperCase().replaceAll("-", "_");
  const t = target.replaceAll("-", "_");
  const flags = [`-Clink-arg=--target=${host.triple}`];
  if (host.os === "linux") flags.push("-Clink-arg=-l:libunwind.a");
  if (target === "x86_64-unknown-linux-gnu") flags.push("-Clinker-features=-lld");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [`CARGO_TARGET_${T}_LINKER`]: tool("clang"),
    [`CC_${t}`]: tool("clang"),
    [`CXX_${t}`]: tool("clang++"),
    [`AR_${t}`]: tool("llvm-ar"),
    [native ? "RUSTFLAGS" : `CARGO_TARGET_${T}_RUSTFLAGS`]: flags.join(" "),
  };
  if (values.revision) env.XCLANG_VERSION = `${common.LLVM_VERSION}.${values.revision}`;
  if (host.os === "darwin") env.MACOSX_DEPLOYMENT_TARGET = common.MACOS_MIN;
  common.run("cargo", ["build", "--release", "--locked", ...(native ? [] : ["--target", target])], { cwd: cli, env });
  const name = host.os === "mingw" ? "xclang.exe" : "xclang";
  const dest = path.join(common.WORK, "out", `cli-${host.triple}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(cli, "target", native ? "" : target, "release", name), path.join(dest, name));
  summary.push(check(host, path.join(dest, name)));
}
console.log(summary.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    ["| host | size | loads at run time |", "|---|---|---|", ...summary, ""].join("\n"));
}

/// What the binary loads at run time: only its OS's libraries (glibc 2.17
/// at most; libSystem and system frameworks; the OS's DLLs and UCRT).
/// Its summary line; fails otherwise.
function check(host: common.Target, file: string): string {
  const failures: string[] = [];
  let libs: string[];
  if (host.os === "linux") {
    libs = [...common.capture(tool("llvm-readobj"), ["--needed-libs", file]).matchAll(/^\s+(\S+\.so\S*)$/gm)].map((m) => m[1]!);
    const allowed = /^(libc\.so\.6|libm\.so\.6|libpthread\.so\.0|libdl\.so\.2|librt\.so\.1|libutil\.so\.1|ld-linux[-\w]*\.so\.\d)$/;
    failures.push(...libs.filter((l) => !allowed.test(l)).map((l) => `loads ${l}`));
    const versions = common.capture(tool("llvm-readelf"), ["--version-info", file]);
    const glibc = Math.max(0, ...[...versions.matchAll(/GLIBC_2\.(\d+)/g)].map((m) => Number(m[1])));
    if (glibc > 17) failures.push(`needs glibc 2.${glibc}`);
    libs.push(`(glibc 2.${glibc})`);
  } else if (host.os === "mingw") {
    libs = [...common.capture(tool("llvm-objdump"), ["-p", file]).matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]!);
    /// UCRT through its api sets, never a C or C++ runtime of its own.
    const runtime = /^(libunwind|libc\+\+|libwinpthread|libgcc|libstdc\+\+|msvcrt|msvcp|vcruntime|ucrtbase)/i;
    failures.push(...libs.filter((l) => runtime.test(l)).map((l) => `loads ${l}`));
    if (!libs.some((l) => /^api-ms-win-crt-/i.test(l))) failures.push("does not load UCRT");
  } else {
    libs = [...common.capture(tool("llvm-otool"), ["-L", file]).matchAll(/^\s+(\/\S+)/gm)].map((m) => m[1]!);
    const allowed = /^(\/usr\/lib\/libSystem\.B\.dylib|\/usr\/lib\/libiconv\.2\.dylib|\/usr\/lib\/libobjc\.A\.dylib|\/System\/Library\/Frameworks\/\w+\.framework\/.+)$/;
    failures.push(...libs.filter((l) => !allowed.test(l)).map((l) => `loads ${l}`));
    const minos = /minos (\S+)/.exec(common.capture(tool("llvm-otool"), ["-l", file]))?.[1];
    if (minos !== common.MACOS_MIN) failures.push(`for macOS ${minos}, not ${common.MACOS_MIN}`);
    libs.push(`(macOS ${minos})`);
  }
  if (failures.length) common.fail(`${file}: ${failures.join("; ")}`);
  return `| ${host.triple} | ${(fs.statSync(file).size / 1048576).toFixed(1)} MB | ${libs.join(", ")} |`;
}
