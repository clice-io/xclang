/// Experiment (exp/mimalloc-hosts only): the frontend alone, as clice runs
/// it (exp/split/frontend.ts of exp/musl-hosts, on every host): clang
/// -fsyntax-only over clang's heaviest Sema and AST sources (against a
/// libclang archive's headers) and abseil's library sources, by each
/// compiler, for this machine's native target. Interleaved rounds; per
/// suite the sum of the files' median seconds, and the median and largest
/// of their median peak memory.
///
///   node exp/mimalloc/frontend.ts --peak <peak> --libclang <dir> --compiler name=<clang++> ...
///     [--prefix name=arg] [--rounds n] [--out f.json]

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { compilers as parseCompilers, machine, measure, median, native, untar, type Compiler } from "./measure.ts";

const { values } = parseArgs({
  options: {
    peak: { type: "string" },
    libclang: { type: "string" },
    compiler: { type: "string", multiple: true, default: [] },
    prefix: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    out: { type: "string", default: "frontend.json" },
  },
});
const peak = path.resolve(values.peak!);
const libclang = path.resolve(values.libclang!);
const compilers = parseCompilers(values.compiler, values.prefix);

const llvm = path.join(common.WORK, "src", "llvm-frontend");
if (!fs.existsSync(llvm)) {
  const prefix = `llvm-project-${common.LLVM_VERSION}.src`;
  untar(await common.fetchSource("llvm-project"), llvm, [`${prefix}/clang/lib/Sema`, `${prefix}/clang/lib/AST`]);
}
const abseil = path.join(common.WORK, "src", "abseil");
if (!fs.existsSync(abseil)) untar(await common.fetchSource("abseil"), abseil);

interface Item { suite: string; file: string; args: string[] }
const sema = ["Sema/SemaExpr.cpp", "Sema/SemaDecl.cpp", "Sema/SemaDeclCXX.cpp", "Sema/SemaTemplate.cpp",
  "Sema/SemaTemplateInstantiate.cpp", "Sema/SemaTemplateInstantiateDecl.cpp", "Sema/SemaExprCXX.cpp",
  "Sema/SemaChecking.cpp", "Sema/SemaOpenMP.cpp", "Sema/SemaOverload.cpp", "AST/ASTContext.cpp", "AST/ExprConstant.cpp"];
const llvmArgs = ["-std=c++17", "-fno-rtti", `-I${path.join(llvm, "clang", "lib", "Sema")}`, `-I${path.join(llvm, "clang", "lib", "AST")}`,
  `-I${path.join(libclang, "include")}`, "-D__STDC_CONSTANT_MACROS", "-D__STDC_FORMAT_MACROS", "-D__STDC_LIMIT_MACROS"];
const candidates: Item[] = [
  ...sema.map((f) => ({ suite: "clang", file: path.join(llvm, "clang", "lib", f), args: llvmArgs })),
  ...fs.readdirSync(path.join(abseil, "absl"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".cc"))
    .filter((f) => !/(_test|test_|_benchmark|benchmark|testing|mock|matchers|_win|win32|_testutil)/.test(f))
    .sort()
    .map((f) => ({ suite: "abseil", file: path.join(abseil, "absl", f), args: ["-std=c++17", `-I${abseil}`] })),
];

function parse(c: Compiler, item: Item): [number, number] | undefined {
  const r = measure(peak, c.path, [...c.prefix, `--target=${native}`, ...item.args, "-fsyntax-only", item.file]);
  if ("error" in r) {
    console.log(`${c.name} ${path.basename(item.file)} failed: ${r.error.slice(0, 1500)}`);
    return undefined;
  }
  return [r.seconds, r.mib];
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

const results: Record<string, Record<string, { seconds: number; rss: number; maxRss: number }>> = {};
const lines = [`### frontend: ${machine}`, "",
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
  lines.push(`| ${suite} (${indices.length}) | s | ${cell("seconds")} |`, `| | median MiB | ${cell("rss")} |`, `| | largest MiB | ${cell("maxRss")} |`);
}
lines.push("");
console.log(lines.join("\n"));
fs.writeFileSync(values.out!, JSON.stringify({ native, compilers: compilers.map((c) => c.name), results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
