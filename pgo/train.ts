/// Record the training profile. The instrumented clang, clang-scan-deps
/// and lld (work/out/toolchain-x86_64-unknown-linux-gnu-instrumented)
/// compile and link a fixed corpus the way the toolchain is used:
///
/// - C and C++ sources (sqlite, abseil) at -O0 -g and -O2, for x86_64 and
///   aarch64 Linux;
/// - precompiled headers: one shared header, and the preamble of every
///   abseil source, which an editor precompiles once per file and parses
///   the rest of the file and code completion on;
/// - C++20 modules: libc++'s std and std.compat, real ones (magic_enum,
///   Vulkan-Hpp's, the largest in common use) and a wrapped header-only
///   library (nlohmann/json), a module of partitions (pgo/corpus/modules),
///   and their importers; two-phase at -O2, one-phase with reduced BMIs at
///   -O0 -g; P1689 dependency scanning, as CMake runs it;
/// - code completion requests, the path an editor drives;
/// - ELF, ThinLTO and COFF (mingw) links through lld.
///
/// The counters are merged into work/out/profile/profile.profdata.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as common from "../scripts/common.ts";

const LINUX = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"];
const OPTS: Record<string, string[]> = { O0: ["-O0", "-g"], O2: ["-O2"] };

const instrumented = path.join(common.WORK, "out", "toolchain-x86_64-unknown-linux-gnu-instrumented");
const runtimes = [...LINUX, "x86_64-w64-mingw32"].map((t) => path.join(common.WORK, "out", `runtimes-${t}`));
for (const dir of [instrumented, ...runtimes]) if (!fs.existsSync(dir)) common.fail(`missing ${dir}`);
const tree = common.makeTree(path.join(common.WORK, "stage", "train"), instrumented, runtimes);
const clang = path.join(tree, "bin", "clang");
const clangxx = path.join(tree, "bin", "clang++");
const scanDeps = path.join(tree, "bin", "clang-scan-deps");

const work = path.join(common.WORK, "build", "train");
const raw = path.join(work, "raw");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(raw, { recursive: true });

async function source(name: common.Source, probe: string): Promise<string> {
  const dir = path.join(common.WORK, "src", name);
  if (!fs.existsSync(path.join(dir, probe))) common.extract(await common.fetchSource(name), dir);
  return dir;
}
const abseil = await source("abseil", "absl");
const sqlite = await source("sqlite", "sqlite3.c");
const magicEnum = await source("magic_enum", "module/magic_enum.cppm");
const json = await source("json", "include/nlohmann/json.hpp");
const vulkan = await source("vulkan-headers", "include/vulkan/vulkan.cppm");
const corpus = path.join(common.ROOT, "pgo", "corpus");

/// Every library source of abseil that builds on Linux: no tests,
/// benchmarks, test helpers (gtest matchers) or Windows-only files.
const abseilSources = fs
  .readdirSync(path.join(abseil, "absl"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".cc"))
  .filter((f) => !/(_test|test_|_benchmark|benchmark|testing|mock|matchers|_win|win32|_testutil)/.test(f))
  .map((f) => path.join(abseil, "absl", f))
  .sort();

interface Task {
  label: string;
  cmd: string;
  args: string[];
  /// Failures are counted, not fatal: a corpus file may not build in every
  /// configuration, and the counters of what it did run still count.
  optional?: boolean;
  /// Tasks whose outputs this one reads: it runs after them, and not at
  /// all if one of them failed.
  needs?: Task[];
}

const env = { ...process.env, LLVM_PROFILE_FILE: path.join(raw, "%4m.profraw") };
const failures: string[] = [];
const done = new Map<Task, boolean>();

function run(task: Task): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(task.cmd, task.args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) console.log(`${task.label} failed (${code}):\n${stderr.slice(-2000)}`);
      resolve(code === 0);
    });
  });
}

/// Run the tasks, as many at once as there are cores, each after what it
/// needs.
async function runAll(stage: string, tasks: Task[]): Promise<void> {
  const start = Date.now();
  const jobs = Number(common.jobs());
  const waiting = new Set(tasks);
  const running = new Set<Promise<void>>();
  let failed = 0;
  const finish = (task: Task, ok: boolean, why = "") => {
    done.set(task, ok);
    if (ok) return;
    failed++;
    if (!task.optional) failures.push(task.label + why);
  };
  for (;;) {
    for (const task of waiting) {
      if (running.size >= jobs) break;
      const needs = task.needs ?? [];
      if (needs.some((n) => done.get(n) === false)) {
        waiting.delete(task);
        finish(task, false, " (not run: what it needs failed)");
      } else if (needs.every((n) => done.get(n))) {
        waiting.delete(task);
        const p: Promise<void> = run(task).then((ok) => {
          finish(task, ok);
          running.delete(p);
        });
        running.add(p);
      }
    }
    if (!running.size && ![...waiting].some((t) => (t.needs ?? []).some((n) => done.get(n) === false))) break;
    if (running.size) await Promise.race(running);
  }
  if (waiting.size) common.fail(`${stage}: never ready: ${[...waiting].map((t) => t.label).join(", ")}`);
  console.log(`${stage}: ${tasks.length} runs, ${failed} failed, ${Math.round((Date.now() - start) / 1000)} s`);
}

const obj = (...parts: string[]) => {
  const file = path.join(work, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};
const cxx = (t: string, opt: string[]) => [`--target=${t}`, "-std=c++20", `-I${abseil}`, ...opt];

/// Where to ask for code completion in a source: right after the first
/// `<prefix>` of a line of code at or past line `from`, for each prefix.
function completionPoints(file: string, prefixes: string[], from = 0): string[] {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const points: string[] = [];
  for (const prefix of prefixes) {
    const line = lines.findIndex((l, i) => i >= from && l.includes(prefix) && !l.trimStart().startsWith("//"));
    if (line >= 0) points.push(`${file}:${line + 1}:${lines[line].indexOf(prefix) + prefix.length + 1}`);
  }
  return points;
}

/// The preamble of a source, as an editor bounds it: the leading comments
/// and preprocessor lines, up to the last point outside any #if. .inc
/// files, which have no include guard, are left to the rest of the file.
function preamble(text: string): { text: string; lines: number } {
  const lines = text.split("\n");
  let depth = 0;
  let balanced = 0;
  let comment = false;
  let continued = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (comment) {
      comment = !line.includes("*/");
    } else if (continued || line.startsWith("#")) {
      const directive = continued ? "" : line.slice(1).trimStart();
      if (directive.startsWith("if")) depth++;
      else if (directive.startsWith("endif")) depth--;
    } else if (line.startsWith("/*")) {
      comment = !line.includes("*/");
    } else if (line && !line.startsWith("//")) {
      break;
    }
    continued = !comment && line.endsWith("\\");
    if (depth === 0 && !continued && !comment) balanced = i + 1;
  }
  const kept = lines.slice(0, balanced).filter((l) => !/^\s*#\s*include\s*".*\.inc"/.test(l));
  return { text: kept.join("\n") + "\n", lines: balanced };
}

/// 1. Compiles that need nothing else.
const compiles: Task[] = [];
for (const t of LINUX) {
  for (const [o, opt] of Object.entries(OPTS)) {
    abseilSources.forEach((src, i) => compiles.push({
      label: `abseil ${t} ${o} ${path.basename(src)}`,
      cmd: clangxx, args: [...cxx(t, opt), "-c", src, "-o", obj(t, o, "abseil", `${i}.o`)],
      optional: true,
    }));
    for (const c of ["sqlite3", "shell"]) {
      compiles.push({
        label: `sqlite ${t} ${o} ${c}`,
        cmd: clang, args: [`--target=${t}`, ...opt, "-c", path.join(sqlite, `${c}.c`), "-o", obj(t, o, `${c}.o`)],
      });
    }
  }
  for (const c of ["sqlite3", "shell"]) {
    compiles.push({
      label: `sqlite thinlto ${t} ${c}`,
      cmd: clang, args: [`--target=${t}`, "-O2", "-flto=thin", "-c", path.join(sqlite, `${c}.c`), "-o", obj(t, "lto", `${c}.o`)],
    });
  }
}
for (const [o, opt] of Object.entries(OPTS)) {
  for (const c of ["sqlite3", "shell"]) {
    compiles.push({
      label: `sqlite mingw ${o} ${c}`,
      cmd: clang, args: ["--target=x86_64-w64-mingw32", ...opt, "-c", path.join(sqlite, `${c}.c`), "-o", obj("mingw", o, `${c}.o`)],
    });
  }
}
/// Code completion right after the first `std::` of abseil sources.
for (const src of abseilSources.slice(0, 60)) {
  for (const point of completionPoints(src, ["std::"])) {
    compiles.push({
      label: `completion ${path.basename(point)}`,
      cmd: clangxx, args: [...cxx(LINUX[0], []), "-fsyntax-only", "-Xclang", `-code-completion-at=${point}`, src],
      optional: true,
    });
  }
}
await runAll("compile", compiles);

/// 2. Precompiled headers. The shared one, used for objects at both
/// levels, for parsing alone and for completion...
const pchs: Task[] = [];
const X86 = LINUX[0];
for (const [t, o, users] of [[X86, "O0", 80], [X86, "O2", 40], [LINUX[1], "O0", 40]] as const) {
  const pch = obj(t, o, "pch.hpp.pch");
  const build: Task = {
    label: `pch ${t} ${o}`,
    cmd: clangxx, args: [...cxx(t, OPTS[o]), "-x", "c++-header", path.join(corpus, "pch.hpp"), "-o", pch],
  };
  pchs.push(build);
  abseilSources.slice(0, users).forEach((src, i) => pchs.push({
    label: `pch user ${t} ${o} ${path.basename(src)}`,
    cmd: clangxx, args: [...cxx(t, OPTS[o]), "-include-pch", pch, "-c", src, "-o", obj(t, o, "pch", `${i}.o`)],
    optional: true, needs: [build],
  }));
  if (t !== X86 || o !== "O0") continue;
  abseilSources.forEach((src, i) => {
    pchs.push({
      label: `pch syntax ${path.basename(src)}`,
      cmd: clangxx, args: [...cxx(t, OPTS[o]), "-include-pch", pch, "-fsyntax-only", src],
      optional: true, needs: [build],
    });
    if (i % 2) return;
    for (const point of completionPoints(src, ["absl::"], 20)) {
      pchs.push({
        label: `pch completion ${path.basename(point)}`,
        cmd: clangxx, args: [...cxx(t, OPTS[o]), "-include-pch", pch, "-fsyntax-only", "-Xclang", `-code-completion-at=${point}`, src],
        optional: true, needs: [build],
      });
    }
  });
}
/// ...and a preamble per abseil source, as an editor builds it when the
/// file is opened, then parses the rest on, and completes in.
abseilSources.forEach((src, i) => {
  const { text, lines } = preamble(fs.readFileSync(src, "utf8"));
  const header = obj("preamble", `${i}.h`);
  fs.writeFileSync(header, text);
  const pch = obj("preamble", `${i}.pch`);
  const build: Task = {
    label: `preamble ${path.basename(src)}`,
    cmd: clangxx, args: [...cxx(X86, []), `-iquote${path.dirname(src)}`, "-x", "c++-header", header, "-o", pch],
    optional: true,
  };
  const parse = [...cxx(X86, []), "-include-pch", pch, "-fsyntax-only"];
  pchs.push(build, { label: `preamble parse ${path.basename(src)}`, cmd: clangxx, args: [...parse, src], optional: true, needs: [build] });
  for (const point of completionPoints(src, ["std::", "absl::"], lines)) {
    pchs.push({
      label: `preamble completion ${path.basename(point)}`,
      cmd: clangxx, args: [...parse, "-Xclang", `-code-completion-at=${point}`, src],
      optional: true, needs: [build],
    });
  }
});
await runAll("pch", pchs);

/// 3. Modules. A unit's BMI is <name>.pcm, ':' spelled '-'.
interface Unit { name: string; source: string; args: string[]; imports: Unit[] }
const unit = (name: string, source: string, imports: Unit[] = [], args: string[] = []): Unit =>
  ({ name, source, args, imports });
const closure = (units: Unit[]): Unit[] => {
  const all = new Set<Unit>();
  const add = (u: Unit) => { if (!all.has(u)) { all.add(u); u.imports.forEach(add); } };
  units.forEach(add);
  return [...all];
};
const mod = path.join(corpus, "modules");
const vulkanArgs = [`-I${path.join(vulkan, "include")}`, "-DVULKAN_HPP_CXX_MODULE_EXPERIMENTAL_WARNING="];

const moduleTasks: Task[] = [];
/// The object tasks of each target and level, which the links wait for.
const moduleObjects = new Map<string, Task[]>();
/// What CMake runs before building a C++20 target: a P1689 scan of each
/// source, one clang-scan-deps per file.
const scan = (file: string, command: string[]) => moduleTasks.push({
  label: `scan ${path.basename(file)}`, cmd: scanDeps, args: ["-format=p1689", "--", clangxx, ...command],
});
for (const t of LINUX) {
  const libcxx = path.join(tree, t, "usr", "share", "libc++", "v1");
  const std = unit("std", path.join(libcxx, "std.cppm"), [], ["-Wno-reserved-module-identifier"]);
  const compat = unit("std.compat", path.join(libcxx, "std.compat.cppm"), [std], ["-Wno-reserved-module-identifier"]);
  const magic = unit("magic_enum", path.join(magicEnum, "module", "magic_enum.cppm"), [], [`-I${path.join(magicEnum, "include")}`]);
  const nlohmann = unit("nlohmann.json", path.join(mod, "json.cppm"), [], [`-I${path.join(json, "include")}`]);
  const shapes = unit("geometry:shapes", path.join(mod, "geometry", "shapes.cppm"), [std]);
  const detail = unit("geometry:detail", path.join(mod, "geometry", "detail.cppm"), [std, shapes]);
  const algorithms = unit("geometry:algorithms", path.join(mod, "geometry", "algorithms.cppm"), [std, shapes]);
  const geometry = unit("geometry", path.join(mod, "geometry", "geometry.cppm"), [shapes, algorithms]);
  const vk = unit("vulkan", path.join(vulkan, "include", "vulkan", "vulkan.cppm"), [std], vulkanArgs);
  const vkVideo = unit("vulkan_video", path.join(vulkan, "include", "vulkan", "vulkan_video.cppm"), [vk], vulkanArgs);
  /// Vulkan-Hpp's module takes a minute and gigabytes: x86_64 only.
  const units = [std, compat, magic, nlohmann, shapes, detail, algorithms, geometry, ...(t === X86 ? [vk, vkVideo] : [])];
  const programs: [string, string, Unit[]][] = [
    ["use-std", path.join(mod, "use-std.cpp"), [std]],
    ["use-json", path.join(mod, "use-json.cpp"), [std, nlohmann]],
    ["use-enum", path.join(mod, "use-enum.cpp"), [std, magic]],
    ["use-geometry", path.join(mod, "use-geometry.cpp"), [std, geometry]],
    ["use-all", path.join(mod, "use-all.cpp"), [compat, nlohmann, magic, geometry]],
    ["geometry-impl", path.join(mod, "geometry", "geometry.cpp"), [geometry, detail]],
  ];
  if (t === X86) programs.push(["use-vulkan", path.join(mod, "use-vulkan.cpp"), [vk, vkVideo]]);
  for (const [o, opt] of Object.entries(OPTS)) {
    const base = [`--target=${t}`, "-std=c++23", ...opt];
    const file = (name: string, ext: string) => obj(t, o, "modules", `${name.replace(":", "-")}${ext}`);
    const maps = (units: Unit[]) => closure(units).map((u) => `-fmodule-file=${u.name}=${file(u.name, ".pcm")}`);
    /// The task that writes each unit's BMI.
    const bmi = new Map<Unit, Task>();
    const objects: Task[] = [];
    for (const u of units) {
      const needs = closure(u.imports).map((i) => bmi.get(i)!);
      const args = [...base, ...u.args, ...maps(u.imports)];
      if (o === "O2") {
        /// Two-phase: the BMI, then the object from it.
        const precompile: Task = {
          label: `module ${t} ${o} ${u.name}`, needs,
          cmd: clangxx, args: [...args, "--precompile", u.source, "-o", file(u.name, ".pcm")],
        };
        bmi.set(u, precompile);
        objects.push({
          label: `module object ${t} ${o} ${u.name}`, needs: [precompile, ...needs],
          cmd: clangxx, args: [...base, ...maps(u.imports), "-c", file(u.name, ".pcm"), "-o", file(u.name, ".o")],
        });
        moduleTasks.push(precompile);
      } else {
        /// One-phase: the object, with a reduced BMI on the side.
        const compile: Task = {
          label: `module ${t} ${o} ${u.name}`, needs,
          cmd: clangxx, args: [...args, "-fmodules-reduced-bmi", `-fmodule-output=${file(u.name, ".pcm")}`, "-c", u.source, "-o", file(u.name, ".o")],
        };
        bmi.set(u, compile);
        objects.push(compile);
      }
      if (t === X86 && o === "O2") scan(u.source, [...base, ...u.args, "-c", u.source, "-o", file(u.name, ".o")]);
    }
    for (const [name, source, imports] of programs) {
      const needs = closure(imports).map((u) => bmi.get(u)!);
      const args = [...base, ...new Set(imports.flatMap((u) => u.args)), ...maps(imports)];
      objects.push({ label: `importer ${t} ${o} ${name}`, needs, cmd: clangxx, args: [...args, "-c", source, "-o", file(name, ".o")] });
      if (t === X86 && o === "O2") scan(source, [...base, ...new Set(imports.flatMap((u) => u.args)), "-c", source, "-o", file(name, ".o")]);
      if (t !== X86 || o !== "O0") continue;
      /// An editor on the importer: parsing, and completion after the
      /// modules' namespaces and a member access.
      moduleTasks.push({ label: `importer syntax ${name}`, needs, cmd: clangxx, args: [...args, "-fsyntax-only", source] });
      for (const point of completionPoints(source, ["std::", "nlohmann::", "magic_enum::", "geometry::", "vk::", "j."])) {
        moduleTasks.push({
          label: `importer completion ${path.basename(point)}`, needs, optional: true,
          cmd: clangxx, args: [...args, "-fsyntax-only", "-Xclang", `-code-completion-at=${point}`, source],
        });
      }
    }
    moduleTasks.push(...objects);
    moduleObjects.set(`${t} ${o}`, objects);
  }
}
/// The scan of a whole compilation database at once, abseil's.
const database = obj("scan", "compile_commands.json");
fs.writeFileSync(database, JSON.stringify(abseilSources.map((src, i) => ({
  directory: work, file: src, arguments: [clangxx, ...cxx(X86, OPTS.O2), "-c", src, "-o", obj("scan", `${i}.o`)],
})), null, 1));
moduleTasks.push({
  label: "scan abseil", cmd: scanDeps,
  args: ["-format=p1689", `-compilation-database=${database}`, "-j", common.jobs(), "-o", obj("scan", "p1689.json")],
});
await runAll("modules", moduleTasks);

/// 4. Links: ELF at both levels, ThinLTO, COFF, and the module programs.
const links: Task[] = [];
for (const t of LINUX) {
  for (const o of Object.keys(OPTS)) {
    links.push({
      label: `link sqlite ${t} ${o}`,
      cmd: clang, args: [`--target=${t}`, obj(t, o, "sqlite3.o"), obj(t, o, "shell.o"), "-lpthread", "-ldl", "-lm", "-o", obj(t, o, "sqlite3")],
    });
    const tasks = moduleObjects.get(`${t} ${o}`)!;
    const m = (name: string) => obj(t, o, "modules", `${name}.o`);
    const geometry = ["geometry", "geometry-shapes", "geometry-detail", "geometry-algorithms", "geometry-impl"].map(m);
    for (const [name, objects] of [
      ["use-std", [m("use-std"), m("std")]],
      ["use-json", [m("use-json"), m("nlohmann.json"), m("std")]],
      ["use-enum", [m("use-enum"), m("magic_enum"), m("std")]],
      ["use-geometry", [m("use-geometry"), ...geometry, m("std")]],
      ["use-all", [m("use-all"), ...geometry, m("std"), m("std.compat"), m("magic_enum"), m("nlohmann.json")]],
    ] as const) {
      links.push({ label: `link ${name} ${t} ${o}`, needs: tasks, cmd: clangxx, args: [`--target=${t}`, ...objects, "-o", obj(t, o, name)] });
    }
  }
  links.push({
    label: `link sqlite thinlto ${t}`,
    cmd: clang, args: [`--target=${t}`, "-O2", "-flto=thin", obj(t, "lto", "sqlite3.o"), obj(t, "lto", "shell.o"),
      "-lpthread", "-ldl", "-lm", "-o", obj(t, "lto", "sqlite3")],
  });
}
for (const o of Object.keys(OPTS)) {
  links.push({
    label: `link sqlite mingw ${o}`,
    cmd: clang, args: ["--target=x86_64-w64-mingw32", obj("mingw", o, "sqlite3.o"), obj("mingw", o, "shell.o"), "-o", obj("mingw", o, "sqlite3.exe")],
  });
}
await runAll("link", links);

common.run(obj(X86, "O2", "sqlite3"), ["-version"]);
for (const o of Object.keys(OPTS)) for (const name of ["use-std", "use-geometry", "use-all"]) common.run(obj(X86, o, name), []);
if (failures.length) common.fail(`required training runs failed:\n  ${failures.join("\n  ")}`);

const out = path.join(common.WORK, "out", "profile");
fs.mkdirSync(out, { recursive: true });
const profdata = path.join(common.WORK, "bootstrap", "bin", "llvm-profdata");
const profraws = fs.readdirSync(raw).map((f) => path.join(raw, f));
console.log(`${profraws.length} raw profiles, ${Math.round(profraws.reduce((n, f) => n + fs.statSync(f).size, 0) / 1048576)} MB`);
common.run(profdata, ["merge", "--sparse", "-o", path.join(out, "profile.profdata"), ...profraws]);
common.run(profdata, ["show", path.join(out, "profile.profdata")]);
