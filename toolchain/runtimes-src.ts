/// The sources of the C++ runtimes, which every toolchain tree carries once
/// in libc++/src, for the CMake package and the Bazel module to build
/// libc++, libc++abi, libunwind and compiler-rt from (docs/en/features/runtimes-from-source.md):
/// llvm-project's own layout, with xclang's patches applied, so that
/// runtimes/ builds from it as from a checkout.
///
///   runtimes/, cmake/, llvm/cmake/   LLVM's runtimes build and its CMake modules
///   libcxx/, libcxxabi/, libunwind/  without their tests and documentation
///   compiler-rt/                     without its tests and documentation
///   libc/                            the headers of LLVM's libc that libc++
///                                    includes (from_chars of floating point)
///
///   node toolchain/runtimes-src.ts --tree <xclang>
///       <xclang>/libc++/src of this checkout, for a tree without it (a
///       release before them; the tests of the CMake package and the Bazel
///       module against the latest release)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

/// The directories of llvm-project the runtimes' build reads.
const DIRS = ["runtimes", "cmake", "llvm/cmake", "libcxx", "libcxxabi", "libunwind", "compiler-rt", "libc"];

/// What of those directories is left out: tests, documentation, fuzzers,
/// libc++'s scripts but the one its build runs (the include-what-you-use
/// mapping) and its ABI lists, which only its tests read; of libc, all but
/// what libc++ includes (libcHeaders).
function wanted(member: string): boolean {
  if (/(^|\/)(test|tests|unittests)\//.test(member)) return false;
  if (/^libcxx\/utils\//.test(member)) {
    return /^libcxx\/utils\/(CMakeLists\.txt|generate_iwyu_mapping\.py|libcxx\/(__init__|header_information)\.py)$/.test(member);
  }
  if (/^(libcxx\/(docs|lib\/abi)|libcxxabi\/(fuzz|www)|libunwind\/docs|compiler-rt\/docs)\//.test(member)) return false;
  if (member.startsWith("libc/")) return /^libc\/(LICENSE\.TXT|shared\/|src\/__support\/|hdr\/|include\/llvm-libc-(macros|types)\/)/.test(member);
  return DIRS.some((d) => member.startsWith(`${d}/`));
}

/// The headers of libc that libc++'s sources include, from the three of
/// libc/shared that src/include/from_chars_floating_point.h names: every
/// "..." include followed, whatever #if it is under.
const LIBC_ROOTS = ["shared/fp_bits.h", "shared/str_to_float.h", "shared/str_to_integer.h"];

function libcHeaders(libc: string): Set<string> {
  const seen = new Set<string>();
  const todo = [...LIBC_ROOTS];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of fs.readFileSync(path.join(libc, file), "utf8").matchAll(/^\s*#\s*include\s*"([^"]+)"/gm)) {
      const found = [path.posix.join(path.posix.dirname(file), m[1]!), m[1]!].find((f) => fs.existsSync(path.join(libc, f)));
      if (found) todo.push(path.posix.normalize(found));
    }
  }
  return seen;
}

/// The patches of patches/ that change files kept here, applied as
/// common.llvmSource applies them, to those files only: a patch's changes
/// of clang, or of libc++'s tests, are not for these sources.
function patch(dir: string): string[] {
  const applied: string[] = [];
  for (const p of common.patches()) {
    /// One section per file, from its --- line to the next one's.
    const lines = fs.readFileSync(p.file, "utf8").split("\n");
    const starts = lines.flatMap((line, i) => (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ") ? [i] : []));
    const sections = starts.map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length));
    const ours = sections.filter((s) => wanted(s[1]!.replace(/^\+\+\+ b\//, "").split(/\s/)[0]!));
    if (!ours.length) continue;
    /// From bash, which has patch also on Windows (Git's).
    const result = spawnSync("bash", ["-c", "patch -p1 -F0 --forward --silent"], {
      cwd: dir,
      input: ours.map((s) => s.join("\n")).join("\n") + "\n",
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) common.fail(`patches/${p.name} does not apply to the runtimes' sources`);
    applied.push(p.name);
  }
  return applied;
}

/// Every file under dir, by its path relative to it with forward slashes.
function files(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => f.split(path.sep).join("/"))
    .filter((f) => fs.lstatSync(path.join(dir, f)).isFile());
}

/// Remove dir's empty directories, dir too if it is left empty.
function prune(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) prune(path.join(dir, entry.name));
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/// The runtimes' sources, patched, in dest (made anew). The directories are
/// unpacked whole, by the system's tar (Windows' own on Windows, which
/// reads xz too), and what is not wanted removed.
export async function runtimesSources(dest: string): Promise<void> {
  const stage = `${dest}.part`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const archive = await common.fetchSource("llvm-project");
  const top = `llvm-project-${common.LLVM_VERSION}.src`;
  const tar = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
  common.run(tar, ["-xf", archive, "-C", stage, "--strip-components=1", ...DIRS.map((d) => `${top}/${d}`)]);
  for (const file of files(stage)) if (!wanted(file)) fs.rmSync(path.join(stage, file));
  const applied = patch(stage);
  /// libc++'s own patches, which its prebuilt builds carry.
  for (const name of ["0006-libcxx-format-buffer-full", "0016-libcxx-vcruntime"]) {
    if (!applied.includes(name)) common.fail(`patches/${name} is not among the runtimes' patches: ${applied.join(", ")}`);
  }
  const libc = path.join(stage, "libc");
  const headers = libcHeaders(libc);
  for (const file of files(libc)) if (file !== "LICENSE.TXT" && !headers.has(file)) fs.rmSync(path.join(libc, file));
  prune(stage);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(stage, dest);
  console.log(`runtimes' sources in ${dest}, with ${applied.join(", ")}`);
}

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({ options: { tree: { type: "string" } } });
  if (!values.tree) common.fail("--tree <xclang>");
  await runtimesSources(path.join(path.resolve(values.tree), "libc++", "src"));
}
