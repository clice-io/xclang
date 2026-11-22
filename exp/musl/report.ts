/// Experiment (exp/musl-hosts only): exp/musl/link.ts' results over the
/// machines of each architecture: per compiler, the median ratio to the
/// first compiler of each machine.
///
///   node exp/musl/report.ts <directory of link-*.json>

import fs from "node:fs";
import path from "node:path";

interface Run { arch: string; compilers: { name: string }[]; times: Record<string, { cold: number[][]; warm: number[][]; failed: number }> }
const dir = process.argv[2]!;
const runs: Run[] = fs.readdirSync(dir).filter((f) => f.startsWith("link-") && f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
for (const arch of [...new Set(runs.map((r) => r.arch))].sort()) {
  const machines = runs.filter((r) => r.arch === arch);
  const names = machines[0]!.compilers.map((c) => c.name);
  const base = names[0]!;
  console.log(`### link, ${arch}: relative to ${base}, median of ${machines.length} machines\n`);
  console.log(`| | ${names.join(" | ")} |`);
  console.log(`|---|${names.map(() => "---|").join("")}`);
  for (const [kind, i, label] of [["cold", 0, "cold time"], ["cold", 1, "cold peak RSS"], ["warm", 0, "warm time"], ["warm", 1, "warm peak RSS"]] as const) {
    const cells = names.map((n) => {
      const ratios = machines.map((m) => median(m.times[n]?.[kind].map((t) => t[i]!) ?? []) / median(m.times[base]![kind].map((t) => t[i]!)))
        .filter((x) => !Number.isNaN(x));
      return ratios.length ? median(ratios).toFixed(3) : "-";
    });
    console.log(`| ${label} | ${cells.join(" | ")} |`);
  }
  const abs = names.map((n) => median(machines.map((m) => median(m.times[n]?.cold.map((t) => t[0]!) ?? []))).toFixed(1));
  console.log(`| cold s (median) | ${abs.join(" | ")} |`);
  console.log(`| failed links | ${names.map((n) => machines.reduce((s, m) => s + (m.times[n]?.failed ?? 0), 0)).join(" | ")} |\n`);
}
