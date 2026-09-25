/// Record the training profile. The instrumented clang and lld
/// (work/out/toolchain-x86_64-unknown-linux-gnu-instrumented) compile and
/// link a fixed corpus the way the toolchain is used:
///
/// - C and C++ sources (sqlite, abseil) at -O0 -g and -O2, for x86_64 and
///   aarch64 Linux;
/// - a precompiled header, and C++20 modules through `import std;`;
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

const work = path.join(common.WORK, "build", "train");
const raw = path.join(work, "raw");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(raw, { recursive: true });

const abseil = path.join(common.WORK, "src", "abseil");
if (!fs.existsSync(path.join(abseil, "absl"))) common.extract(await common.fetchSource("abseil"), abseil);
const sqlite = path.join(common.WORK, "src", "sqlite");
if (!fs.existsSync(path.join(sqlite, "sqlite3.c"))) common.extract(await common.fetchSource("sqlite"), sqlite);
const corpus = path.join(common.ROOT, "pgo", "corpus");

/// Every library source of abseil that builds on Linux: no tests,
/// benchmarks, test helpers or Windows-only files.
const abseilSources = fs
  .readdirSync(path.join(abseil, "absl"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".cc"))
  .filter((f) => !/(_test|test_|_benchmark|benchmark|testing|mock|_win|win32|_testutil)/.test(f))
  .map((f) => path.join(abseil, "absl", f))
  .sort();

interface Task {
  label: string;
  cmd: string;
  args: string[];
  /// Failures are counted, not fatal: a corpus file may not build in every
  /// configuration, and the counters of what it did run still count.
  optional?: boolean;
}

const env = { ...process.env, LLVM_PROFILE_FILE: path.join(raw, "%4m.profraw") };
const failures: string[] = [];

async function runAll(stage: string, tasks: Task[]): Promise<void> {
  const start = Date.now();
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      const code = await new Promise<number>((resolve) => {
        const child = spawn(task.cmd, task.args, { env, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (c) => {
          if (c !== 0) console.log(`${task.label} failed (${c}):\n${stderr.slice(-2000)}`);
          resolve(c ?? 1);
        });
      });
      if (code !== 0) {
        failed++;
        if (!task.optional) failures.push(task.label);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(common.jobs()) }, worker));
  console.log(`${stage}: ${tasks.length} runs, ${failed} failed, ${Math.round((Date.now() - start) / 1000)} s`);
}

const obj = (...parts: string[]) => {
  const file = path.join(work, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};
const cxx = (t: string, opt: string[]) => [`--target=${t}`, "-std=c++20", `-I${abseil}`, ...opt];

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
  compiles.push({
    label: `pch ${t}`,
    cmd: clangxx, args: [...cxx(t, OPTS.O0), "-x", "c++-header", path.join(corpus, "pch.hpp"), "-o", obj(t, "pch.hpp.pch")],
  });
  const stdModule = path.join(tree, t, "usr", "share", "libc++", "v1", "std.cppm");
  compiles.push({
    label: `std module ${t}`,
    cmd: clangxx, args: [`--target=${t}`, "-std=c++23", "-O2", "-Wno-reserved-module-identifier",
      "--precompile", stdModule, "-o", obj(t, "std.pcm")],
  });
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
  const lines = fs.readFileSync(src, "utf8").split("\n");
  const line = lines.findIndex((l) => l.includes("std::") && !l.trimStart().startsWith("//"));
  if (line < 0) continue;
  const column = lines[line].indexOf("std::") + "std::".length + 1;
  compiles.push({
    label: `completion ${path.basename(src)}:${line + 1}:${column}`,
    cmd: clangxx,
    args: [...cxx(LINUX[0], []), "-fsyntax-only", "-Xclang", `-code-completion-at=${src}:${line + 1}:${column}`, src],
    optional: true,
  });
}
await runAll("compile", compiles);

/// 2. What uses the precompiled header and the std module.
const users: Task[] = [];
for (const t of LINUX) {
  abseilSources.slice(0, 40).forEach((src, i) => users.push({
    label: `pch user ${t} ${path.basename(src)}`,
    cmd: clangxx, args: [...cxx(t, OPTS.O0), "-include-pch", obj(t, "pch.hpp.pch"), "-c", src, "-o", obj(t, "pch", `${i}.o`)],
    optional: true,
  }));
  users.push({
    label: `std module object ${t}`,
    cmd: clangxx, args: [`--target=${t}`, "-std=c++23", "-O2", "-c", obj(t, "std.pcm"), "-o", obj(t, "std.o")],
  });
  users.push({
    label: `std module user ${t}`,
    cmd: clangxx, args: [`--target=${t}`, "-std=c++23", "-O2", `-fmodule-file=std=${obj(t, "std.pcm")}`,
      "-c", path.join(corpus, "modules.cpp"), "-o", obj(t, "modules.o")],
  });
}
await runAll("pch and modules", users);

/// 3. Links: ELF at both levels, ThinLTO, COFF, and the module program.
const links: Task[] = [];
for (const t of LINUX) {
  for (const o of Object.keys(OPTS)) {
    links.push({
      label: `link sqlite ${t} ${o}`,
      cmd: clang, args: [`--target=${t}`, obj(t, o, "sqlite3.o"), obj(t, o, "shell.o"), "-lpthread", "-ldl", "-lm", "-o", obj(t, o, "sqlite3")],
    });
  }
  links.push({
    label: `link sqlite thinlto ${t}`,
    cmd: clang, args: [`--target=${t}`, "-O2", "-flto=thin", obj(t, "lto", "sqlite3.o"), obj(t, "lto", "shell.o"),
      "-lpthread", "-ldl", "-lm", "-o", obj(t, "lto", "sqlite3")],
  });
  links.push({
    label: `link modules ${t}`,
    cmd: clangxx, args: [`--target=${t}`, obj(t, "modules.o"), obj(t, "std.o"), "-o", obj(t, "modules")],
  });
}
for (const o of Object.keys(OPTS)) {
  links.push({
    label: `link sqlite mingw ${o}`,
    cmd: clang, args: ["--target=x86_64-w64-mingw32", obj("mingw", o, "sqlite3.o"), obj("mingw", o, "shell.o"), "-o", obj("mingw", o, "sqlite3.exe")],
  });
}
await runAll("link", links);

common.run(obj("x86_64-unknown-linux-gnu", "O2", "sqlite3"), ["-version"]);
common.run(obj("x86_64-unknown-linux-gnu", "modules"), []);
if (failures.length) common.fail(`required training runs failed:\n  ${failures.join("\n  ")}`);

const out = path.join(common.WORK, "out", "profile");
fs.mkdirSync(out, { recursive: true });
const profdata = path.join(common.WORK, "bootstrap", "bin", "llvm-profdata");
const profraws = fs.readdirSync(raw).map((f) => path.join(raw, f));
console.log(`${profraws.length} raw profiles, ${Math.round(profraws.reduce((n, f) => n + fs.statSync(f).size, 0) / 1048576)} MB`);
common.run(profdata, ["merge", "--sparse", "-o", path.join(out, "profile.profdata"), ...profraws]);
common.run(profdata, ["show", path.join(out, "profile.profdata")]);
