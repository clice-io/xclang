/// The median, over the machines of a host, of each compiler's time
/// relative to the first compiler of that machine (tests/bench.ts writes
/// one JSON file per machine).
///
///   node tests/bench-report.ts <directory of bench-*.json>

import fs from "node:fs";
import path from "node:path";

interface Result {
  native: string;
  compilers: { name: string }[];
  results: Record<string, Record<string, number>>;
}

const dir = process.argv[2];
const runs: Result[] = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const host of [...new Set(runs.map((r) => r.native))].sort()) {
  const machines = runs.filter((r) => r.native === host);
  const names = machines[0].compilers.map((c) => c.name);
  const base = names[0];
  console.log(`### ${host}: time relative to ${base}, median of ${machines.length} machines (lower is faster)\n`);
  console.log(`| suite | mode | ${names.join(" | ")} |`);
  console.log(`|---|---|${names.map(() => "---|").join("")}`);
  for (const key of Object.keys(machines[0].results)) {
    const [suite, mode] = key.split(" ");
    const cells = names.map((name) => {
      const ratios = machines
        .map((m) => m.results[key]?.[name] !== undefined && m.results[key]?.[base] ? m.results[key][name] / m.results[key][base] : undefined)
        .filter((x): x is number => x !== undefined);
      return ratios.length ? median(ratios).toFixed(3) : "-";
    });
    console.log(`| ${suite} | ${mode} | ${cells.join(" | ")} |`);
  }
  console.log();
}
