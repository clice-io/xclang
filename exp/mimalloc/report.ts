/// Experiment (exp/mimalloc-hosts only): every host's medians over its
/// machines (shards) of mimalloc's ratio to the base toolchain: compile
/// time per suite and mode (tests/bench/bench.ts), the link's seconds and
/// peak memory (link.ts), the frontend's seconds and peak memory
/// (frontend.ts).
///
///   node exp/mimalloc/report.ts <dir of bench-*, link-*, frontend-* json>

import fs from "node:fs";
import path from "node:path";
import { median } from "./measure.ts";

const dir = process.argv[2]!;
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const hosts = [...new Set(files.map((f) => /^(?:bench|link|frontend)-(.+)-\d+\.json$/.exec(f)?.[1]).filter((h) => h))] as string[];
const [BASE, MI] = ["base", "mimalloc"];
const fmt = (xs: number[]) => xs.length ? `${median(xs).toFixed(3)} (${xs.length}: ${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)})` : "-";
const lines: string[] = ["## mimalloc against the base, median over machines (n: min–max)", ""];
for (const host of hosts.sort()) {
  lines.push(`### ${host}`, "", "| what | ratio |", "|---|---|");
  const of = (kind: string) => files.filter((f) => f.startsWith(`${kind}-${host}-`)).map(read);
  const compile: Record<string, number[]> = {};
  for (const b of of("bench")) {
    for (const [key, row] of Object.entries(b.results as Record<string, Record<string, number>>)) {
      if (row[BASE] && row[MI]) (compile[key] ??= []).push(row[MI] / row[BASE]);
    }
  }
  for (const [key, xs] of Object.entries(compile)) lines.push(`| compile ${key} | ${fmt(xs)} |`);
  const medians = Object.values(compile).map(median);
  if (medians.length) lines.push(`| **compile, range of the suites' medians** | ${Math.min(...medians).toFixed(2)}–${Math.max(...medians).toFixed(2)} |`);
  const links = of("link");
  for (const k of ["seconds", "mib"] as const) {
    const xs = links.map((l) => median(l.times[MI][k]) / median(l.times[BASE][k])).filter((x) => Number.isFinite(x));
    lines.push(`| **link ${k === "seconds" ? "time" : "peak memory"}** | ${fmt(xs)} |`);
  }
  const failed = links.reduce((s, l) => s + l.times[MI].failed + l.times[BASE].failed, 0);
  if (failed) lines.push(`| link failures | ${failed} |`);
  for (const suite of ["clang", "abseil"]) {
    for (const [k, what] of [["seconds", "time"], ["rss", "median peak memory"], ["maxRss", "largest peak memory"]] as const) {
      const xs = of("frontend").map((f) => f.results[suite][MI][k] / f.results[suite][BASE][k]).filter((x) => Number.isFinite(x));
      lines.push(`| ${k === "seconds" ? "**" : ""}frontend ${suite} ${what}${k === "seconds" ? "**" : ""} | ${fmt(xs)} |`);
    }
  }
  lines.push("");
}
console.log(lines.join("\n"));
