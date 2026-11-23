/// Experiment (exp/mimalloc-hosts only): lld's speed and peak memory, as
/// clice links, on every host. A tool on libclang (clang::tooling,
/// SyntaxOnlyAction), compiled once with ThinLTO, linked against a libclang
/// archive of this machine's native target by each compiler's lld, with no
/// ThinLTO cache: lld and the LTO backends on its threads. The link is the
/// one `clang++ -###` names, run directly (on Windows `llvm.exe ld.lld`,
/// not the launcher), so that its peak memory is lld's. Interleaved
/// rounds; medians.
///
///   node exp/mimalloc/link.ts --peak <peak> --libclang <dir> --compiler name=<clang++> ...
///     [--llvm name=<llvm.exe>] [--rounds n] [--out f.json]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { compilers as parseCompilers, machine, measure, median, native, windows } from "./measure.ts";

const { values } = parseArgs({
  options: {
    peak: { type: "string" },
    libclang: { type: "string" },
    compiler: { type: "string", multiple: true, default: [] },
    /// name=<llvm.exe>: run that compiler's lld as `llvm.exe ld.lld`.
    llvm: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    out: { type: "string", default: "link.json" },
  },
});
const peak = path.resolve(values.peak!);
const libclang = path.resolve(values.libclang!);
const compilers = parseCompilers(values.compiler, []);
const target = `--target=${native}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "link-bench-"));

const main = path.join(scratch, "main.cpp");
fs.writeFileSync(main, `#include "clang/Frontend/FrontendActions.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/raw_ostream.h"
int main() {
  bool ok = clang::tooling::runToolOnCode(std::make_unique<clang::SyntaxOnlyAction>(),
      "template <int N> struct F { static constexpr int v = N * F<N - 1>::v; };"
      "template <> struct F<0> { static constexpr int v = 1; };"
      "static_assert(F<10>::v == 3628800);", "input.cpp");
  llvm::outs() << (ok ? "ok" : "failed") << "\\n";
  return ok ? 0 : 1;
}
`);
const object = path.join(scratch, "main.o");
const cc = spawnSync(compilers[0]!.path, [target, "-std=c++17", "-fno-rtti", "-O2", "-flto=thin",
  `-I${path.join(libclang, "include")}`, "-c", main, "-o", object], { stdio: "inherit" });
if (cc.status !== 0) process.exit(1);
const lib = path.join(libclang, "lib");
const libs = fs.readdirSync(lib).filter((f) => f.endsWith(".a")).sort().map((f) => path.join(lib, f));
const system = process.platform === "linux" ? ["-lpthread", "-ldl", "-lrt", "-lm"]
  : windows ? ["-lpsapi", "-lshell32", "-lole32", "-loleaut32", "-luuid", "-ladvapi32", "-lws2_32", "-lntdll", "-lversion"]
  : ["-lz"];
const group = process.platform === "linux" ? ["-Wl,--start-group", ...libs, "-Wl,--end-group"] : libs;

/// The link command of `clang++ -###`, its arguments unquoted.
function linkCommand(c: { name: string; path: string }, exe: string): string[] {
  const r = spawnSync(c.path, [target, "-flto=thin", "-fuse-ld=lld", object, ...group, ...system, "-o", exe, "-###"],
    { encoding: "utf8" });
  const line = (r.stderr ?? "").trim().split("\n").pop()!;
  const args = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, "$1"));
  const llvm = values.llvm.find((l) => l.startsWith(`${c.name}=`))?.slice(c.name.length + 1);
  if (llvm && /ld\.lld(\.exe)?$/i.test(args[0]!)) return [llvm, "ld.lld", ...args.slice(1)];
  return args;
}

const times: Record<string, { seconds: number[]; mib: number[]; failed: number }> = {};
for (const c of compilers) times[c.name] = { seconds: [], mib: [], failed: 0 };
for (let round = 0; round < Number(values.rounds); round++) {
  const order = compilers.map((_, i) => compilers[(i + round) % compilers.length]!);
  for (const c of order) {
    const exe = path.join(scratch, `tool-${c.name}${windows ? ".exe" : ""}`);
    fs.rmSync(exe, { force: true });
    const [program, ...args] = linkCommand(c, exe);
    if (round === 0) console.log(`${c.name}: ${program} ${args.slice(0, 3).join(" ")} ... (${args.length} arguments)`);
    const r = measure(peak, program!, args);
    if ("error" in r) {
      console.log(`${c.name}: link failed: ${r.error}`);
      times[c.name]!.failed++;
      continue;
    }
    times[c.name]!.seconds.push(r.seconds);
    times[c.name]!.mib.push(r.mib);
    const run = spawnSync(exe, [], { encoding: "utf8" });
    if ((run.stdout ?? "").trim() !== "ok") console.log(`${c.name}: the tool says ${run.stdout} ${run.stderr}`);
    console.log(`round ${round + 1}: ${c.name} ${r.seconds.toFixed(1)} s, ${r.mib.toFixed(0)} MiB`);
  }
}
const base = compilers[0]!.name;
const row = (k: "seconds" | "mib") => compilers.map((c) => {
  const v = median(times[c.name]![k]);
  return `${v.toFixed(k === "seconds" ? 2 : 0)} (${(v / median(times[base]![k])).toFixed(3)})`;
});
const lines = [
  `### link: ${machine}`, "",
  `| | ${compilers.map((c) => c.name).join(" | ")} |`, `|---|${compilers.map(() => "---|").join("")}`,
  `| s | ${row("seconds").join(" | ")} |`, `| MiB | ${row("mib").join(" | ")} |`,
  `| failed | ${compilers.map((c) => times[c.name]!.failed).join(" | ")} |`, "",
];
console.log(lines.join("\n"));
fs.writeFileSync(values.out!, JSON.stringify({ native, compilers: compilers.map((c) => c.name), times }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
