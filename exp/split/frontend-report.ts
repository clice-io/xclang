/// Experiment (exp/musl-hosts only): exp/split/frontend.ts' results over the
/// machines of each architecture: per compiler, the median ratio to the
/// first compiler of each machine.
///
///   node exp/split/frontend-report.ts <directory of frontend-*.json>

import fs from "node:fs";
import path from "node:path";

type Row = Record<string, { seconds: number; rss: number; maxRss: number }>;
interface Run { arch: string; compilers: { name: string }[]; results: Record<string, Row> }
const dir = process.argv[2]!;
const runs: Run[] = fs.readdirSync(dir).filter((f) => f.startsWith("frontend-") && f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
for (const arch of [...new Set(runs.map((r) => r.arch))].sort()) {
  const machines = runs.filter((r) => r.arch === arch);
  const names = machines[0]!.compilers.map((c) => c.name);
  const base = names[0]!;
  console.log(`### frontend, ${arch}: relative to ${base}, median of ${machines.length} machines\n`);
  console.log(`| suite | | ${names.join(" | ")} |`);
  console.log(`|---|---|${names.map(() => "---|").join("")}`);
  for (const suite of Object.keys(machines[0]!.results)) {
    for (const [k, label] of [["seconds", "time"], ["rss", "median peak RSS"], ["maxRss", "largest peak RSS"]] as const) {
      const cells = names.map((n) => median(machines.map((m) => m.results[suite]![n]![k] / m.results[suite]![base]![k])).toFixed(3));
      console.log(`| ${suite} | ${label} | ${cells.join(" | ")} |`);
    }
    const abs = names.map((n) => median(machines.map((m) => m.results[suite]![n]!.seconds)).toFixed(1));
    console.log(`| ${suite} | s (median) | ${abs.join(" | ")} |`);
  }
  console.log("");
}
