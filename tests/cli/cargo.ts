/// xclang as cargo's C compiler and linker for the targets that need a
/// vendor SDK, from Linux: cli/ cross-compiled for arm64 and
/// x86_64 macOS against the macOS SDK, and for x64 and arm64 Windows (MSVC
/// ABI, the hybrid CRT: the VC runtime linked statically, UCRT a system
/// DLL) against the /winsysroot, both fetched by the tree's bin/xclang:
///
///   node tests/cli/cargo.ts --tree <xclang> --out <dir>
///
/// The binaries go to <dir>/macos/<arch>/xclang and
/// <dir>/msvc/<arch>/xclang.exe, where cli.yml's run jobs start them. What
/// each target needs is docs/en/integrations/cargo.md's.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { tree: { type: "string" }, out: { type: "string" } } });
if (!values.tree || !values.out) fail("--tree <xclang> --out <dir>");
const tree = path.resolve(values.tree);
const out = path.resolve(values.out);
const cli = path.join(import.meta.dirname, "..", "..", "cli");
const exe = process.platform === "win32" ? ".exe" : "";
const tool = (name: string) => path.join(tree, "bin", name + exe);

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env, print = true): string {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { encoding: "utf8", env, cwd: cli, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
  if (print) process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) fail(`${cmd} exited with ${r.status}`);
  return r.stdout;
}

/// The SDKs, fetched unless they are.
function sdk(vendor: string): string {
  const found = spawnSync(tool("xclang"), ["sdk", "path", vendor], { encoding: "utf8" });
  if (found.status === 0) return found.stdout.trim();
  return run(tool("xclang"), ["sdk", "fetch", vendor, "--accept-license"]).trim();
}
const macos = sdk("macos");
const windows = sdk("windows");

const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"];
const channel = /channel = "([^"]+)"/.exec(fs.readFileSync(path.join(cli, "rust-toolchain.toml"), "utf8"))![1]!;
run("rustup", ["toolchain", "install", channel, "--profile", "minimal", "--target", targets.join(",")]);
const summary: string[] = [];
for (const target of targets) {
  const T = target.toUpperCase().replaceAll("-", "_");
  const t = target.replaceAll("-", "_");
  const msvc = target.endsWith("msvc");
  const arch = target.split("-")[0]!;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    /// ring builds its arm64 Windows assembly with a `clang` from PATH.
    PATH: `${path.join(tree, "bin")}${path.delimiter}${process.env.PATH}`,
    [`CC_${t}`]: tool("clang"),
    [`CXX_${t}`]: tool("clang++"),
  };
  if (msvc) {
    /// lld-link finds the libraries with /winsysroot; clang (the GNU
    /// driver: ring passes it GNU options) the headers with
    /// -Xmicrosoft-windows-sys-root. The hybrid CRT: +crt-static links
    /// libcmt and libucrt, and libucrt gives way to the UCRT DLLs' ucrt.lib.
    env[`CARGO_TARGET_${T}_LINKER`] = tool("lld-link");
    env[`CARGO_TARGET_${T}_RUSTFLAGS`] = ["-Ctarget-feature=+crt-static", `-Clink-arg=/winsysroot:${windows}`,
      "-Clink-arg=/nodefaultlib:libucrt.lib", "-Clink-arg=/defaultlib:ucrt.lib",
      /// The VC runtime's objects name PDBs that are not shipped.
      "-Clink-arg=/ignore:4099"].join(" ");
    env[`CFLAGS_${t}`] = env[`CXXFLAGS_${t}`] = `-Xmicrosoft-windows-sys-root ${windows}`;
    env[`AR_${t}`] = tool("llvm-lib");
  } else {
    /// SDKROOT: rustc passes it to the linker, the cc crate to clang.
    env[`CARGO_TARGET_${T}_LINKER`] = tool("clang");
    env[`CARGO_TARGET_${T}_RUSTFLAGS`] = `-Clink-arg=--target=${target}`;
    env[`AR_${t}`] = tool("llvm-ar");
    env.SDKROOT = macos;
    env.MACOSX_DEPLOYMENT_TARGET = "13.0";
  }
  run("cargo", ["build", "--release", "--locked", "--target", target], env);
  const name = msvc ? "xclang.exe" : "xclang";
  const dest = path.join(out, msvc ? "msvc" : "macos", msvc ? arch : arch === "aarch64" ? "arm64" : arch, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(cli, "target", target, "release", name), dest);
  const libs = msvc
    ? [...run(tool("llvm-objdump"), ["-p", dest], env, false).matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]!)
    : [...run(tool("llvm-otool"), ["-L", dest], env, false).matchAll(/^\s+(\/\S+)/gm)].map((m) => m[1]!);
  const runtime = libs.filter((l) => /^(vcruntime|msvcp|ucrtbase|libunwind|libc\+\+)|\/usr\/lib\/libc\+\+/i.test(l));
  if (runtime.length) fail(`${dest} loads ${runtime.join(", ")}`);
  summary.push(`| ${target} | ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB | ${libs.join(", ")} |`);
}
console.log(summary.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    ["", "cargo with xclang and the fetched SDKs:", "", "| target | size | loads at run time |", "|---|---|---|", ...summary, ""].join("\n"));
}
