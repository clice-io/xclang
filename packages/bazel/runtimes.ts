/// The C++ runtimes' translation units for the Bazel module
/// (packages/bazel/bazel/runtimes_sources.bzl), as LLVM's CMake build of
/// runtimes/ compiles them: the CMake package builds each variant from a
/// toolchain's sources (packages/cmake/runtimes.cmake), and its build.ninja
/// and compile_commands.json say which objects make each library and how
/// each object is compiled.
///
///   node packages/bazel/runtimes.ts collect --tree <xclang> --out <file.json> [--targets <triple>,...]
///       the variants of every target given (by default those this host
///       builds for, macOS's only on macOS): libc++ (with libc++abi),
///       libc++experimental and libunwind with exceptions and RTTI, without
///       exceptions, and without both; for the Linux targets,
///       MemorySanitizer's runtime too
///   node packages/bazel/runtimes.ts write <file.json>...
///       runtimes_sources.bzl from what collect wrote for every target
///   node packages/bazel/runtimes.ts check <file.json>...
///       fails if runtimes_sources.bzl is not what write would make
///
/// Flags are kept but warnings, diagnostics' colors, dependency files,
/// the target, the SDK and the deployment target, which the Bazel
/// toolchain gives, and the paths that name where the build ran. Paths
/// are the sources' ($(SRC)/...) or the libc++ headers the build copies
/// ($(CXX)); any other fails.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";

const BZL = path.join(import.meta.dirname, "bazel", "runtimes_sources.bzl");

/// The variants, by what makes them: the CMake package's options.
const MODES: Record<string, string[]> = {
  default: [],
  noexcept: ["-DXCLANG_RUNTIMES_EXCEPTIONS=OFF"],
  nortti: ["-DXCLANG_RUNTIMES_EXCEPTIONS=OFF", "-DXCLANG_RUNTIMES_RTTI=OFF"],
  msan: ["-DXCLANG_SANITIZER=memory"],
};

/// The libraries, by the archive of each build that holds them.
const ARCHIVES: Record<string, Record<string, string>> = {
  runtimes: { "libc++.a": "cxx", "libc++experimental.a": "cxx_experimental", "libunwind.a": "unwind" },
  "compiler-rt": { "libclang_rt.msan.a": "msan", "libclang_rt.msan_cxx.a": "msan_cxx" },
};

interface Unit {
  src: string;
  flags: string[];
}
/// "<target> <mode>" -> library -> its units.
type Collected = Record<string, Record<string, Unit[]>>;

/// A compile command's words, as a shell takes them.
function words(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)) out.push(m[1]?.replace(/\\(.)/g, "$1") ?? m[2] ?? m[3]!);
  return out;
}

/// The flags of a compile command that the Bazel module needs.
function flags(command: string, src: string, include: string, where: string): string[] {
  const w = words(command).slice(1);
  const kept: string[] = [];
  const mapPath = (p: string): string => {
    const resolved = path.resolve(p).split(path.sep).join("/");
    if (resolved === include || resolved.startsWith(`${include}/`)) return `$(CXX)${resolved.slice(include.length)}`;
    if (resolved === src || resolved.startsWith(`${src}/`)) return `$(SRC)${resolved.slice(src.length)}`;
    common.fail(`a path of neither the sources nor the libc++ headers in ${where}: ${p}`);
  };
  for (let i = 0; i < w.length; i++) {
    const a = w[i]!;
    if (["-o", "-c", "-MT", "-MF", "-MQ", "-target", "-isysroot", "-arch"].includes(a)) { i++; continue; }
    if (a === "-Xclang" && w[i + 1] === "-fno-pch-timestamp") { i++; continue; }
    if (a === "-MD" || a === "-MMD" || a === "-pedantic" || a === "-fcolor-diagnostics") continue;
    if (/^(-W|-fdiagnostics-color|-fdebug-prefix-map=|-ffile-prefix-map=|--target=|--sysroot=|-mmacosx?-version-min=)/.test(a)) continue;
    if (a === "-I" || a === "-isystem" || a === "-include") { kept.push(a, mapPath(w[++i]!)); continue; }
    const joined = /^(-I|-isystem)(\/.*|[A-Za-z]:[\\/].*)$/.exec(a);
    if (joined) { kept.push(`${joined[1]}${mapPath(joined[2]!)}`); continue; }
    if (/^(\/|[A-Za-z]:[\\/])/.test(a) || a.includes(os.homedir())) common.fail(`a path in the flags of ${where}: ${a}`);
    kept.push(a);
  }
  return kept;
}

/// The objects of each wanted archive in a build directory (build.ninja),
/// as compile_commands.json compiles them.
function units(build: string, wanted: Record<string, string>, src: string, include: string): Record<string, Unit[]> {
  const commands = new Map<string, { command: string; file: string }>();
  for (const c of JSON.parse(fs.readFileSync(path.join(build, "compile_commands.json"), "utf8"))) {
    commands.set(path.resolve(c.directory, c.output), { command: c.command, file: c.file });
  }
  const result: Record<string, Unit[]> = {};
  for (const line of fs.readFileSync(path.join(build, "build.ninja"), "utf8").split("\n")) {
    const m = /^build ((?:\$ |[^ :])+): (\S*STATIC_LIBRARY_LINKER\S*) (.*)$/.exec(line);
    if (!m) continue;
    const library = wanted[path.basename(m[1]!.replaceAll("$ ", " "))];
    if (!library) continue;
    const inputs = m[3]!.split(/ (?:\|\|?) /)[0]!.split(/(?<!\$) /).map((s) => s.replaceAll("$ ", " "));
    result[library] = inputs.map((object) => {
      const c = commands.get(path.resolve(build, object)) ?? common.fail(`no compile command of ${object} in ${build}`);
      const file = path.resolve(c.file).split(path.sep).join("/");
      if (!file.startsWith(`${src}/`)) common.fail(`${object} is not compiled from the sources: ${file}`);
      return { src: file.slice(src.length + 1), flags: flags(c.command, src, include, object) };
    });
  }
  for (const library of Object.values(wanted)) if (!result[library]) common.fail(`no ${library} in ${build}/build.ninja`);
  return result;
}

function collect(tree: string, out: string, targets: common.Target[]): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-runtimes-"));
  const project = path.join(work, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.28)\nproject(collect LANGUAGES C CXX)\n");
  const src = path.join(tree, "libc++", "src").split(path.sep).join("/");
  const collected: Collected = {};
  for (const t of targets) {
    for (const [mode, options] of Object.entries(MODES)) {
      if (mode === "msan" && t.os !== "linux") continue;
      const build = path.join(work, `${t.triple}-${mode}`);
      common.run("cmake", ["-G", "Ninja", "-S", project, "-B", build, `--toolchain=${path.join(tree, "lib", "cmake", "xclang", "toolchain.cmake")}`,
        `-DXCLANG_TARGET=${t.triple}`, "-DXCLANG_RUNTIMES=source", ...options,
        "-DXCLANG_RUNTIMES_CMAKE_ARGS=-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"]);
      const variants = fs.readdirSync(path.join(build, "xclang-runtimes"), { withFileTypes: true }).filter((e) => e.isDirectory());
      if (variants.length !== 1) common.fail(`${variants.length} variants in ${build}/xclang-runtimes`);
      const variant = path.join(build, "xclang-runtimes", variants[0]!.name);
      const include = path.join(variant, "runtimes", "include", "c++", "v1").split(path.sep).join("/");
      const key = `${t.triple} ${mode}`;
      /// macOS unwinds with the system's libunwind.
      const runtimes = Object.fromEntries(Object.entries(ARCHIVES.runtimes!).filter(([, l]) => l !== "unwind" || t.os !== "darwin"));
      collected[key] = mode === "msan"
        ? units(path.join(variant, "compiler-rt"), ARCHIVES["compiler-rt"]!, src, include)
        : units(path.join(variant, "runtimes"), runtimes, src, include);
      console.log(`${key}: ${Object.entries(collected[key]).map(([l, u]) => `${l} ${u.length}`).join(", ")}`);
    }
  }
  fs.writeFileSync(out, JSON.stringify({ llvm: common.LLVM_VERSION, collected }, null, 1) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
}

/// runtimes_sources.bzl, from collected files.
function bzl(files: string[]): string {
  const all: Collected = {};
  for (const file of files) {
    const { llvm, collected } = JSON.parse(fs.readFileSync(file, "utf8")) as { llvm: string; collected: Collected };
    if (llvm !== common.LLVM_VERSION) common.fail(`${file} is of LLVM ${llvm}, not ${common.LLVM_VERSION}`);
    Object.assign(all, collected);
  }
  /// Flag lists and groups of sources compiled alike, each once.
  const flagLists: string[] = [];
  const flagIndex = (f: string[]) => {
    const json = JSON.stringify(f);
    if (!flagLists.includes(json)) flagLists.push(json);
    return flagLists.indexOf(json);
  };
  const groups: string[] = [];
  const groupIndex = (g: [number, string[]]) => {
    const json = JSON.stringify(g);
    if (!groups.includes(json)) groups.push(json);
    return groups.indexOf(json);
  };
  const runtimes: Record<string, Record<string, number[]>> = {};
  for (const key of Object.keys(all).sort()) {
    for (const [library, list] of Object.entries(all[key]!).sort()) {
      const byFlags = new Map<number, string[]>();
      for (const u of list) {
        const f = flagIndex(u.flags);
        byFlags.set(f, [...(byFlags.get(f) ?? []), u.src]);
      }
      (runtimes[library] ??= {})[key] = [...byFlags].sort(([a], [b]) => a - b).map(([f, srcs]) => groupIndex([f, srcs.sort()]));
    }
  }
  const str = (s: string) => JSON.stringify(s);
  const lines = [
    `"""The C++ runtimes' translation units, as LLVM's CMake build of runtimes/`,
    `compiles them for each target and variant: written by`,
    `packages/bazel/runtimes.ts from the CMake package's builds of LLVM`,
    `${common.LLVM_VERSION}'s, do not edit. bazel/runtimes.bzl makes them libraries.`,
    "",
    "FLAGS: the flag lists, $(SRC) for the sources' directory and $(CXX) for libc++'s",
    "    headers.",
    "GROUPS: sources compiled alike, (an index of FLAGS, sources).",
    `RUNTIMES: library -> "<target> <variant>" -> indices of GROUPS.`,
    `"""`,
    "",
    "FLAGS = [",
    ...flagLists.map((json) => `    [${(JSON.parse(json) as string[]).map(str).join(", ")}],`),
    "]",
    "",
    "GROUPS = [",
    ...groups.map((json) => {
      const [f, srcs] = JSON.parse(json) as [number, string[]];
      return [`    (${f}, [`, ...srcs.map((s) => `        ${str(s)},`), "    ]),"].join("\n");
    }),
    "]",
    "",
    "RUNTIMES = {",
    ...Object.keys(runtimes).sort().flatMap((library) => [
      `    ${str(library)}: {`,
      ...Object.keys(runtimes[library]!).sort().map((key) => `        ${str(key)}: [${runtimes[library]![key]!.join(", ")}],`),
      "    },",
    ]),
    "}",
    "",
  ];
  return lines.join("\n");
}

const [command, ...rest] = process.argv.slice(2);
if (command === "collect") {
  const { values } = parseArgs({ args: rest, options: { tree: { type: "string" }, out: { type: "string" }, targets: { type: "string" } } });
  if (!values.tree || !values.out) common.fail("collect --tree <xclang> --out <file.json> [--targets <triple>,...]");
  const targets = values.targets
    ? values.targets.split(",").map((t) => common.target(t))
    : common.TARGETS.filter((t) => t.os !== "darwin" || process.platform === "darwin");
  collect(path.resolve(values.tree), path.resolve(values.out), targets);
} else if (command === "write" || command === "check") {
  if (!rest.length) common.fail(`${command} <file.json>...`);
  const text = bzl(rest);
  if (command === "write") {
    fs.writeFileSync(BZL, text);
    console.log(`${BZL}: ${text.split("\n").length} lines`);
  } else if (!fs.existsSync(BZL) || fs.readFileSync(BZL, "utf8") !== text) {
    common.fail(`${BZL} is not what LLVM's build compiles now: node packages/bazel/runtimes.ts write <file.json>...`);
  }
} else {
  common.fail("collect | write | check");
}
