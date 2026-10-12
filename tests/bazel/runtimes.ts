/// The C++ runtimes built from source in the Bazel module
/// (--@xclang//runtimes:source, packages/bazel/bazel/runtimes.bzl), with a
/// toolchain unpacked by hand that has their sources (XCLANG_ROOT):
///
///   node tests/bazel/runtimes.ts --tree <xclang> [--disk-cache <dir>] [--programs <dir>]
///
/// tests/bazel/runtimes built once per variant for this host's target, and
/// run: with no options, the prebuilt runtimes' __config_site again; a
/// hardening mode, which traps on a read past a vector's end; an ABI
/// namespace and ABI macros of libc++'s own, without exceptions and RTTI.
/// Linux x64 adds MemorySanitizer (--features=msan), which reports a use
/// of uninitialized memory inside libc++ and nothing of what libc++ itself
/// writes, ThreadSanitizer (--features=tsan), which reports a data race,
/// and a program of ThinLTO (--features=thin_lto) on them, which are not;
/// Linux x64 and arm64 macOS, AddressSanitizer (--features=asan), whose
/// container-overflow only an instrumented libc++ reports. What the module
/// cannot build is refused, saying why: the options without
/// --@xclang//runtimes:source, MemorySanitizer without it and for a target
/// that has none, and on macOS the platform's C++ library with it. With
/// --programs
/// <dir>, the hardening variant for other targets too (from Linux x64:
/// Linux arm64 and both MinGW targets; from arm64 macOS: x86_64 macOS),
/// whose programs tests/lib/on-target.ts runs on machines of those targets.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { host, programsDir, writePrograms, type Program } from "../lib/on-target.ts";

const { values } = parseArgs({
  options: { tree: { type: "string" }, "disk-cache": { type: "string" }, programs: { type: "string" } },
});
if (!values.tree) common.fail("--tree <xclang> [--disk-cache <dir>] [--programs <dir>]");
const tree = path.resolve(values.tree);
const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const workspace = path.join(common.ROOT, "tests", "bazel");
const native = host();
const failures: string[] = [];

const flags = [
  `--repo_env=XCLANG_ROOT=${tree}`,
  "--@xclang//runtimes:source",
  ...(values["disk-cache"] ? [`--disk_cache=${path.resolve(values["disk-cache"])}`] : []),
];

/// A build the module refuses: it fails, and says why.
function refused(name: string, args: string[], why: RegExp): void {
  const startup = windows ? ["--output_user_root=C:/b", "--windows_enable_symlinks"] : [];
  const all = ["build", `--repo_env=XCLANG_ROOT=${tree}`, ...args, "//runtimes:variant"];
  console.log(`+ bazel ${all.join(" ")}`);
  const result = spawnSync("bazel", [...startup, ...all], { cwd: workspace, encoding: "utf8", shell: windows, maxBuffer: 1 << 28 });
  expect(`${name}: refused`, result.status !== 0 && why.test(`${result.stdout}${result.stderr}`),
    `exit ${result.status}, no ${why} in its output:\n${(result.stderr ?? "").slice(-2000)}`);
}

function bazel(args: string[], capture = false): string | undefined {
  const startup = windows ? ["--output_user_root=C:/b", "--windows_enable_symlinks"] : [];
  console.log(`+ bazel ${args.join(" ")}`);
  const result = spawnSync("bazel", [...startup, ...args], {
    cwd: workspace,
    encoding: "utf8",
    shell: windows,
    maxBuffer: 1 << 28,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  if (result.status !== 0) {
    failures.push(`bazel ${args.join(" ")}`);
    return undefined;
  }
  return result.stdout ?? "";
}

/// Build the programs of one variant; their files.
function build(options: string[]): { variant: string; std: string } | undefined {
  if (bazel(["build", ...flags, ...options, "//runtimes:all"]) === undefined) return undefined;
  const file = (label: string) => bazel(["cquery", ...flags, ...options, "--output=files", label], true)?.trim();
  const variant = file("//runtimes:variant");
  const std = file("//runtimes:variant_std");
  if (!variant || !std) return undefined;
  return { variant: path.join(workspace, variant), std: path.join(workspace, std) };
}

/// Run a program; its output (stdout, then stderr), status and signal.
function run(file: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", env: { ...process.env, ...env } });
  return { output: `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll("\r", ""), status: result.status, signal: result.signal };
}

function expect(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAILED"}: ${name}${ok ? "" : `: ${detail}`}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

/// A trap: a signal, or on Windows an exception (NTSTATUS, above 0xC0000000).
const trapped = (r: ReturnType<typeof run>) => r.signal !== null || (r.status !== null && (r.status < 0 || r.status > 255));

const variants: { name: string; flags: string[]; namespace: string; mode: number; exceptions: number }[] = [
  { name: "default", flags: [], namespace: "__1", mode: 2, exceptions: 1 },
  { name: "hardening", flags: ["--@xclang//runtimes:hardening=fast"], namespace: "__1", mode: 4, exceptions: 1 },
  {
    name: "abi",
    flags: [
      "--@xclang//runtimes:abi_namespace=__xclang",
      "--@xclang//runtimes:abi_defines=_LIBCPP_ABI_BOUNDED_ITERATORS,_LIBCPP_ABI_BOUNDED_ITERATORS_IN_STRING",
      "--@xclang//runtimes:exceptions=false",
      "--@xclang//runtimes:rtti=false",
      "--copt=-fno-exceptions",
      "--copt=-fno-rtti",
    ],
    namespace: "__xclang",
    mode: 2,
    exceptions: 0,
  },
  ...(native === "x86_64-unknown-linux-gnu"
    ? [
      { name: "msan", flags: ["--features=msan", "-c", "dbg"], namespace: "__1", mode: 2, exceptions: 1 },
      { name: "lto", flags: ["--features=thin_lto", "-c", "opt"], namespace: "__1", mode: 2, exceptions: 1 },
      { name: "tsan", flags: ["--features=tsan"], namespace: "__1", mode: 2, exceptions: 1 },
    ]
    : []),
  ...(native === "x86_64-unknown-linux-gnu" || native === "aarch64-apple-darwin"
    ? [{ name: "asan", flags: ["--features=asan"], namespace: "__1", mode: 2, exceptions: 1 }]
    : []),
];

const nm = path.join(tree, "bin", `llvm-nm${exe}`);
for (const v of variants) {
  console.log(`\n=== ${v.name}`);
  const built = build(v.flags);
  if (!built) continue;
  const r = run(built.variant);
  expect(`${v.name}: variant`, r.status === 0 &&
    r.output.includes(`namespace ${v.namespace} hardening ${v.mode} exceptions ${v.exceptions}\nstream: 42 3.5\ndemangled: f()`) &&
    !r.output.includes("Sanitizer"), r.output);
  const s = run(built.std);
  expect(`${v.name}: import std`, s.status === 0 && s.output.includes("3 elements"), s.output);
  const symbols = spawnSync(nm, ["-C", built.std], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout ?? "";
  expect(`${v.name}: import std's namespace`, symbols.includes(`add(std::${v.namespace}::vector<std::${v.namespace}::basic_string`),
    "no add(std::<namespace>::vector<...>) in the program");
  if (v.mode !== 2) {
    const oob = run(built.variant, ["oob"]);
    expect(`${v.name}: a read past the end traps`, trapped(oob), `${oob.status} ${oob.signal}: ${oob.output}`);
  }
  /// What the build's sanitizer reports, through the instrumented libc++.
  const reports: Record<string, [string, RegExp]> = {
    asan: ["overflow", /AddressSanitizer: container-overflow/],
    tsan: ["race", /ThreadSanitizer: data race/],
  };
  if (reports[v.name]) {
    const [argument, report] = reports[v.name]!;
    const r = run(built.variant, [argument]);
    expect(`${v.name}: variant ${argument} reported`, report.test(r.output), r.output);
  }
  if (v.name === "msan") {
    const report = run(built.variant, ["uninitialized"], { MSAN_SYMBOLIZER_PATH: path.join(tree, "bin", "llvm-symbolizer") });
    expect("msan: a use of uninitialized memory inside libc++",
      /MemorySanitizer: use-of-uninitialized-value[\s\S]*basic_istream<char, std::__1::char_traits<char>>::sentry::sentry/.test(report.output),
      report.output);
  }
  if (v.name === "default") {
    /// The variant's __config_site, made from the target's, is the target's.
    const outputPath = bazel(["info", ...flags, "output_path"], true)?.trim();
    const triple = native === "x86_64-w64-mingw32" || native === "aarch64-w64-mingw32" ? native.replace("w64-mingw32", "w64-windows-gnu") : native;
    const prebuilt = fs.readFileSync(path.join(tree, "libc++", "include", triple, "c++", "v1", "__config_site"));
    const made = outputPath ? findConfigSite(outputPath) : [];
    expect("default: __config_site is the prebuilt one", made.length > 0 && made.every((f) => fs.readFileSync(f).equals(prebuilt)),
      `${made.join(", ") || "none found"}`);
  }
}

/// The variants' __config_site files under bazel-out.
function findConfigSite(outputPath: string): string[] {
  const found: string[] = [];
  for (const config of fs.readdirSync(outputPath)) {
    const external = path.join(outputPath, config, "bin", "external");
    if (!fs.existsSync(external)) continue;
    for (const repo of fs.readdirSync(external).filter((r) => r.endsWith(`xclang_${native}`))) {
      const file = path.join(external, repo, "runtime", "include", "__config_site");
      if (fs.existsSync(file)) found.push(file);
    }
  }
  return found;
}

/// What the module refuses, before it builds anything.
console.log("\n=== refused");
refused("hardening without the runtimes from source", ["--@xclang//runtimes:hardening=fast"],
  /--@xclang\/\/runtimes:hardening is for the runtimes built from source/);
refused("msan without the runtimes from source", ["--features=msan"], native.endsWith("-linux-gnu")
  ? /--features=msan needs every library instrumented/
  : /MemorySanitizer is for the Linux targets \(glibc\)/);
refused("msan for MinGW", ["--@xclang//runtimes:source", "--features=msan", "--platforms=@xclang//platforms:x86_64-w64-mingw32"],
  /MemorySanitizer is for the Linux targets \(glibc\), x86_64 and aarch64, not x86_64-w64-mingw32/);
if (native.endsWith("-apple-darwin")) {
  refused("the platform's C++ library with the runtimes from source",
    ["--@xclang//runtimes:source", "--@xclang//bazel:stdlib=platform"], /not with --@xclang\/\/runtimes:source/);
}

/// The hardening variant for other targets, run on their machines.
const others = { "x86_64-unknown-linux-gnu": ["aarch64-unknown-linux-gnu", "x86_64-w64-mingw32", "aarch64-w64-mingw32"],
  "aarch64-apple-darwin": ["x86_64-apple-darwin"] }[native] ?? [];
if (values.programs) {
  for (const triple of others) {
    console.log(`\n=== hardening for ${triple}`);
    const built = build([`--platforms=@xclang//platforms:${triple}`, "--@xclang//runtimes:hardening=fast"]);
    if (!built) continue;
    const out = programsDir(path.resolve(values.programs), triple, "bazel-runtimes");
    const suffix = triple.includes("mingw") ? ".exe" : "";
    fs.copyFileSync(built.variant, path.join(out, `variant${suffix}`));
    fs.copyFileSync(built.std, path.join(out, `variant_std${suffix}`));
    const programs: Program[] = [
      { file: `variant${suffix}`, output: "namespace __1 hardening 4 exceptions 1\nstream: 42 3.5" },
      { file: `variant${suffix}`, name: "variant oob, a trap", args: ["oob"], trap: true },
      { file: `variant_std${suffix}`, expect: "3 elements" },
    ];
    writePrograms(out, programs);
  }
}

if (failures.length) common.fail(`${failures.length} checks failed:\n  ${failures.join("\n  ")}`);
console.log(`\nthe runtimes from source, every variant, on ${native}`);
