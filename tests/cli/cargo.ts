/// `xclang cargo`, the tree's command, on a machine of the tree's host:
/// cargo builds for every target of xclang cargo with no cargo config of
/// its own (docs/en/integrations/cargo.md), against the vendor SDKs the
/// tree's xclang fetches (on macOS, Xcode's SDK for the macOS targets):
///
///   node tests/cli/cargo.ts --tree <xclang> --out <dir>
///
///   examples/cargo     the docs' example: C, with the cc crate
///   tests/cli/crate    C, C++ (exceptions, std::format, libc++), a CMake
///                      project (the cmake crate) and bindgen's bindings,
///                      whose layout of a struct must be C's for the target;
///                      with RUSTFLAGS of the user's, which must reach rustc
///   xclang/            the command itself (ring, liblzma), from Linux x64
///
/// The host's target runs here, with cargo run and cargo test, and so does
/// musl's of the architecture on Linux; what each program loads is checked,
/// and every program goes to <dir>/<target>/cargo-<host>, where
/// tests/lib/on-target.ts runs it on a machine of the target. Then the
/// errors: Rust's *-windows-gnu targets, a target xclang lacks, and on
/// Linux and Windows a macOS target without the SDK, which is removed for
/// it. Only programs leave the job, never an SDK.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { host, programsDir, writePrograms, type Program } from "../lib/on-target.ts";

const { values } = parseArgs({ options: { tree: { type: "string" }, out: { type: "string" } } });
if (!values.tree || !values.out) fail("--tree <xclang> --out <dir>");
const tree = path.resolve(values.tree);
const out = path.resolve(values.out);
const repo = path.join(import.meta.dirname, "..", "..");
const exe = process.platform === "win32" ? ".exe" : "";
const tool = (name: string) => path.join(tree, "bin", name + exe);
const machine = host();
const failures: string[] = [];

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; expect?: number } = {}) {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const start = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: options.cwd, env: options.env ?? process.env, maxBuffer: 1 << 28 });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  const expect = options.expect ?? 0;
  if (r.status !== expect) failures.push(`${path.basename(cmd)} ${args.join(" ")}: exit ${r.status}, expected ${expect}`);
  console.log(`  (exit ${r.status}, ${((Date.now() - start) / 1000).toFixed(0)} s)`);
  return { ok: r.status === expect, out: (r.stdout ?? "").replaceAll("\r", ""), err: r.stderr ?? "" };
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const xclang = (args: string[], options: Parameters<typeof run>[2] = {}) => run(tool("xclang"), args, options);

/// The Rust targets, and xclang's names of them (on-target.yml's).
const targets: [string, string][] = [
  ["x86_64-unknown-linux-gnu", "x86_64-unknown-linux-gnu"],
  ["aarch64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"],
  ["x86_64-unknown-linux-musl", "x86_64-unknown-linux-musl"],
  ["aarch64-unknown-linux-musl", "aarch64-unknown-linux-musl"],
  ["x86_64-pc-windows-gnullvm", "x86_64-w64-mingw32"],
  ["aarch64-pc-windows-gnullvm", "aarch64-w64-mingw32"],
  ["aarch64-apple-darwin", "aarch64-apple-darwin"],
  ["x86_64-apple-darwin", "x86_64-apple-darwin"],
  ["x86_64-pc-windows-msvc", "x86_64-pc-windows-msvc"],
  ["aarch64-pc-windows-msvc", "aarch64-pc-windows-msvc"],
];

/// The SDKs, fetched unless they are; macOS hosts use Xcode's.
const vendors = machine.endsWith("apple-darwin") ? ["windows"] : ["macos", "windows"];
for (const vendor of vendors) {
  if (spawnSync(tool("xclang"), ["sdk", "path", vendor]).status !== 0) xclang(["sdk", "fetch", vendor, "--accept-license"]);
}

interface Crate { name: string; dir: string; program: string; env?: NodeJS.ProcessEnv; output?: string; args?: string[]; expect?: string }
const crates: Crate[] = [
  { name: "example", dir: path.join(repo, "examples", "cargo"), program: "hello", output: fs.readFileSync(path.join(repo, "examples", "cargo", "expected.txt"), "utf8") },
  {
    name: "probe", dir: path.join(repo, "tests", "cli", "crate"), program: "probe",
    env: { RUSTFLAGS: "--cfg xclang_probe" }, output: fs.readFileSync(path.join(repo, "tests", "cli", "crate", "expected.txt"), "utf8"),
  },
];
/// The command itself, without its LTO: as many C files, in less time.
if (machine === "x86_64-unknown-linux-gnu") {
  crates.push({
    name: "xclang", dir: path.join(repo, "xclang"), program: "xclang", args: ["--version"], expect: "xclang ",
    env: { CARGO_PROFILE_RELEASE_LTO: "false", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16" },
  });
}

const summary: string[] = [];
for (const [rust, triple] of targets) {
  const dest = programsDir(out, triple, "cargo");
  const programs: Program[] = [];
  for (const c of crates) {
    const env = { ...process.env, ...c.env };
    const start = Date.now();
    if (!xclang(["cargo", "build", "--release", "--locked", "--target", rust], { cwd: c.dir, env }).ok) continue;
    const seconds = ((Date.now() - start) / 1000).toFixed(0);
    const name = c.program + (rust.includes("windows") ? ".exe" : "");
    const file = path.join(c.dir, "target", rust, "release", name);
    const libs = loads(rust, file);
    fs.copyFileSync(file, path.join(dest, `${c.name}-${name}`));
    programs.push({
      file: `${c.name}-${name}`, name: `${c.name} (${rust})`, args: c.args,
      ...(c.output ? { output: c.output } : { expect: c.expect }),
    });
    summary.push(`| ${rust} | ${c.name} | ${seconds} s | ${(fs.statSync(file).size / 1048576).toFixed(1)} MB | ${libs.join(", ")} |`);
  }
  writePrograms(dest, programs);
}

/// What a program loads at run time: only its OS's libraries, glibc 2.17 at
/// most, UCRT without the VC runtime's DLLs, macOS 13.0; nothing at all for
/// musl. The libraries; a failure if it loads another.
function loads(rust: string, file: string): string[] {
  const capture = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 }).stdout ?? "";
  const bad = (libs: string[], what: string) => { if (libs.length) failures.push(`${file} (${rust}) ${what}: ${libs.join(", ")}`); };
  if (rust.endsWith("linux-musl")) {
    const headers = capture(tool("llvm-readelf"), ["--program-headers", "--dynamic", file]);
    bad(/INTERP|NEEDED/.test(headers) ? ["a program interpreter or libraries"] : [], "loads");
    return ["nothing"];
  }
  if (rust.endsWith("linux-gnu")) {
    const libs = [...capture(tool("llvm-readobj"), ["--needed-libs", file]).matchAll(/^\s+(\S+\.so\S*)$/gm)].map((m) => m[1]!);
    bad(libs.filter((l) => !/^(libc\.so\.6|libm\.so\.6|libpthread\.so\.0|libdl\.so\.2|librt\.so\.1|libutil\.so\.1|ld-linux[-\w]*\.so\.\d)$/.test(l)), "loads");
    const glibc = Math.max(0, ...[...capture(tool("llvm-readelf"), ["--version-info", file]).matchAll(/GLIBC_2\.(\d+)/g)].map((m) => Number(m[1])));
    bad(glibc > 17 ? [`glibc 2.${glibc}`] : [], "needs");
    return [...libs, `(glibc 2.${glibc})`];
  }
  if (rust.includes("windows")) {
    const libs = [...capture(tool("llvm-objdump"), ["-p", file]).matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]!);
    bad(libs.filter((l) => /^(libunwind|libc\+\+|libwinpthread|libgcc|libstdc\+\+|msvcp|vcruntime|ucrtbase)/i.test(l)), "loads");
    bad(libs.some((l) => /^api-ms-win-crt-/i.test(l)) ? [] : ["UCRT"], "does not load");
    return libs.filter((l) => !/^api-ms-win-crt-/i.test(l)).concat("UCRT");
  }
  const libs = [...capture(tool("llvm-otool"), ["-L", file]).matchAll(/^\s+(\/\S+)/gm)].map((m) => m[1]!);
  bad(libs.filter((l) => !/^(\/usr\/lib\/libSystem\.B\.dylib|\/usr\/lib\/libiconv\.2\.dylib|\/usr\/lib\/libobjc\.A\.dylib|\/System\/Library\/Frameworks\/\w+\.framework\/.+)$/.test(l)), "loads");
  const minos = /minos (\S+)/.exec(capture(tool("llvm-otool"), ["-l", file]))?.[1];
  bad(minos === "13.0" ? [] : [`macOS ${minos}`], "is for");
  return [...libs, `(macOS ${minos})`];
}

/// The host's own target, and musl's on Linux: cargo run and cargo test,
/// as a user runs them, without --target too.
const own = targets.map(([rust]) => rust).filter((rust) =>
  machine === "x86_64-unknown-linux-gnu" ? rust.startsWith("x86_64-unknown-linux")
    : machine === "x86_64-w64-mingw32" ? rust.startsWith("x86_64-pc-windows")
      : machine === "aarch64-apple-darwin" ? rust === "aarch64-apple-darwin" : false);
const probe = crates[1]!;
for (const rust of own) {
  const env = { ...process.env, ...probe.env };
  const r = xclang(["cargo", "run", "--release", "--locked", "--target", rust], { cwd: probe.dir, env });
  check(r.out === probe.output, `cargo run --target ${rust} prints ${JSON.stringify(probe.output)}`);
  xclang(["cargo", "test", "--release", "--locked", "--target", rust], { cwd: probe.dir, env });
}
/// The host's, as cargo builds without --target: build scripts and proc
/// macros linked by xclang too.
const plain = xclang(["cargo", "run", "--release", "--locked"], { cwd: crates[0]!.dir });
check(plain.out === crates[0]!.output, "cargo run, for the host, prints the example's text");

/// What it refuses, and why.
const refused = (args: string[], text: RegExp, what: string) => {
  const r = xclang(["cargo", "build", ...args], { cwd: crates[0]!.dir, expect: 1 });
  check(text.test(r.err), what);
};
refused(["--target", "x86_64-pc-windows-gnu"], /x86_64-pc-windows-gnullvm/, "*-windows-gnu: build for *-windows-gnullvm");
refused(["--target", "riscv64gc-unknown-linux-gnu"], /not a target of xclang cargo/, "a target xclang lacks");
if (vendors.includes("macos")) {
  const sdk = spawnSync(tool("xclang"), ["sdk", "path", "macos"], { encoding: "utf8" }).stdout.trim();
  xclang(["sdk", "remove", path.basename(sdk)]);
  refused(["--target", "aarch64-apple-darwin"], /xclang sdk fetch macos --accept-license/, "a macOS target without the SDK names the fetch");
}

console.log(summary.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["", `xclang cargo on ${machine}:`, "",
    "| target | crate | build | size | loads at run time |", "|---|---|---|---|---|", ...summary, ""].join("\n"));
}
if (failures.length) fail(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
console.log("all passed");
