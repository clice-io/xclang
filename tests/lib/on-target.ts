/// Programs built on one machine for another target, run on a machine of
/// that target (on-target.yml), with nothing installed there. Every check
/// that builds for another target leaves its programs in one layout:
///
///   <dir>/<target>/<origin>/programs.json   the programs (Program), each
///                                           file relative to it; none on
///                                           purpose (a target the archives
///                                           lack) if empty
///   <dir>/<target>/<origin>/expected.txt    or: every other file there is
///                                           a program that prints it
///
/// <origin> names what built them on which host (programsDir), so that the
/// artifacts of several machines merge into one <dir>.
///
///   node tests/lib/on-target.ts <dir>...
///       runs every program under the directories, a table of them in the
///       job summary; fails if one fails or there is none, but for empty
///       programs.json files

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/// A program of a programs.json.
export interface Program {
  file: string;
  /// What the summary calls it; its file by default.
  name?: string;
  args?: string[];
  env?: Record<string, string>;
  /// A text its output (stdout, then stderr) must have.
  expect?: string;
  /// Its whole output, carriage returns and trailing newlines aside.
  output?: string;
  /// It must end with other than 0, or abort (as ASan and TSan do on macOS).
  fails?: boolean;
  /// It must end on a trap (__builtin_trap): SIGILL or SIGTRAP, or on
  /// Windows an exception's status.
  trap?: boolean;
  /// It must write a profile, LLVM_PROFILE_FILE.
  profile?: boolean;
  /// Where it runs: a directory relative to programs.json, or $NAME for an
  /// environment variable naming one (kotatsu's tests: $KOTATSU_SRC).
  cwd?: string;
  /// A Bazel test: its runfiles directory, relative to programs.json. It
  /// runs from the workspace's directory there, with Bazel's test
  /// environment, as `bazel test` runs it.
  runfiles?: string;
  /// macOS on arm64: ld64.lld's ad-hoc signature, as `codesign -dv` reads it.
  adhoc?: boolean;
  /// macOS: <file>.dSYM beside it, the program's UUIDs, with the address of
  /// a function of `source` (dwarfdump, atos).
  dsym?: { address: string; source: string };
}

/// The host of this machine, as a release names it.
export function host(): string {
  const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-w64-mingw32`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

/// The directory of the programs a check (`origin`) built here for
/// `target`, under out.
export function programsDir(out: string, target: string, origin: string): string {
  const dir = path.join(out, target, `${origin}-${host()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/// Write a directory's programs.json.
export function writePrograms(dir: string, programs: Program[]): void {
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(programs, null, 1) + "\n");
}

const clean = (text: string) => text.replaceAll("\r", "").replace(/\n+$/, "");

/// Every program under dir: those of each programs.json, and those beside
/// an expected.txt; never inside a runfiles tree. empty lists the
/// directories whose programs.json lists none.
function find(root: string, dir: string, found: { root: string; dir: string; program: Program }[], empty: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const names = entries.map((e) => e.name);
  if (names.includes("programs.json")) {
    const programs = JSON.parse(fs.readFileSync(path.join(dir, "programs.json"), "utf8")) as Program[];
    if (!programs.length) empty.push(dir);
    for (const program of programs) found.push({ root, dir, program });
    return;
  }
  if (names.includes("expected.txt")) {
    const output = clean(fs.readFileSync(path.join(dir, "expected.txt"), "utf8"));
    for (const e of entries) if (e.isFile() && e.name !== "expected.txt") found.push({ root, dir, program: { file: e.name, output } });
  }
  for (const e of entries) if (e.isDirectory() && !e.name.endsWith(".runfiles")) find(root, path.join(dir, e.name), found, empty);
}

/// Every file under dir, for their modes.
function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, visit);
    else if (entry.isFile()) visit(file);
  }
}

function capture(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/// Run every program under the roots; the number that failed, or -1 if
/// there was none and no empty programs.json either.
export function runPrograms(roots: string[]): number {
  const windows = process.platform === "win32";
  const arm64Mac = process.platform === "darwin" && os.arch() === "arm64";
  const found: { root: string; dir: string; program: Program }[] = [];
  const empty: string[] = [];
  for (const root of roots) if (fs.existsSync(root)) find(path.resolve(root), path.resolve(root), found, empty);
  for (const dir of empty) console.log(`nothing to run in ${dir}, on purpose`);
  const rows: string[] = [];
  let failed = 0;
  for (const { root, dir, program: p } of found) {
    const file = path.resolve(dir, p.file);
    const name = p.name ?? path.relative(root, file).replaceAll("\\", "/");
    const problems: string[] = [];
    /// Artifacts keep no modes.
    if (!windows) {
      if (p.runfiles) walk(path.resolve(dir, p.runfiles), (f) => fs.chmodSync(f, 0o755));
      else fs.chmodSync(file, 0o755);
    }
    let cwd = dir;
    const env: NodeJS.ProcessEnv = { ...process.env, ...p.env };
    if (p.cwd?.startsWith("$")) {
      const named = process.env[p.cwd.slice(1)];
      if (!named) problems.push(`${p.cwd}: not set`);
      cwd = named ?? dir;
    } else if (p.cwd) {
      cwd = path.resolve(dir, p.cwd);
    }
    if (p.runfiles) {
      const runfiles = path.resolve(dir, p.runfiles);
      cwd = path.join(runfiles, "_main");
      Object.assign(env, {
        RUNFILES_DIR: runfiles,
        TEST_SRCDIR: runfiles,
        TEST_WORKSPACE: "_main",
        TEST_TMPDIR: fs.mkdtempSync(path.join(os.tmpdir(), "test-")),
      });
    }
    const profile = `${file}.profraw`;
    if (p.profile) {
      fs.rmSync(profile, { force: true });
      env.LLVM_PROFILE_FILE = profile;
    }
    console.log(`+ ${[file, ...(p.args ?? [])].join(" ")}`);
    const start = Date.now();
    const r = spawnSync(file, p.args ?? [], { cwd, env, encoding: "utf8", maxBuffer: 1 << 28, timeout: 600_000 });
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    process.stdout.write(out.length > 20000 ? `${out.slice(0, 10000)}\n...\n${out.slice(-10000)}` : out);
    if (r.error) problems.push(r.error.message);
    const ended = r.status ?? r.signal;
    const endedAsExpected = p.trap
      ? r.signal === "SIGILL" || r.signal === "SIGTRAP" || (r.status !== null && (r.status < 0 || r.status > 255))
      : p.fails ? (r.status !== null && r.status !== 0) || r.signal === "SIGABRT" : r.status === 0;
    if (!endedAsExpected) problems.push(`ended with ${ended}`);
    if (p.expect !== undefined && !out.includes(p.expect)) problems.push(`no "${p.expect}" in its output`);
    if (p.output !== undefined && clean(out) !== p.output) problems.push(`printed ${JSON.stringify(clean(out))}, not ${JSON.stringify(p.output)}`);
    if (p.profile && !(fs.existsSync(profile) && fs.statSync(profile).size > 0)) problems.push("no profile");
    /// On Apple silicon the kernel runs only signed code: ld64.lld signs
    /// what it links for arm64 ad hoc.
    if (p.adhoc && arm64Mac && !/Signature=adhoc/.test(capture("codesign", ["-dv", file]))) problems.push("no ad-hoc signature");
    if (p.dsym && process.platform === "darwin") {
      const uuids = (f: string) => [...capture("dwarfdump", ["--uuid", f]).matchAll(/UUID: (\S+) \((\w+)\)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
      const [own, its] = [uuids(file), uuids(`${file}.dSYM`)];
      if (!own.length || JSON.stringify(own) !== JSON.stringify(its)) problems.push(`its dSYM's UUIDs ${its.join(", ")}, not ${own.join(", ")}`);
      const dwarf = path.join(`${file}.dSYM`, "Contents", "Resources", "DWARF", path.basename(file));
      const where = capture("atos", ["-o", dwarf, "-arch", arm64Mac ? "arm64" : "x86_64", p.dsym.address]);
      if (!where.includes(`${p.dsym.source}:`)) problems.push(`atos ${p.dsym.address}: ${where.trim()}`);
    }
    const ok = problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name} (${seconds} s)${ok ? "" : `: ${problems.join("; ")}`}`);
    const first = clean(out).split("\n")[0]!.slice(0, 80).replaceAll("|", "\\|");
    rows.push(`| ${ok ? "passed" : `**failed**: ${problems.join("; ").replaceAll("|", "\\|")}`} | \`${name}\` | ${first} | ${seconds} s |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Run on ${host()}\n\n| | program | prints | |\n|---|---|---|---|\n${rows.join("\n")}\n\n`);
  }
  console.log(`${found.length} programs ran, ${failed} failed`);
  return found.length || empty.length ? failed : -1;
}

if (import.meta.main) {
  const roots = process.argv.slice(2);
  if (!roots.length) {
    console.error("error: <dir>...");
    process.exit(1);
  }
  const failed = runPrograms(roots);
  if (failed) {
    console.error(`error: ${failed < 0 ? `no programs under ${roots.join(", ")}` : `${failed} programs failed`}`);
    process.exit(1);
  }
}
