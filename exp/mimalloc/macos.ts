/// Experiment (exp/mimalloc-hosts only): why the macOS arm64 build with
/// mimalloc precompiles libc++'s std module at -O2 in 1.21 times
/// 23.1.5.3's time (exp-mimalloc) while it is faster elsewhere. Each
/// variant (a clang++ and its environment) compiles each workload in
/// interleaved rounds under /usr/bin/time -l; per workload and variant the
/// medians of the wall time, user and system time, peak RSS and footprint,
/// page reclaims and faults, and instructions retired.
///
///   node exp/mimalloc/macos.ts --base <clang++> --mimalloc <clang++> --dylib <libmimalloc.dylib> [--rounds n]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { median } from "./measure.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    mimalloc: { type: "string" },
    dylib: { type: "string" },
    fmt: { type: "string" },
    rounds: { type: "string", default: "7" },
  },
});
const base = values.base!;
const mi = values.mimalloc!;
const variants: { name: string; cxx: string; env: Record<string, string> }[] = [
  { name: "base", cxx: base, env: {} },
  { name: "base+dylib", cxx: base, env: { DYLD_INSERT_LIBRARIES: values.dylib! } },
  { name: "static", cxx: mi, env: {} },
  { name: "static noexit", cxx: mi, env: { MIMALLOC_DESTROY_ON_EXIT: "2" } },
  { name: "static nopurge", cxx: mi, env: { MIMALLOC_PURGE_DELAY: "-1" } },
  { name: "static purge 1s", cxx: mi, env: { MIMALLOC_PURGE_DELAY: "1000" } },
  { name: "static purge no decommit", cxx: mi, env: { MIMALLOC_PURGE_DECOMMITS: "0" } },
  { name: "static eager commit", cxx: mi, env: { MIMALLOC_ARENA_EAGER_COMMIT: "1" } },
];

const target = `--target=${os.arch() === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "macos-"));
const manifest = spawnSync(base, [target, "-print-library-module-manifest-path"], { encoding: "utf8" }).stdout.trim();
const std = JSON.parse(fs.readFileSync(manifest, "utf8")).modules.find((m: { "logical-name": string }) => m["logical-name"] === "std");
const stdSource = path.resolve(path.dirname(manifest), std["source-path"]);
const stdArgs = ["-std=c++23", "-Wno-reserved-module-identifier", "--precompile", stdSource, "-o", path.join(scratch, "std.pcm")];
const fmt = path.resolve(values.fmt!);
const fmtArgs = ["-std=c++20", "-include", "cstdlib", `-I${path.join(fmt, "include")}`, `-I${path.join(fmt, "test")}`,
  `-I${path.join(fmt, "test", "gtest")}`, path.join(fmt, "test", "format-test.cc"), "-c", "-o", path.join(scratch, "f.o")];
const workloads: Record<string, string[]> = {
  "std -O2": ["-O2", ...stdArgs],
  "std -O0": ["-O0", ...stdArgs],
  "fmt format-test -O2": ["-O2", ...fmtArgs],
};

/// /usr/bin/time -l's fields of one compile.
const FIELDS: Record<string, RegExp> = {
  real: /([\d.]+) real/, user: /([\d.]+) user/, sys: /([\d.]+) sys/,
  "rss MiB": /(\d+)\s+maximum resident set size/, "footprint MiB": /(\d+)\s+peak memory footprint/,
  reclaims: /(\d+)\s+page reclaims/, faults: /(\d+)\s+page faults/,
  "Ginstr": /(\d+)\s+instructions retired/, "invol cs": /(\d+)\s+involuntary context switches/,
};
function once(v: (typeof variants)[number], args: string[]): Record<string, number> | undefined {
  const r = spawnSync("/usr/bin/time", ["-l", v.cxx, target, ...args], { encoding: "utf8", env: { ...process.env, ...v.env } });
  if (r.status !== 0) {
    console.log(`${v.name} failed: ${(r.stderr ?? "").slice(-2000)}`);
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, re] of Object.entries(FIELDS)) {
    const m = re.exec(r.stderr ?? "");
    if (!m) continue;
    let x = Number(m[1]);
    if (k.endsWith("MiB")) x /= 1 << 20;
    if (k === "Ginstr") x /= 1e9;
    out[k] = x;
  }
  return out;
}

const lines: string[] = [`### ${os.cpus()[0]?.model ?? "?"}, ${os.availableParallelism()} threads, ${values.rounds} rounds, medians`, ""];
for (const [name, args] of Object.entries(workloads)) {
  const samples: Record<string, Record<string, number>[]> = Object.fromEntries(variants.map((v) => [v.name, []]));
  for (let round = 0; round < Number(values.rounds); round++) {
    for (let i = 0; i < variants.length; i++) {
      const v = variants[(i + round) % variants.length]!;
      const s = once(v, args);
      if (s) samples[v.name]!.push(s);
    }
  }
  const keys = Object.keys(FIELDS);
  lines.push(`#### ${name}`, "", `| variant | ${keys.join(" | ")} |`, `|---|${keys.map(() => "---|").join("")}`);
  const baseReal = median(samples.base!.map((s) => s.real!));
  for (const v of variants) {
    const cells = keys.map((k) => {
      const m = median(samples[v.name]!.map((s) => s[k]!).filter((x) => x !== undefined));
      return k === "real" ? `${m.toFixed(2)} (${(m / baseReal).toFixed(2)})` : m.toFixed(k.endsWith("MiB") || k === "Ginstr" ? 1 : 2);
    });
    lines.push(`| ${v.name} | ${cells.join(" | ")} |`);
  }
  lines.push("");
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");

/// mimalloc's statistics of one std -O2 compile.
const stats = spawnSync(mi, [target, ...workloads["std -O2"]!], { encoding: "utf8", env: { ...process.env, MIMALLOC_SHOW_STATS: "1" } });
const text = ["### mimalloc's statistics, std -O2", "```", (stats.stderr ?? "").slice(-6000), "```", ""].join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
