/// Experiment (exp/musl-hosts only; exp/musl/link.ts with --preload): lld's speed, as clice links. A tool on
/// libclang (clang::tooling, SyntaxOnlyAction) linked with ThinLTO against
/// a libclang archive of this machine's glibc target, by each compiler's
/// clang++ and lld: cold (an empty ThinLTO cache: lld and the LTO backends
/// on its threads) and warm (the cache full: mostly lld). Interleaved
/// rounds; seconds and peak RSS (MB), medians.
///
///   node exp/split/link.ts --libclang <dir> --compiler name=<clang++> ... [--cold n] [--warm n] [--out f.json]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    libclang: { type: "string" },
    compiler: { type: "string", multiple: true, default: [] },
    cold: { type: "string", default: "2" },
    warm: { type: "string", default: "3" },
    out: { type: "string", default: "link.json" },
    /// name=<library>: LD_PRELOAD for that compiler.
    preload: { type: "string", multiple: true, default: [] },
  },
});
const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
const target = `--target=${arch}-unknown-linux-gnu`;
const libclang = path.resolve(values.libclang!);
const compilers = values.compiler.map((s) => {
  const name = s.slice(0, s.indexOf("="));
  const preload = values.preload.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);
  return { name, path: s.slice(s.indexOf("=") + 1), env: preload ? { ...process.env, LD_PRELOAD: preload } : undefined };
});
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
const cc = spawnSync(compilers[0]!.path, [target, "-std=c++17", "-fno-rtti", "-O2", "-flto=thin", `-I${path.join(libclang, "include")}`,
  "-c", main, "-o", object], { stdio: "inherit" });
if (cc.status !== 0) process.exit(1);
const libs = fs.readdirSync(path.join(libclang, "lib")).filter((f) => f.endsWith(".a")).map((f) => path.join(libclang, "lib", f));

/// Seconds and peak RSS of one link, or undefined when it fails.
function link(c: { name: string; path: string; env?: NodeJS.ProcessEnv }, cache: string): [number, number] | undefined {
  const exe = path.join(scratch, `tool-${c.name}`);
  const args = [target, "-flto=thin", "-fuse-ld=lld", object, "-Wl,--start-group", ...libs, "-Wl,--end-group",
    "-lpthread", "-ldl", "-lrt", "-lm", `-Wl,--thinlto-cache-dir=${cache}`, "-o", exe];
  const start = process.hrtime.bigint();
  const r = spawnSync("/usr/bin/time", ["-f", "rss %M", c.path, ...args], { encoding: "utf8", env: c.env });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  const rss = Number(/rss (\d+)/.exec(r.stderr ?? "")?.[1] ?? 0) / 1024;
  if (r.status !== 0) {
    console.log(`${c.name}: link failed (${r.status} ${r.signal}):\n${(r.stderr ?? "").slice(-3000)}`);
    return undefined;
  }
  const run = spawnSync(exe, [], { encoding: "utf8" });
  if (run.stdout.trim() !== "ok") console.log(`${c.name}: the tool says ${run.stdout} ${run.stderr}`);
  return [seconds, rss];
}

const times: Record<string, { cold: [number, number][]; warm: [number, number][]; failed: number }> = {};
for (const c of compilers) times[c.name] = { cold: [], warm: [], failed: 0 };
const rounds = Math.max(Number(values.cold), 1);
for (let round = 0; round < rounds; round++) {
  const order = compilers.map((_, i) => compilers[(i + round) % compilers.length]!);
  for (const c of order) {
    const cache = path.join(scratch, `cache-${c.name}-${round}`);
    const cold = link(c, cache);
    if (!cold) { times[c.name]!.failed++; continue; }
    if (round < Number(values.cold)) times[c.name]!.cold.push(cold);
    for (let w = 0; w < Number(values.warm); w++) {
      const warm = link(c, cache);
      if (warm) times[c.name]!.warm.push(warm); else times[c.name]!.failed++;
    }
    fs.rmSync(cache, { recursive: true, force: true });
    console.log(`round ${round + 1}: ${c.name} cold ${cold[0].toFixed(1)} s, ${cold[1].toFixed(0)} MB`);
  }
}
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const base = compilers[0]!.name;
const row = (kind: "cold" | "warm", i: 0 | 1) => compilers.map((c) => {
  const v = median(times[c.name]![kind].map((t) => t[i]));
  const b = median(times[base]![kind].map((t) => t[i]));
  return `${v.toFixed(i ? 0 : 2)} (${(v / b).toFixed(2)})`;
});
const lines = [
  `### link: ${arch} (${os.cpus()[0]?.model ?? "?"}, ${os.availableParallelism()} threads)`, "",
  `| | ${compilers.map((c) => c.name).join(" | ")} |`, `|---|${compilers.map(() => "---|").join("")}`,
  `| cold s | ${row("cold", 0).join(" | ")} |`, `| cold MB | ${row("cold", 1).join(" | ")} |`,
  `| warm s | ${row("warm", 0).join(" | ")} |`, `| warm MB | ${row("warm", 1).join(" | ")} |`,
  `| failed | ${compilers.map((c) => times[c.name]!.failed).join(" | ")} |`, "",
];
console.log(lines.join("\n"));
fs.writeFileSync(values.out!, JSON.stringify({ arch, compilers, times }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
