/// Experiment (exp/musl-hosts only): the frontend alone, as clice runs it.
/// clang -fsyntax-only over large translation units, clang's heaviest Sema
/// and AST sources (against a libclang archive's headers), and over
/// abseil's library sources, by each compiler (LD_PRELOAD for some).
/// Interleaved rounds; per file the median seconds and peak RSS (MB).
///
///   node exp/split/frontend.ts --libclang <dir> --compiler name=<clang++> ... [--preload name=<lib>] [--rounds n] [--out f.json]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";

const { values } = parseArgs({
  options: {
    libclang: { type: "string" },
    compiler: { type: "string", multiple: true, default: [] },
    preload: { type: "string", multiple: true, default: [] },
    /// name=KEY=VALUE: an environment variable for that compiler.
    env: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    out: { type: "string", default: "frontend.json" },
  },
});
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const target = `--target=${arch}-unknown-linux-gnu`;
const libclang = path.resolve(values.libclang!);
const compilers = values.compiler.map((s) => {
  const name = s.slice(0, s.indexOf("="));
  const preload = values.preload.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);
  const vars = Object.fromEntries(values.env.filter((e) => e.startsWith(`${name}=`))
    .map((e) => e.slice(name.length + 1)).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  if (preload) vars.LD_PRELOAD = preload;
  return { name, path: s.slice(s.indexOf("=") + 1), env: Object.keys(vars).length ? { ...process.env, ...vars } : undefined };
});

const llvm = path.join(common.WORK, "src", "llvm-frontend");
if (!fs.existsSync(llvm)) {
  common.extract(await common.fetchSource("llvm-project"), llvm, (m) => /^clang\/lib\/(Sema|AST)\//.test(m));
}
const abseil = path.join(common.WORK, "src", "abseil");
if (!fs.existsSync(abseil)) common.extract(await common.fetchSource("abseil"), abseil);

interface Item { suite: string; file: string; args: string[] }
const sema = ["Sema/SemaExpr.cpp", "Sema/SemaDecl.cpp", "Sema/SemaDeclCXX.cpp", "Sema/SemaTemplate.cpp",
  "Sema/SemaTemplateInstantiate.cpp", "Sema/SemaTemplateInstantiateDecl.cpp", "Sema/SemaExprCXX.cpp",
  "Sema/SemaChecking.cpp", "Sema/SemaOpenMP.cpp", "Sema/SemaOverload.cpp", "AST/ASTContext.cpp", "AST/ExprConstant.cpp"];
const llvmArgs = ["-std=c++17", "-fno-rtti", `-I${path.join(llvm, "clang", "lib", "Sema")}`, `-I${path.join(llvm, "clang", "lib", "AST")}`,
  `-I${path.join(libclang, "include")}`, "-D_GNU_SOURCE", "-D__STDC_CONSTANT_MACROS", "-D__STDC_FORMAT_MACROS", "-D__STDC_LIMIT_MACROS"];
const candidates: Item[] = [
  ...sema.map((f) => ({ suite: "clang", file: path.join(llvm, "clang", "lib", f), args: llvmArgs })),
  ...fs.readdirSync(path.join(abseil, "absl"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".cc"))
    .filter((f) => !/(_test|test_|_benchmark|benchmark|testing|mock|matchers|_win|win32|_testutil)/.test(f))
    .sort()
    .map((f) => ({ suite: "abseil", file: path.join(abseil, "absl", f), args: ["-std=c++17", `-I${abseil}`] })),
];

/// Seconds and peak RSS (MB) of one parse, or undefined when it fails.
function parse(c: (typeof compilers)[number], item: Item): [number, number] | undefined {
  const start = process.hrtime.bigint();
  const r = spawnSync("/usr/bin/time", ["-f", "rss %M", c.path, target, ...item.args, "-fsyntax-only", item.file],
    { encoding: "utf8", env: c.env });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  if (r.status !== 0) {
    console.log(`${c.name} ${path.basename(item.file)} failed:\n${(r.stderr ?? "").slice(0, 1500)}`);
    return undefined;
  }
  return [seconds, Number(/rss (\d+)/.exec(r.stderr ?? "")?.[1] ?? 0) / 1024];
}

/// The files that the first compiler parses.
const items = candidates.filter((item) => parse(compilers[0]!, item) !== undefined);
console.log(`${items.filter((i) => i.suite === "clang").length} clang sources, ${items.filter((i) => i.suite === "abseil").length} abseil sources`);

const times: Record<string, [number, number][][]> = {};
for (const c of compilers) times[c.name] = items.map(() => []);
for (let round = 0; round < Number(values.rounds); round++) {
  const order = compilers.map((_, i) => compilers[(i + round) % compilers.length]!);
  for (const c of order) {
    const start = Date.now();
    items.forEach((item, i) => { const t = parse(c, item); if (t) times[c.name]![i]!.push(t); });
    console.log(`round ${round + 1}: ${c.name} ${Math.round((Date.now() - start) / 1000)} s`);
  }
}
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/// Per suite and compiler: the sum of the files' median seconds, and the
/// median and the largest of the files' median peak RSS.
const results: Record<string, Record<string, { seconds: number; rss: number; maxRss: number }>> = {};
const lines = [`### frontend: ${arch} (${os.cpus()[0]?.model ?? "?"}, ${os.availableParallelism()} threads)`, "",
  `| suite | | ${compilers.map((c) => c.name).join(" | ")} |`, `|---|---|${compilers.map(() => "---|").join("")}`];
for (const suite of ["clang", "abseil"]) {
  const indices = items.map((it, i) => [it, i] as const).filter(([it]) => it.suite === suite).map(([, i]) => i)
    .filter((i) => compilers.every((c) => times[c.name]![i]!.length));
  results[suite] = {};
  for (const c of compilers) {
    const perFile = indices.map((i) => [median(times[c.name]![i]!.map((t) => t[0])), median(times[c.name]![i]!.map((t) => t[1]))]);
    results[suite]![c.name] = { seconds: perFile.reduce((s, f) => s + f[0]!, 0), rss: median(perFile.map((f) => f[1]!)), maxRss: Math.max(...perFile.map((f) => f[1]!)) };
  }
  const base = results[suite]![compilers[0]!.name]!;
  const cell = (k: "seconds" | "rss" | "maxRss") => compilers.map((c) => {
    const v = results[suite]![c.name]![k];
    return `${v.toFixed(k === "seconds" ? 1 : 0)} (${(v / base[k]).toFixed(3)})`;
  }).join(" | ");
  lines.push(`| ${suite} (${indices.length}) | s | ${cell("seconds")} |`, `| | median MB | ${cell("rss")} |`, `| | largest MB | ${cell("maxRss")} |`);
}
lines.push("");
console.log(lines.join("\n"));
fs.writeFileSync(values.out!, JSON.stringify({ arch, compilers: compilers.map((c) => ({ name: c.name })), results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
