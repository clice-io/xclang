/// Cross-compiling with the Bazel module, end to end: a workspace's tests
/// built for another target, then run on a machine of that target
/// (test-bazel.yml's cross jobs, then on-target.yml).
///
///   node tests/bazel/cross.ts build <triple> <dir> [--workspace <ws>] [--accept-license] [-- <bazel arguments>]
///       builds the workspace (tests/bazel by default; the targets of the
///       arguments, //... if none) for @xclang//platforms:<triple>, and puts
///       every cc_test of them into <dir>: its runfiles, and its command line
///       in programs.json, which tests/lib/on-target.ts runs as Bazel runs a
///       test, from the workspace's directory of its runfiles. With
///       --accept-license, the workspace's module accepts the vendors'
///       licenses for the build, and the vendor SDKs are fetched: the MSVC
///       targets', and the macOS targets' off macOS. For tests/bazel, the
///       debug information of //debug:debugged built with -c dbg: an MSVC
///       program's PDB, checked here, and a macOS program with its dSYM in
///       <dir>, which on-target.ts checks there
///   node tests/bazel/cross.ts registry <module> <ws>
///       <ws>: the latest version of a module of the clice registry
///       (bazel.clice.io), from its source archive, on this checkout's
///       xclang module

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { host, writePrograms, type Program } from "../lib/on-target.ts";

const windows = process.platform === "win32";

/// What the aspect (cross.bzl) says of a test: the paths of its executable
/// and its arguments relative to the workspace's directory of its runfiles,
/// which is relative to the execution root.
interface Test {
  label: string;
  runfiles: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
}

function bazel(cwd: string, args: string[]): string {
  const startup = windows ? ["--output_user_root=C:/b", "--windows_enable_symlinks"] : [];
  console.log(`+ bazel ${args.join(" ")} (in ${cwd})`);
  const result = spawnSync("bazel", [...startup, ...args], {
    cwd,
    encoding: "utf8",
    shell: windows,
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) common.fail(`bazel ${args.join(" ")} failed in ${cwd}`);
  return result.stdout;
}

/// Every file under dir, not following symbolic links, nor into runfiles
/// trees if `runfiles` is false.
function walk(dir: string, visit: (file: string) => void, runfiles = true): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && (runfiles || !entry.name.endsWith(".runfiles"))) walk(file, visit, runfiles);
    else if (entry.isFile()) visit(file);
  }
}

/// src copied to dst with its symbolic links resolved (fs.cpSync's
/// `dereference` resolves src's own only).
function copyResolved(src: string, dst: string): void {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyResolved(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
  }
}

function build(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { workspace: { type: "string" }, "accept-license": { type: "boolean" } },
  });
  const [target, dir, ...args] = positionals;
  if (!target || !dir) common.fail("build <triple> <dir> [--workspace <ws>] [--accept-license] [-- <bazel arguments>]");
  const workspace = path.resolve(values.workspace ?? path.join(common.ROOT, "tests", "bazel"));

  /// The aspect, as a package of the workspace.
  const aspect = path.join(workspace, "xclang_cross");
  fs.mkdirSync(aspect, { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, "cross.bzl"), path.join(aspect, "manifest.bzl"));
  fs.writeFileSync(path.join(aspect, "BUILD.bazel"), "");

  /// The vendors' licenses, accepted by the root module as a project's
  /// does (packages/bazel/bazel/sdk.bzl), for this build only: the
  /// workspace's MODULE.bazel gets its own text back after it.
  if (values["accept-license"]) {
    const module = path.join(workspace, "MODULE.bazel");
    const own = fs.readFileSync(module, "utf8");
    process.on("exit", () => fs.writeFileSync(module, own));
    fs.appendFileSync(module, `
# tests/bazel/cross.ts --accept-license
xclang_cross = use_extension("@xclang//bazel:extensions.bzl", "xclang")
xclang_cross.windows_sdk(accept_license = True)
xclang_cross.macos_sdk(accept_license = True)
`);
  }
  collect(workspace, target, path.resolve(dir), args);
}

/// The tests of the build, and for tests/bazel its debug information, in out.
function collect(workspace: string, target: string, out: string, args: string[]): void {
  const platform = `--platforms=@xclang//platforms:${target}`;
  bazel(workspace, ["build", platform, "--aspects=//xclang_cross:manifest.bzl%xclang_cross",
    "--output_groups=+xclang_cross", ...args, ...(args.some((a) => !a.startsWith("-")) ? [] : ["//..."])]);
  /// The build's bazel-bin (bazel info resolves no repository in --platforms).
  const bin = fs.realpathSync(path.join(workspace, "bazel-bin"));
  const execroot = bazel(workspace, ["info", "execution_root"]).trim();

  /// Each test's runfiles, the links resolved, where bazel-bin has them.
  fs.rmSync(out, { recursive: true, force: true });
  const tests: Test[] = [];
  walk(bin, (file) => {
    if (!file.endsWith(".xclang-cross.json")) return;
    const test = JSON.parse(fs.readFileSync(file, "utf8")) as Test;
    const runfiles = path.relative(bin, path.join(execroot, test.runfiles)).replaceAll("\\", "/");
    copyResolved(path.join(execroot, test.runfiles), path.join(out, runfiles));
    tests.push({ ...test, runfiles });
  }, false);
  if (!tests.length) common.fail(`no cc_test built in ${workspace}`);

  /// The toolchain of this machine, which has every target's runtimes.
  const repo = fs.readdirSync(path.join(execroot, "external")).find((n) => n.endsWith(`+xclang_${host()}`));
  if (!repo) common.fail(`no toolchain of ${host()} in ${execroot}/external`);
  const toolchain = path.join(execroot, "external", repo);
  const tool = (name: string) => path.join(toolchain, "bin", `${name}${windows ? ".exe" : ""}`);

  /// macOS's sanitizer runtimes are the toolchain's dylibs, which a program
  /// also finds beside itself (@executable_path): copied there for those
  /// that name one.
  if (target.endsWith("-apple-darwin")) {
    const clang = path.join(toolchain, "lib", "clang");
    const darwin = path.join(clang, fs.readdirSync(clang)[0]!, "lib", "darwin");
    const runtimes = fs.readdirSync(darwin).filter((n) => n.endsWith("_osx_dynamic.dylib"));
    for (const test of tests) {
      const executable = path.join(out, test.runfiles, "_main", test.executable);
      const bytes = fs.readFileSync(executable);
      for (const runtime of runtimes.filter((r) => bytes.includes(r))) {
        fs.copyFileSync(path.join(darwin, runtime), path.join(path.dirname(executable), runtime));
      }
    }
  }
  tests.sort((a, b) => (a.label < b.label ? -1 : 1));
  const programs: Program[] = tests.map((t) => ({
    name: `${t.label.replace(/^@@\/\//, "//")}, built on ${host()}`,
    file: `${t.runfiles}/_main/${t.executable}`,
    runfiles: t.runfiles,
    args: t.args,
    env: t.env,
  }));

  /// tests/bazel's //debug:debugged with -c dbg, for the targets whose
  /// debug information is not in the program: its paths relative to the
  /// execution root, and none of the output base's.
  const msvc = target.endsWith("-pc-windows-msvc");
  const macos = target.endsWith("-apple-darwin");
  if ((msvc || macos) && fs.existsSync(path.join(workspace, "debug", "BUILD.bazel"))) {
    bazel(workspace, ["build", platform, "-c", "dbg", "//debug:debugged"]);
    const built = path.join(fs.realpathSync(path.join(workspace, "bazel-bin")), "debug");
    const outputBase = bazel(workspace, ["info", "output_base"]).trim();
    /// Where the output base's path is in file, with what is around it.
    const leaks = (file: string): string[] => {
      const text = fs.readFileSync(file).toString("latin1");
      return [outputBase, outputBase.replaceAll("/", "\\")].flatMap((p) => {
        const at = text.indexOf(p);
        return at < 0 ? [] : [JSON.stringify(text.slice(Math.max(0, at - 40), at + p.length + 80))];
      });
    };
    if (msvc) {
      /// The PDB, named in the program by its name alone (/pdbaltpath),
      /// with main's line in debug/main.cpp and greet's in the greeter's
      /// repository. It stays here: Microsoft's PDBs of the CRT's static
      /// libraries take part in it.
      const program = path.join(built, "debugged.exe");
      const pdb = path.join(built, "debugged.pdb");
      const directory = capture(tool("llvm-readobj"), ["--coff-debug-directory", program]);
      const text = fs.existsSync(pdb) ? fs.readFileSync(pdb).toString("latin1") : "";
      const files = ["debug\\main.cpp", "external\\+new_local_repository+greeter\\greeter.cpp"];
      const leaked = [...leaks(program), ...leaks(pdb)];
      const ok = /PDBFileName: debugged\.pdb\r?$/m.test(directory) && files.every((f) => text.includes(f)) && !leaked.length;
      if (!ok) {
        common.fail(`debugged.pdb: not named by its name alone in debugged.exe, without ${files.join(" and ")}, ` +
          `or with the output base's path (${leaked.join(", ")}):\n${directory}`);
      }
      console.log(`ok: //debug:debugged's PDB, named debugged.pdb, with ${files.join(" and ")}`);
    } else {
      /// The dSYM, made in the link (dsym_link), beside the program for the
      /// Mac: its UUIDs and main's line by atos there.
      const dsym = path.join(out, "dsym");
      fs.mkdirSync(dsym, { recursive: true });
      copyResolved(path.join(built, "debugged"), path.join(dsym, "debugged"));
      copyResolved(path.join(built, "debugged.dSYM"), path.join(dsym, "debugged.dSYM"));
      const dwarf = path.join(dsym, "debugged.dSYM", "Contents", "Resources", "DWARF", "debugged");
      const address = /^([0-9a-f]+) T _main$/m.exec(capture(tool("llvm-nm"), [path.join(dsym, "debugged")]))?.[1];
      const leaked = leaks(dwarf);
      if (!address || !capture(tool("llvm-dwarfdump"), ["--name=main", dwarf]).includes("main.cpp") || leaked.length) {
        common.fail(`//debug:debugged has no dSYM with main of debug/main.cpp in ${dsym}, or one with the output base's path (${leaked.join(", ")})`);
      }
      programs.push({ name: `//debug:debugged -c dbg with its dSYM, built on ${host()}`, file: "dsym/debugged",
        expect: "hello debugger", adhoc: true, dsym: { address: `0x${address}`, source: "main.cpp" } });
    }
  }
  writePrograms(out, programs);
  console.log(`${out}: ${tests.length} tests of ${workspace} for ${target}`);
}

/// A command's output, stdout then stderr.
function capture(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

async function registry(argv: string[]): Promise<void> {
  const [name, dir] = argv;
  if (!name || !dir) common.fail("registry <module> <ws>");
  const url = `https://bazel.clice.io/modules/${name}`;
  const get = async (file: string) => {
    const response = await fetch(file);
    if (!response.ok) common.fail(`${file}: ${response.status}`);
    return response;
  };
  /// The highest version, compared part by part, numbers as numbers.
  const parts = (v: string) => v.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const newer = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === undefined) return false;
      if (y[i] === undefined) return true;
      return typeof x[i] === typeof y[i] ? x[i]! > y[i]! : typeof x[i] === "number";
    }
    return false;
  };
  const { versions } = await (await get(`${url}/metadata.json`)).json() as { versions: string[] };
  const version = versions.reduce((a, b) => (newer(b, a) ? b : a));
  const source = await (await get(`${url}/${version}/source.json`)).json() as { url: string; integrity: string };
  const archive = Buffer.from(await (await get(source.url)).arrayBuffer());
  const integrity = `sha256-${createHash("sha256").update(archive).digest("base64")}`;
  if (integrity !== source.integrity) common.fail(`${source.url}: ${integrity}, not ${source.integrity}`);

  const workspace = path.resolve(dir);
  fs.rmSync(workspace, { recursive: true, force: true });
  const file = path.join(os.tmpdir(), path.basename(new URL(source.url).pathname));
  fs.writeFileSync(file, archive);
  common.extract(file, workspace);
  fs.rmSync(path.join(workspace, "MODULE.bazel.lock"), { force: true });
  const module = path.join(workspace, "MODULE.bazel");
  fs.appendFileSync(module, `
# tests/bazel/cross.ts: xclang's module of this checkout.
local_path_override(
    module_name = "xclang",
    path = "${path.join(common.ROOT, "packages", "bazel").replaceAll("\\", "/")}",
)
`);
  console.log(`${workspace}: ${name} ${version}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "build") build(rest);
else if (command === "registry") await registry(rest);
else common.fail("build <triple> <dir> [--workspace <ws>] [-- <bazel arguments>] | registry <module> <ws>");
