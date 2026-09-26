/// Compile speed of several compilers on this machine, for its native
/// target, on code the PGO training never saw:
///
///   fmt   ten of its tests: heavy templates, C++20
///   lua   its C sources
///   std   precompiling libc++'s `import std` module (LLVM 23 compilers)
///
/// each at -fsyntax-only, -O0 -g and -O2. Every file is compiled alone,
/// one after another; rounds interleave the compilers (in a rotating
/// order) and the median of the rounds is reported, per compiler and
/// against the first one.
///
///   node tests/bench.ts --tree <xclang> --compiler name=<clang++> ...
///     [--config name]   give that compiler the tree's config file
///                       (--config=<tree>/bin/<target>.cfg), so that it
///                       sees the same headers as xclang
///     [--system name]   that compiler as it comes, with its own headers
///                       (Apple's clang); it skips the std module
///     [--rounds n] [--out results.json]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../scripts/common.ts";

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    compiler: { type: "string", multiple: true, default: [] },
    config: { type: "string", multiple: true, default: [] },
    system: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    out: { type: "string", default: "bench.json" },
  },
});
if (!values.tree || !values.compiler.length) common.fail("--tree <xclang> --compiler name=<clang++> ...");
const tree = path.resolve(values.tree);
const windows = process.platform === "win32";
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const native = windows ? `${arch}-w64-mingw32`
  : process.platform === "darwin" ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
const target = common.target(native);
const cfg = path.join(tree, "bin", `${common.cfgNames(target)[0]}.cfg`);

interface Compiler { name: string; path: string; args: string[]; system: boolean }
const compilers: Compiler[] = values.compiler.map((spec) => {
  const [name, file] = [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)];
  const system = values.system.includes(name);
  const args = values.config.includes(name) ? ["--no-default-config", `--config=${cfg}`] : [];
  return { name, path: file, args, system };
});

/// The workload, unpacked with the system's tar (bsdtar on Windows).
function unpack(name: "fmt" | "lua"): Promise<string> {
  return common.fetchSource(name).then((archive) => {
    const dest = path.join(common.WORK, "src", name);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      const tar = windows ? "C:\\Windows\\System32\\tar.exe" : "tar";
      common.run(tar, ["-xzf", archive, "-C", dest, "--strip-components=1"]);
    }
    return dest;
  });
}
const fmt = await unpack("fmt");
const lua = await unpack("lua");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-bench-"));
const object = path.join(scratch, "out.o");

interface Item { suite: string; file: string; args: string[]; llvmOnly?: boolean }
const items: Item[] = [];
for (const test of ["args", "chrono", "color", "compile", "format", "ostream", "printf", "ranges", "std", "xchar"]) {
  items.push({
    suite: "fmt",
    file: path.join(fmt, "test", `${test}-test.cc`),
    args: ["-std=c++20", `-I${path.join(fmt, "include")}`, `-I${path.join(fmt, "test")}`, `-I${path.join(fmt, "test", "gtest")}`],
  });
}
for (const file of fs.readdirSync(path.join(lua, "src")).filter((f) => f.endsWith(".c")).sort()) {
  items.push({ suite: "lua", file: path.join(lua, "src", file), args: ["-std=gnu99", "-x", "c"] });
}
const xclang = compilers.find((c) => !c.system && !c.args.length) ?? compilers[0];
const manifest = spawnSync(xclang.path, ["-print-library-module-manifest-path"], { encoding: "utf8" }).stdout.trim();
if (fs.existsSync(manifest)) {
  const std = JSON.parse(fs.readFileSync(manifest, "utf8")).modules.find((m: { "logical-name": string }) => m["logical-name"] === "std");
  items.push({
    suite: "std",
    file: path.resolve(path.dirname(manifest), std["source-path"]),
    args: ["-std=c++23", "-Wno-reserved-module-identifier", "--precompile"],
    llvmOnly: true,
  });
} else {
  console.log(`no module manifest (${manifest}); the std suite is skipped`);
}

const MODES: Record<string, string[]> = { syntax: ["-fsyntax-only"], O0: ["-O0", "-g", "-c"], O2: ["-O2", "-c"] };

/// Seconds for one compile, or undefined when it fails.
function compile(c: Compiler, item: Item, mode: string): number | undefined {
  if (item.llvmOnly && c.system) return undefined;
  const modeArgs = item.suite === "std"
    ? (mode === "syntax" ? [] : MODES[mode].filter((a) => a !== "-c"))
    : MODES[mode];
  if (item.suite === "std" && mode === "syntax") return undefined;
  const out = item.suite === "std" ? path.join(scratch, "std.pcm") : object;
  const args = [...c.args, ...item.args, ...modeArgs, item.file,
    ...(modeArgs.includes("-fsyntax-only") ? [] : ["-o", out])];
  const start = process.hrtime.bigint();
  const result = spawnSync(c.path, args, { encoding: "utf8" });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  if (result.status !== 0) {
    console.log(`${c.name} ${mode} ${path.basename(item.file)} failed:\n${(result.stderr ?? "").slice(0, 1500)}`);
    return undefined;
  }
  return seconds;
}

for (const c of compilers) {
  const version = spawnSync(c.path, [...c.args, "--version"], { encoding: "utf8" }).stdout.split("\n")[0];
  console.log(`${c.name}: ${c.path} ${c.args.join(" ")}\n  ${version}`);
}

/// times[compiler][mode][item] = seconds per round
const rounds = Number(values.rounds);
const times: Record<string, Record<string, (number | undefined)[][]>> = {};
for (const c of compilers) times[c.name] = Object.fromEntries(Object.keys(MODES).map((m) => [m, items.map(() => [])]));
for (let round = 0; round < rounds; round++) {
  const order = compilers.map((_, i) => compilers[(i + round) % compilers.length]);
  for (const c of order) {
    const start = Date.now();
    for (const mode of Object.keys(MODES)) {
      items.forEach((item, i) => times[c.name][mode][i].push(compile(c, item, mode)));
    }
    console.log(`round ${round + 1}: ${c.name} ${Math.round((Date.now() - start) / 1000)} s`);
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/// A suite's time: the sum over the items every compiler that runs the
/// suite compiled in every round, so all compilers are timed on the same
/// files.
const suites = [...new Set(items.map((i) => i.suite))];
const results: Record<string, Record<string, number | undefined>> = {};
const lines = [
  `### ${native} (${os.cpus()[0]?.model ?? "?"}, ${os.availableParallelism()} threads)`, "",
  `median of ${rounds} rounds, seconds; ratio to ${compilers[0].name}`, "",
  `| suite | mode | ${compilers.map((c) => c.name).join(" | ")} |`,
  `|---|---|${compilers.map(() => "---|").join("")}`,
];
for (const suite of suites) {
  for (const mode of Object.keys(MODES)) {
    const indices = items.map((it, i) => [it, i] as const).filter(([it]) => it.suite === suite).map(([, i]) => i);
    const runners = compilers.filter((c) => indices.some((i) => times[c.name][mode][i].every((t) => t !== undefined)));
    if (!runners.length) continue;
    const common_ = indices.filter((i) => runners.every((c) => times[c.name][mode][i].every((t) => t !== undefined)));
    if (!common_.length) continue;
    const row: Record<string, number | undefined> = {};
    for (const c of compilers) {
      if (!runners.includes(c)) continue;
      const perRound = Array.from({ length: rounds }, (_, r) => common_.reduce((s, i) => s + times[c.name][mode][i][r]!, 0));
      row[c.name] = median(perRound);
    }
    results[`${suite} ${mode}`] = row;
    const base = row[compilers[0].name];
    const cells = compilers.map((c) => {
      const t = row[c.name];
      if (t === undefined) return "-";
      return base ? `${t.toFixed(2)} (${(t / base).toFixed(2)})` : t.toFixed(2);
    });
    lines.push(`| ${suite} (${common_.length}) | ${mode} | ${cells.join(" | ")} |`);
  }
}
const table = lines.join("\n") + "\n";
console.log(table);
fs.writeFileSync(values.out!, JSON.stringify({ native, compilers, results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
