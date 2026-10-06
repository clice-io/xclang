/// Checks of the Bazel module beyond tests/bazel's own tests, run after them
/// with the same disk cache:
///
///   node tests/bazel.ts --disk-cache <dir> [--previous <version>]
///
/// 1. A copy of the checkout elsewhere (other paths, another output base)
///    builds tests/bazel's programs from the disk cache alone: no action's
///    key holds an absolute path. So do they, built for a target of another
///    os (--platforms), which fetches no other host's toolchain and the
///    libclang of that target only; a macOS target off macOS fails with why.
/// 2. The module as the registry has it: scripts/bazel.ts's archive of
///    packages/bazel, in a registry of its own, in place of tests/bazel's
///    local_path_override: the same actions, from the disk cache.
/// 3. The module as git_override of a commit has it: the checkout's HEAD,
///    strip_prefix = "packages/bazel", builds the programs (from the disk
///    cache, if HEAD's versions.bzl names the same release).
/// 4. The copy at the previous release (packages/bazel/bazel/versions.bzl
///    of --previous) runs every compile and link again: the toolchain's
///    files are the actions' inputs. (Bazel's own module maps of the same
///    scans, with its tools built alike, may come from the cache.)
/// 5. lld's --gc-sections in optimized links: on by default for Linux,
///    off for Windows unless asked for (the gc_sections feature).
/// 6. On Linux and macOS, the programs built without the disk cache, in the
///    sandbox and outside it, one action at a time, next to as many actions
///    with no inputs: what staging the toolchain's files costs.
/// 7. The linker's ThinLTO cache (XCLANG_THINLTO_CACHE) on the link of
///    libclang's bitcode: the directory made by the module, again once
///    gone; a second link takes every module's code from it; the program is
///    the same without it.
/// 8. Debug symbols by xclang_debug_symbols: GSYM, and dSYM on macOS, with
///    the lines of the program's code and of libclang's after ThinLTO; for
///    the target of another os too.
/// 9. Debug information wherever the build ran: the same bytes from another
///    checkout, and gdb, lldb (with and without a dSYM) and llvm-symbolizer
///    find a source of this repository and one of an external repository
///    through bazel-<workspace>.
/// 10. A release's strip by the target's object format (the .stripped of a
///     program), for this host's target and another os's.
/// 11. @libclang, its libraries and its resource directory, follow
///     --features=asan.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as common from "../scripts/common.ts";

const { values } = parseArgs({
  options: {
    "disk-cache": { type: "string" },
    previous: { type: "string", default: "23.1.2.5" },
  },
});
if (!values["disk-cache"]) common.fail("--disk-cache <dir> [--previous <version>]");
const diskCache = path.resolve(values["disk-cache"]);
const windows = process.platform === "win32";
/// The programs of tests/bazel; the tool on libclang is checked for its keys,
/// not timed.
const PROGRAMS = ["//c:c_test", "//cpp:all", "//modules:all", "//options:all", "//shared:all"];
const TARGETS = [...PROGRAMS, "//libclang:libclang_test"];

/// Bazel's own summary of a build: "INFO: 12 processes: 4 internal, 8 disk cache hit."
interface Processes {
  hits: number;
  executed: number;
  seconds: number;
}

function run(cwd: string, args: string[]) {
  const startup = windows ? ["--output_user_root=C:/b", "--windows_enable_symlinks"] : [];
  return spawnSync("bazel", [...startup, ...args], { cwd, encoding: "utf8", shell: windows, maxBuffer: 1 << 28 });
}

function bazel(cwd: string, args: string[]): Processes {
  const start = Date.now();
  const result = run(cwd, args);
  const seconds = (Date.now() - start) / 1000;
  process.stderr.write(result.stderr);
  if (result.status !== 0) common.fail(`bazel ${args.join(" ")} failed in ${cwd}`);
  const summary = /INFO: \d+ processes?: (.*)\./.exec(result.stderr)?.[1] ?? "";
  let hits = 0;
  let executed = 0;
  for (const part of summary.split(", ")) {
    const match = /^(\d+) (.*)$/.exec(part);
    if (!match) continue;
    const count = Number(match[1]);
    if (match[2] === "disk cache hit" || match[2] === "remote cache hit") hits += count;
    else if (match[2] !== "internal" && match[2] !== "action cache hit") executed += count;
  }
  return { hits, executed, seconds };
}

/// The spawns of an --execution_log_json_file: JSON objects one after another.
function spawns(file: string): { mnemonic: string; cacheHit?: boolean; remoteCacheHit?: boolean }[] {
  const text = fs.readFileSync(file, "utf8");
  const result = [];
  let depth = 0;
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && --depth === 0) {
      result.push(JSON.parse(text.slice(start, i + 1)));
    }
  }
  return result;
}

const report: string[] = [];
function check(ok: boolean, line: string): void {
  console.log(`${ok ? "ok" : "FAILED"}: ${line}`);
  report.push(`| ${ok ? "ok" : "**failed**"} | ${line} |`);
  if (!ok) process.exitCode = 1;
}

/// The toolchain repository of this host, as a workspace has it fetched.
function toolchainDir(workspace: string): string {
  const external = path.join(run(workspace, ["info", "output_base"]).stdout.trim(), "external");
  const name = fs.readdirSync(external).find((n) => n.endsWith(`+xclang_${host}`));
  if (!name) common.fail(`no xclang_${host} repository in ${external}`);
  return path.join(external, name);
}

/// The checkout without what is not the module's or the tests'.
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xclang-")), "checkout");
fs.cpSync(common.ROOT, copy, {
  recursive: true,
  verbatimSymlinks: true,
  filter: (src) => {
    const name = path.basename(src);
    return ![".git", "work", "node_modules", ".pixi"].includes(name) && !name.startsWith("bazel-");
  },
});
const tests = path.join(copy, "tests", "bazel");
const cache = [`--disk_cache=${diskCache}`];

const shared = bazel(tests, ["build", ...cache, ...TARGETS]);
check(shared.executed === 0 && shared.hits > 0,
  `another checkout: ${shared.hits} actions from the disk cache, ${shared.executed} run`);

/// The same for another target, built in the checkout first.
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const host = windows ? `${arch}-w64-mingw32` : process.platform === "darwin" ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
const cross = windows ? `${arch}-unknown-linux-gnu` : process.platform === "darwin" ? `${arch}-unknown-linux-gnu` : `${arch}-w64-mingw32`;
const crossArgs = ["build", `--platforms=@xclang//platforms:${cross}`, ...cache, ...TARGETS];
bazel(path.join(common.ROOT, "tests", "bazel"), crossArgs);
const crossed = bazel(tests, crossArgs);
check(crossed.executed === 0 && crossed.hits > 0,
  `another checkout, for ${cross}: ${crossed.hits} actions from the disk cache, ${crossed.executed} run`);
const external = path.join(run(tests, ["info", "output_base"]).stdout.trim(), "external");
const fetched = fs.readdirSync(external)
  .map((name) => /^[^@].*\+(xclang|libclang|libclang_asan)_(\w+-(?:unknown-linux-gnu|w64-mingw32|apple-darwin))$/.exec(name))
  .filter((m) => m !== null).map((m) => `${m[1]}_${m[2]}`).sort();
check(fetched.every((r) => r === `xclang_${host}` || [host, cross].includes(r.replace(/^libclang(_asan)?_/, ""))),
  `fetched for ${host} and ${cross}: ${fetched.join(", ")}`);
if (process.platform !== "darwin") {
  const macos = run(tests, ["build", "--platforms=@xclang//platforms:aarch64-apple-darwin", "//c:c_test"]);
  check(macos.status !== 0 && macos.stderr.includes("xclang builds for macOS on macOS hosts only"),
    "a macOS target off macOS: the build fails with why");
}

/// tests/bazel elsewhere on the module at the release's version, from where
/// `override` (in place of local_path_override) says; built, then gone.
/// (Windows checkouts have CRLF line ends.)
const versionsBzl = path.join(copy, "packages", "bazel", "bazel", "versions.bzl");
const versions = fs.readFileSync(versionsBzl, "utf8").replaceAll("\r\n", "\n");
const version = /^VERSION = "(.+)"$/m.exec(versions)?.[1];
if (!version) common.fail(`no VERSION in ${versionsBzl}`);
function consumer(name: string, override: string, args: string[]): Processes {
  const dir = path.join(path.dirname(copy), name);
  fs.cpSync(tests, dir, {
    recursive: true,
    filter: (src) => !/^(bazel-.*|MODULE\.bazel\.lock)$/.test(path.relative(tests, src)),
  });
  const module = fs.readFileSync(path.join(dir, "MODULE.bazel"), "utf8").replaceAll("\r\n", "\n");
  const local = /^local_path_override\([^)]*\)\n/m;
  if (!local.test(module)) common.fail("no local_path_override in tests/bazel/MODULE.bazel");
  fs.writeFileSync(path.join(dir, "MODULE.bazel"), module.replace(local, override)
    .replace(/^(bazel_dep\(name = "xclang", version = )"[^"]*"/m, `$1"${version}"`));
  const processes = bazel(dir, args);
  run(dir, ["clean", "--expunge"]);
  return processes;
}

/// The registry's files for the archive (bazel.clice.io's have the same),
/// from versions.bzl's digests as the release's SHA256SUMS.
const registry = path.join(path.dirname(copy), "registry");
const entry = path.join(registry, "modules", "xclang", version);
fs.mkdirSync(entry, { recursive: true });
const releaseSums = path.join(path.dirname(copy), "SHA256SUMS");
fs.writeFileSync(releaseSums, [...versions.matchAll(/^    "(\S+)": "([0-9a-f]{64})",$/gm)].map((m) => `${m[2]}  ${m[1]}\n`).join(""));
const work = path.join(copy, "work");
const integrity = /^integrity (\S+)$/m.exec(common.capture(process.execPath,
  [path.join(copy, "scripts", "bazel.ts"), "archive", releaseSums, registry], { env: { ...process.env, XCLANG_WORK: work } }))?.[1];
if (!integrity) common.fail("no integrity from scripts/bazel.ts archive");
fs.copyFileSync(path.join(work, "bazel-module", `xclang-bazel-${version}`, "MODULE.bazel"), path.join(entry, "MODULE.bazel"));
fs.writeFileSync(path.join(registry, "bazel_registry.json"), `{"mirrors": []}\n`);
fs.writeFileSync(path.join(registry, "modules", "xclang", "metadata.json"), JSON.stringify({ versions: [version], yanked_versions: {} }));
fs.writeFileSync(path.join(entry, "source.json"), JSON.stringify({
  integrity,
  strip_prefix: `xclang-bazel-${version}`,
  url: pathToFileURL(path.join(registry, `xclang-bazel-${version}.tar.gz`)).href,
}));
const registered = consumer("registry-consumer", "", ["build", ...cache,
  `--registry=${pathToFileURL(registry).href}`, "--registry=https://bcr.bazel.build/", ...TARGETS]);
check(registered.executed === 0 && registered.hits > 0,
  `the registry's archive: ${registered.hits} actions from the disk cache, ${registered.executed} run`);

/// git_override of the checkout's HEAD, a local repository for its remote.
const head = common.capture("git", ["-C", common.ROOT, "rev-parse", "HEAD"]).trim();
const same = common.capture("git", ["-C", common.ROOT, "show", "HEAD:packages/bazel/bazel/versions.bzl"]) === versions;
const remote = common.ROOT.replaceAll("\\", "/");
const overridden = consumer("git-consumer", `git_override(
    module_name = "xclang",
    remote = "${remote}",
    commit = "${head}",
    strip_prefix = "packages/bazel",
)
`, ["build", ...cache, ...PROGRAMS]);
check(overridden.hits + overridden.executed > 0 && (!same || overridden.executed === 0),
  `git_override, strip_prefix = "packages/bazel": ${overridden.hits} actions from the disk cache, ` +
  `${overridden.executed} run${same ? "" : " (HEAD names another release)"}`);

const sums = path.join(copy, "SHA256SUMS");
const response = await fetch(`https://github.com/clice-io/xclang/releases/download/${values.previous}/SHA256SUMS`);
if (!response.ok) common.fail(`no SHA256SUMS for ${values.previous}: ${response.status}`);
fs.writeFileSync(sums, await response.text());
common.run(process.execPath, [path.join(copy, "scripts", "bazel.ts"), "versions", sums]);
/// Releases before 23.1.2.5 link macOS programs with the system's ld, which
/// this module no longer points at their libLTO.dylib: libclang's ThinLTO
/// bitcode does not link with them.
const older = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  const i = x!.findIndex((n, k) => n !== y![k]);
  return i >= 0 && x![i]! < y![i]!;
};
const previousTargets = process.platform === "darwin" && older(values.previous!, "23.1.2.5")
  ? PROGRAMS : TARGETS;
const log = path.join(path.dirname(copy), "previous.json");
const previous = bazel(tests, ["build", ...cache, `--execution_log_json_file=${log}`, ...previousTargets]);
const cached = new Set(spawns(log).filter((s) => s.cacheHit || s.remoteCacheHit).map((s) => s.mnemonic));
check(previous.executed > 0 && [...cached].every((m) => m === "CppAggregateDdi" || m === "CppGenModmap"),
  `xclang ${values.previous}: ${previous.executed} actions run, ${previous.hits} from the disk cache (${[...cached].join(", ") || "none"})`);

/// The link of a program in an optimized build, with and without the feature.
const gc = (features: string[]): boolean => {
  const result = run(tests, ["aquery", "-c", "opt", ...features, 'mnemonic("CppLink", //cpp:hello)']);
  if (result.status !== 0) common.fail(`bazel aquery failed: ${result.stderr}`);
  return result.stdout.includes("-Wl,--gc-sections");
};
if (process.platform === "linux") {
  check(gc([]) && !gc(["--features=-gc_sections"]), "--gc-sections in optimized links, unless -gc_sections");
} else if (windows) {
  check(!gc([]) && gc(["--features=gc_sections"]), "no --gc-sections in optimized links, unless gc_sections");
}

if (!windows) {
  /// The release of the module again, fetched already: only the actions differ.
  fs.writeFileSync(versionsBzl, versions);
  /// What the sandbox costs any action: as many that read nothing.
  fs.mkdirSync(path.join(tests, "baseline"));
  fs.writeFileSync(path.join(tests, "baseline", "BUILD.bazel"),
    [...Array(40).keys()].map((i) => `genrule(name = "g${i}", outs = ["g${i}.txt"], cmd = "echo ${i} > $@")\n`).join(""));
  const timed = (strategy: string, targets: string[]): Processes => {
    bazel(tests, ["clean"]);
    return bazel(tests, ["build", "--jobs=1", `--spawn_strategy=${strategy}`, ...targets]);
  };
  const cost = (targets: string[]): string => {
    const sandboxed = timed("sandboxed", targets);
    const local = timed("local", targets);
    const ms = ((sandboxed.seconds - local.seconds) / Math.max(sandboxed.executed, 1)) * 1000;
    return `${sandboxed.executed} actions, ${sandboxed.seconds.toFixed(1)} s in the sandbox and ` +
      `${local.seconds.toFixed(1)} s outside it: ${ms.toFixed(0)} ms per action`;
  };
  check(true, `one at a time, the programs: ${cost(PROGRAMS)}; actions without inputs: ${cost(["//baseline:all"])}`);
}

/// 7. The linker's ThinLTO cache on //libclang:libclang_test's link of
/// libclang's bitcode, beside where docs/en/integrations/bazel.md puts it.
{
  const workspace = path.join(common.ROOT, "tests", "bazel");
  const dir = windows ? "C:/xclang-thinlto-tests" : "/var/tmp/xclang-thinlto-tests";
  fs.rmSync(dir, { recursive: true, force: true });
  const flags = [
    `--repo_env=XCLANG_THINLTO_CACHE=${dir}`,
    ...(process.platform === "linux" ? [`--sandbox_writable_path=${dir}`] : []),
    /// Windows programs differ by their timestamp alone otherwise.
    ...(windows ? ["--linkopt=-Wl,--no-insert-timestamp"] : []),
  ];
  const program = path.join(workspace, "bazel-bin", "libclang", `libclang_test${windows ? ".exe" : ""}`);
  /// The program linked again (its output removed), and the link's time.
  const link = (features: string[]): { seconds: number; bytes: Buffer; executed: number } => {
    if (fs.existsSync(program)) {
      fs.chmodSync(program, 0o755);
      fs.rmSync(program);
    }
    const processes = bazel(workspace, ["build", ...flags, ...features, "//libclang:libclang_test"]);
    return { seconds: processes.seconds, bytes: fs.readFileSync(program), executed: processes.executed };
  };
  /// The cache's entries and their times: an entry written again is a miss.
  const entries = (): Map<string, number> => new Map(fs.readdirSync(dir).filter((f) => f.startsWith("llvmcache-"))
    .map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
  const none = link(["--features=-thinlto_cache"]);
  check(fs.existsSync(dir) && entries().size === 0, `XCLANG_THINLTO_CACHE: ${dir} made by the module, empty without the feature`);
  const cold = link([]);
  const filled = entries();
  const warm = link([]);
  const missed = [...entries()].filter(([f, t]) => filled.get(f) !== t).length;
  check(filled.size > 0 && missed === 0 && warm.executed === 1,
    `ThinLTO cache: libclang_test linked in ${none.seconds.toFixed(1)} s without it, ${cold.seconds.toFixed(1)} s cold ` +
    `(${filled.size} entries), ${warm.seconds.toFixed(1)} s warm (${warm.executed} actions, ${missed} entries written again)`);
  const same = cold.bytes.equals(none.bytes) && warm.bytes.equals(none.bytes);
  check(same, `ThinLTO cache: the program ${same ? "the same" : "differs"} with and without it`);
  fs.rmSync(dir, { recursive: true, force: true });
  bazel(workspace, ["build", ...flags, "//libclang:libclang_test"]);
  check(fs.existsSync(dir), `ThinLTO cache: ${dir} made again once gone`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/// 8. Debug symbols: tests/bazel/symbols' programs, not stripped, with
/// xclang_debug_symbols' GSYM (and on macOS the dSYM of the link), read by
/// the toolchain's llvm-gsymutil (@xclang//bazel:llvm-gsymutil, through
/// bazel run): main at its line of hello.cpp, and in the tool on libclang
/// the code ThinLTO generated from libclang's Lexer.cpp. Each the same file
/// when made again. Also for the target of another os.
{
  const workspace = path.join(common.ROOT, "tests", "bazel");
  const symbols = ["--strip=never", "//symbols:hello_symbols", "//symbols:hello_icf_symbols", "//symbols:lexer_symbols"];
  const other = bazel(workspace, ["build", `--platforms=@xclang//platforms:${cross}`, ...symbols]);
  check(other.executed > 0, `debug symbols: GSYM of the programs for ${cross}`);
  bazel(workspace, ["build", ...symbols]);
  const bin = path.join(workspace, "bazel-bin", "symbols");
  const digest = (program: string) => createHash("sha256").update(fs.readFileSync(path.join(bin, `${program}.gsym`))).digest("hex");
  const digests = ["hello", "hello_icf", "lexer"].map(digest);
  const programs = [
    ["hello", /hello\.cpp:9\b/, "main at hello.cpp:9"],
    ["hello_icf", /twin_a[\s\S]*twin_b|twin_b[\s\S]*twin_a/, "main and both functions identical code folding merged"],
    ["lexer", /clang[\\/]lib[\\/]Lex[\\/]Lexer\.cpp/, "main and libclang's Lexer.cpp"],
  ] as const;
  for (const [program, wanted, what] of programs) {
    const dump = run(workspace, ["run", "@xclang//bazel:llvm-gsymutil", "--", path.join(bin, `${program}.gsym`)]);
    const dsym = process.platform !== "darwin" ||
      fs.existsSync(path.join(bin, `${program}.dSYM`, "Contents", "Resources", "DWARF", program));
    check(dump.status === 0 && /"main"/.test(dump.stdout) && wanted.test(dump.stdout) && dsym,
      `debug symbols: ${program}.gsym${process.platform === "darwin" ? ` from ${program}.dSYM` : ""} has ${what}`);
  }
  /// One thread (debug_symbols.bzl): the same GSYM again, made anew once
  /// gone (from no cache but Bazel's own, which runs an action whose output
  /// is missing).
  for (const program of ["hello", "hello_icf", "lexer"]) fs.rmSync(path.join(bin, `${program}.gsym`), { force: true });
  const remade = bazel(workspace, ["build", "--disk_cache=", ...symbols]);
  const again = ["hello", "hello_icf", "lexer"].map(digest);
  check(remade.executed >= 3 && again.every((d, i) => d === digests[i]),
    `debug symbols: the same GSYM files made again (${remade.executed} actions run)`);
}

/// 9. Debug information wherever the build ran: //debug's programs built
/// with -c dbg in another checkout (no disk cache: its own sandboxes and
/// output base) are the same bytes as here, and debuggers find main's line
/// in this repository and greet's in an external one, both relative to the
/// execution root, through bazel-<workspace>: gdb (Linux), lldb with the
/// dSYM and, run in the workspace for the objects of the debug map, without
/// (macOS), llvm-symbolizer (Linux, Windows).
{
  const workspace = path.join(common.ROOT, "tests", "bazel");
  const targets = ["-c", "dbg", "//debug:debugged", "//debug:debugged_no_dsym"];
  bazel(workspace, ["build", ...targets]);
  const other = path.join(path.dirname(copy), "debug-checkout");
  fs.cpSync(common.ROOT, other, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const name = path.basename(src);
      return ![".git", "work", "node_modules", ".pixi"].includes(name) && !name.startsWith("bazel-");
    },
  });
  const otherTests = path.join(other, "tests", "bazel");
  bazel(otherTests, ["build", ...targets]);
  const programs = ["debugged", "debugged_no_dsym"].map((p) => `debug/${p}${windows ? ".exe" : ""}`);
  if (process.platform === "darwin") programs.push("debug/debugged.dSYM/Contents/Resources/DWARF/debugged");
  const binary = (ws: string, file: string) => fs.readFileSync(path.join(ws, "bazel-bin", file));
  const differ = programs.filter((p) => !binary(workspace, p).equals(binary(otherTests, p)));
  check(differ.length === 0, `-c dbg in another checkout: ${programs.join(", ")} ` +
    (differ.length ? `differ: ${differ.join(", ")}` : "the same bytes"));
  run(otherTests, ["clean", "--expunge"]);

  const sources = path.join(workspace, `bazel-${path.basename(workspace)}`);
  const external = path.join(run(workspace, ["info", "output_base"]).stdout.trim(), "external");
  const toolchain = path.join(external, fs.readdirSync(external).find((name) => name.endsWith(`+xclang_${host}`)) ?? "");
  const bin = path.join(workspace, "bazel-bin", "debug");
  /// Both lines, by their comments, in what a debugger printed.
  const lines = (output: string) => output.includes("main's line") && output.includes("the greeter's line");
  const debug = (label: string, cmd: string, args: string[], cwd: string) => {
    const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    check(result.status === 0 && lines(output), `${label}: main's and greet's lines` +
      (lines(output) ? "" : `, not in:\n${output.slice(-2000)}`));
  };
  if (process.platform === "linux") {
    debug("gdb, directory bazel-<workspace>", "gdb", ["-batch", "-nx", "-ex", `directory ${sources}`,
      "-ex", "list main", "-ex", "list greet", path.join(bin, "debugged")], workspace);
  }
  if (process.platform === "darwin") {
    const lldb = ["--batch", "-o", `settings set target.source-map . ${sources}`, "-o", "source list -n main", "-o", "source list -n greet"];
    debug("lldb with the dSYM, source-map . bazel-<workspace>", "lldb", [...lldb, path.join(bin, "debugged")], os.tmpdir());
    debug("lldb without a dSYM, in the workspace", "lldb", [...lldb, path.join(bin, "debugged_no_dsym")], workspace);
  }
  if (process.platform !== "darwin") {
    /// The addresses of main and greet, and the files and lines of them.
    const exe = windows ? ".exe" : "";
    const program = path.join(bin, `debugged${exe}`);
    const nm = spawnSync(path.join(toolchain, "bin", `llvm-nm${exe}`), ["--defined-only", program], { encoding: "utf8" }).stdout ?? "";
    const addresses = ["main", "_Z5greetPKc"].map((name) => new RegExp(`^([0-9a-f]+) T ${name}$`, "m").exec(nm)?.[1]);
    const symbolized = spawnSync(path.join(toolchain, "bin", `llvm-symbolizer${exe}`),
      ["--obj", program, ...addresses.map((a) => `0x${a}`)], { encoding: "utf8" }).stdout ?? "";
    /// Relative to the compilation directory, ".": ./debug/main.cpp.
    const files = [...symbolized.matchAll(/^(.+):(\d+):\d+$/gm)].map((m) => m[1]!.replaceAll("\\", "/").replace(/^\.\//, ""));
    const found = files.filter((f) => !path.isAbsolute(f) && fs.existsSync(path.join(sources, f)));
    check(addresses.every(Boolean) && found.some((f) => f === "debug/main.cpp") && found.some((f) => f.endsWith("/greeter.cpp") && f.startsWith("external/")),
      `llvm-symbolizer: main in debug/main.cpp, greet in external/.../greeter.cpp, both under bazel-<workspace> (${files.join(", ")})`);
  }
}

/// 10. A release's strip by the target's object format: //cpp:hello with
/// -c dbg has debug information, its .stripped none; a Mach-O one keeps no
/// defined symbol but its header's (Apple's strip, not -x), an ELF or COFF
/// one fewer, those relocations need. For this host's target, run too, and
/// for another os's, built here.
{
  const workspace = path.join(common.ROOT, "tests", "bazel");
  const exe = windows ? ".exe" : "";
  const tool = (name: string) => path.join(toolchainDir(workspace), "bin", `${name}${exe}`);
  for (const [target, platforms] of [[host, []], [cross, [`--platforms=@xclang//platforms:${cross}`]]] as const) {
    bazel(workspace, ["build", "-c", "dbg", ...platforms, "//cpp:hello", "//cpp:hello.stripped"]);
    /// <name>.stripped next to the program (hello.exe on Windows).
    const program = path.join(workspace, run(workspace, ["cquery", "-c", "dbg", ...platforms, "--output=files", "//cpp:hello"]).stdout.trim());
    const stripped = path.join(path.dirname(program), "hello.stripped");
    const sections = (file: string) => spawnSync(tool("llvm-objdump"), ["--section-headers", file], { encoding: "utf8" }).stdout ?? "";
    const debug = (file: string) => /\s(\.debug_info|__debug_info|\.zdebug_info)\s/.test(sections(file));
    /// Defined symbols; a Mach-O program keeps its header's, which dyld uses.
    const defined = (file: string) => (spawnSync(tool("llvm-nm"), ["--defined-only", file], { encoding: "utf8" }).stdout ?? "")
      .split("\n").filter((l) => l.trim() && !/ __mh_execute_header$/.test(l)).length;
    const macho = target.includes("apple");
    const ok = (macho || debug(program)) && !debug(stripped) && (macho ? defined(stripped) === 0 : defined(stripped) < defined(program));
    let runs = "";
    if (target === host) {
      const result = spawnSync(stripped, [], { encoding: "utf8" });
      runs = result.status === 0 && /hello from xclang/.test(result.stdout ?? "") ? ", and runs" : ", but does not run";
    }
    check(ok && !runs.includes("not"), `strip for ${target}: hello.stripped has no debug information and ` +
      `${defined(stripped)} defined symbols of hello's ${defined(program)}${runs}`);
  }
}

/// 11. @libclang follows --features=asan: the ASan build's libraries and
/// resource directory where xclang has one (the tests too), and where it has
/// none a build that says so.
{
  const workspace = path.join(common.ROOT, "tests", "bazel");
  const inputs = (features: string[], target: string) =>
    run(workspace, ["aquery", ...features, `mnemonic("CppLink|Symlink", ${target})`]).stdout;
  const asanBuild = (text: string) => /libclang_asan_/.test(text);
  if (["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"].includes(host)) {
    const plain = inputs([], "//libclang:libclang_test") + inputs([], "//libclang:resource_dir");
    const asan = inputs(["--features=asan"], "//libclang:libclang_test") + inputs(["--features=asan"], "//libclang:resource_dir");
    check(!asanBuild(plain) && asanBuild(asan), "--features=asan: @libclang's libraries and resource directory are the ASan build's");
    bazel(workspace, ["test", "--features=asan", "//libclang:libclang_test", "//libclang:bin/resource_dir_test"]);
    check(true, "--features=asan: libclang_test and resource_dir_test on @libclang pass");
  } else {
    const result = run(workspace, ["build", "--nobuild", "--features=asan", "//libclang:libclang_test"]);
    check(result.status !== 0 && /has no ASan libclang/.test(result.stderr ?? ""),
      "--features=asan: no ASan libclang for this host's target, and the build says so");
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bazel: ${process.platform} ${process.arch}\n\n| | |\n|---|---|\n${report.join("\n")}\n\n`);
}
