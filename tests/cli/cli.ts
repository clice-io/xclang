/// Check xclang's own command (xclang/) in a toolchain tree, on a machine of
/// the tree's host:
///
///   node tests/cli/cli.ts --tree <xclang> --out <dir>
///       sdk list; both SDKs fetched from the vendors into the tree; C, C++
///       and Objective-C programs cross-compiled against them for arm64 and
///       x86_64 macOS and for x64 and arm64 Windows (MSVC ABI), into
///       <dir>/<target>/cli-<host> (programs only: nothing of an SDK), which
///       tests/lib/on-target.ts runs on a machine of each target; target
///       list, add and remove against a test index
///
/// The programs and what they check are the SDK probe's (tests/sdk).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { programsDir, writePrograms } from "../lib/on-target.ts";

const { values } = parseArgs({ options: { tree: { type: "string" }, out: { type: "string" } } });
const windows = process.platform === "win32";
const exe = windows ? ".exe" : "";
const sources = path.join(import.meta.dirname, "..", "sdk");
const failures: string[] = [];
const summary: string[] = [];

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/// Run a command; its status and output, printed. A failure of an expected
/// status is recorded.
function run(cmd: string, args: string[], expect: number | null = 0, cwd?: string): { status: number | null; out: string; err: string } {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const start = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, maxBuffer: 1 << 28 });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  if (r.error) console.log(`  ${r.error.message}`);
  if (expect !== null && r.status !== expect) {
    failures.push(`${path.basename(cmd)} ${args.join(" ")}: exit ${r.status}, expected ${expect}`);
  } else {
    console.log(`  (exit ${r.status}, ${seconds} s)`);
  }
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

function finish(): void {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  }
  if (failures.length) fail(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  console.log("all passed");
}

if (!values.tree || !values.out) fail("--tree <xclang> --out <dir>");
const tree = path.resolve(values.tree);
const out = path.resolve(values.out);
const tool = (name: string) => path.join(tree, "bin", name + exe);
const xclang = (args: string[], expect: number | null = 0) => run(tool("xclang"), args, expect);

/// 1. The program and its version table.
const version = xclang(["--version"]).out;
const release = /^release: (\S+)$/m.exec(version)?.[1] ?? "unknown";
const list = xclang(["sdk", "list"]).out;
check(/\(default\)/.test(list) && /14\.44\.17\.14/.test(list) && /26\.5/.test(list), "sdk list shows presets and versions");

/// 2. The SDKs, from the vendors.
const refused = xclang(["sdk", "fetch", "macos"], 1);
check(/Apple/.test(refused.err), "sdk fetch without --accept-license shows the license");
const sdks: Record<string, string> = {};
for (const vendor of ["macos", "windows"]) {
  const start = Date.now();
  xclang(["sdk", "fetch", vendor, "--accept-license"]);
  const seconds = ((Date.now() - start) / 1000).toFixed(0);
  sdks[vendor] = xclang(["sdk", "path", vendor]).out.trim();
  summary.push(`- ${vendor} SDK: fetched and unpacked in ${seconds} s into ${sdks[vendor]}`);
}
check(fs.existsSync(path.join(sdks.macos!, "SDKSettings.json")), "the macOS SDK has SDKSettings.json");
check(fs.existsSync(path.join(sdks.windows!, "VC", "Tools", "MSVC")), "the /winsysroot has VC/Tools/MSVC");
check(/macos-26\.5/.test(xclang(["sdk", "list", "macos"]).out), "sdk list shows the fetched SDK");
/// The MSVC targets' config files read the SDK in use through
/// bin/<triple>-sdk.cfg, which fetch wrote: clang takes its headers, also
/// on Windows, where it finds Visual Studio without one.
for (const arch of ["x86_64", "aarch64"]) {
  const cfg = fs.readFileSync(path.join(tree, "bin", `${arch}-pc-windows-msvc-sdk.cfg`), "utf8");
  const r = run(tool("clang"), [`--target=${arch}-pc-windows-msvc`, "-###", "-c", path.join(sources, "hello.c")]);
  check(cfg.includes(`\n@../sdk/windows/${arch}-pc-windows-msvc.cfg\n`) &&
    /sdk[\\/]+windows[\\/]+VC[\\/]+Tools[\\/]+MSVC[\\/]+[\d.]+[\\/]+include/.test(r.err),
    `${arch}-pc-windows-msvc: clang reads the SDK in use`);
}

/// 3. Programs cross-compiled against them.
const built: string[] = [];
function build(name: string, cmd: string, args: string[], output: string): void {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const r = run(tool(cmd), args, null, path.dirname(output));
  const ok = r.status === 0 && fs.existsSync(output);
  check(ok, name);
  if (ok) built.push(output);
}
const src = (f: string) => path.join(sources, f);
for (const arch of ["arm64", "x86_64"]) {
  const o = programsDir(out, `${arch === "arm64" ? "aarch64" : arch}-apple-darwin`, "cli");
  const cc = [`--target=${arch}-apple-macos`, "-isysroot", sdks.macos!, "-O2"];
  build(`macOS ${arch} C`, "clang", [...cc, src("hello.c"), "-o", path.join(o, "hello-c")], path.join(o, "hello-c"));
  build(`macOS ${arch} C++ (exceptions, threads, filesystem, format)`, "clang++",
    [...cc, "-std=c++23", src("hello.cpp"), "-o", path.join(o, "hello-cpp")], path.join(o, "hello-cpp"));
  build(`macOS ${arch} C++ ThinLTO`, "clang++",
    [...cc, "-std=c++23", "-flto=thin", src("hello.cpp"), "-o", path.join(o, "hello-cpp-lto")], path.join(o, "hello-cpp-lto"));
  build(`macOS ${arch} CoreFoundation`, "clang",
    [...cc, src("cf.c"), "-framework", "CoreFoundation", "-o", path.join(o, "cf")], path.join(o, "cf"));
  build(`macOS ${arch} Objective-C, Foundation`, "clang",
    [...cc, "-fobjc-arc", src("objc.m"), "-framework", "Foundation", "-o", path.join(o, "objc")], path.join(o, "objc"));
}
const msvc = (arch: string) => programsDir(out, `${arch}-pc-windows-msvc`, "cli");
for (const arch of ["x86_64", "aarch64"]) {
  const o = msvc(arch);
  /// Inputs after --: clang-cl takes /Users/... (macOS) for its /U option.
  const cl = [`--target=${arch}-pc-windows-msvc`, "/winsysroot", sdks.windows!, "-fuse-ld=lld", "/O2"];
  const fe = (n: string) => [`/Fe${path.join(o, n)}`];
  build(`MSVC ${arch} clang-cl C`, "clang-cl", [...cl, ...fe("hello-c.exe"), "--", src("hello.c")], path.join(o, "hello-c.exe"));
  build(`MSVC ${arch} clang-cl C++ /MT`, "clang-cl",
    [...cl, "/EHsc", "/std:c++latest", ...fe("hello-cpp.exe"), "--", src("hello.cpp")], path.join(o, "hello-cpp.exe"));
  build(`MSVC ${arch} clang-cl C++ /MD`, "clang-cl",
    [...cl, "/EHsc", "/MD", "/std:c++latest", ...fe("hello-cpp-md.exe"), "--", src("hello.cpp")], path.join(o, "hello-cpp-md.exe"));
  build(`MSVC ${arch} clang-cl C++ ThinLTO`, "clang-cl",
    [...cl, "/EHsc", "/std:c++latest", "-flto=thin", ...fe("hello-cpp-lto.exe"), "--", src("hello.cpp")], path.join(o, "hello-cpp-lto.exe"));
  build(`MSVC ${arch} clang++ (GNU driver) C++`, "clang++",
    [`--target=${arch}-pc-windows-msvc`, "-Xmicrosoft-windows-sys-root", sdks.windows!, "-fuse-ld=lld", "-O2", "-std=c++23",
      src("hello.cpp"), "-o", path.join(o, "hello-cpp-gnu.exe")], path.join(o, "hello-cpp-gnu.exe"));
  build(`MSVC ${arch} clang-cl Win32 API`, "clang-cl",
    [...cl, ...fe("win32.exe"), "--", src("win32.c"), "user32.lib", "advapi32.lib"], path.join(o, "win32.exe"));
}
/// Only the programs leave the job: no import libraries, no objects.
for (const dir of [msvc("x86_64"), msvc("aarch64")]) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".exe")) fs.rmSync(path.join(dir, f));
  }
}
/// Each must run and end with 0 on a machine of its target.
for (const dir of new Set(built.map((f) => path.dirname(f)))) {
  writePrograms(dir, built.filter((f) => path.dirname(f) === dir).map((f) => ({ file: path.basename(f) })));
}
for (const [file, runtime] of [["hello-cpp.exe", false], ["hello-cpp-md.exe", true]] as const) {
  const f = path.join(msvc("x86_64"), file);
  if (!fs.existsSync(f)) continue;
  const dlls = [...run(tool("llvm-objdump"), ["-p", f]).out.matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]!);
  check(dlls.some((d) => /^vcruntime/i.test(d)) === runtime, `${file} loads ${runtime ? "the" : "no"} VC runtime DLL: ${dlls.join(" ")}`);
}
summary.push(`- ${built.length} programs cross-compiled for macOS and Windows (MSVC)`);

/// 4. Targets, from a test index next to its archives.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-cli-"));
function archive(name: string, files: Record<string, string>): { archive: string; sha256: string; size: number } {
  const stage = path.join(work, `stage-${name}`);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
    fs.writeFileSync(path.join(stage, f), text);
  }
  /// Relative names: GNU tar (Git's, on Windows) takes C: for a host.
  const file = `${name}.tar.xz`;
  const r = spawnSync("tar", ["-cJf", path.join("..", file), ...Object.keys(files)], { cwd: stage, encoding: "utf8" });
  if (r.status !== 0) fail(`tar: ${r.stderr}`);
  const data = fs.readFileSync(path.join(work, file));
  return { archive: file, sha256: createHash("sha256").update(data).digest("hex"), size: data.length };
}
function listTree(): string[] {
  return (fs.readdirSync(tree, { recursive: true }) as string[]).filter((f) => !f.startsWith("sdk")).sort();
}
const triple = "test-unknown-none";
const good = archive("good", {
  [`xclang/${triple}/include/test.h`]: "#define TEST 1\n",
  [`xclang/${triple}/lib/libtest.a`]: "!<arch>\n",
  [`xclang/bin/${triple}.cfg`]: `--sysroot=<CFGDIR>/../${triple}\n`,
  [`xclang/lib/clang/23/lib/${triple}/libclang_rt.builtins.a`]: "!<arch>\n",
});
const conflict = archive("conflict", { "xclang/test-conflict/a.txt": "a\n", "xclang/LICENSE": "not the toolchain's\n" });
const entry = (a: typeof good, description: string) => ({ description, tier: 3, sdk: null, ...a });
const index = (version: string) => ({
  schema: 1,
  version,
  targets: {
    [triple]: entry(good, "a test target"),
    "test-corrupt": { ...entry(good, "its sha256 is wrong"), sha256: "0".repeat(64) },
    "test-conflict": entry(conflict, "overwrites the toolchain's LICENSE"),
    "test-msvc": { ...entry(good, "needs an SDK"), sdk: "windows" },
  },
});
const indexFile = path.join(work, "index.json");
fs.writeFileSync(indexFile, JSON.stringify(index(release === "unknown" ? "test" : release), null, 1));
const before = listTree();
const license = fs.readFileSync(path.join(tree, "LICENSE"), "utf8");
const i = ["--index", indexFile];
const targets = xclang(["target", "list", ...i]).out;
check(/x86_64-w64-mingw32\s+tier 1/.test(targets) && targets.includes(triple), "target list shows the built-in targets and the index's");
xclang(["target", "add", triple, ...i]);
check(fs.existsSync(path.join(tree, triple, "include", "test.h")) && fs.existsSync(path.join(tree, "bin", `${triple}.cfg`)),
  "target add unpacks the archive into the toolchain");
check(/added/.test(xclang(["target", "list", ...i]).out), "target list shows the target added");
check(/added already/.test(xclang(["target", "add", triple, ...i]).err), "target add of an added target does nothing");
check(/built into/.test(xclang(["target", "add", "x86_64-w64-mingw32", ...i]).err), "target add of a built-in target says so");
xclang(["target", "remove", "x86_64-w64-mingw32"], 1);
xclang(["target", "remove", triple]);
check(JSON.stringify(listTree()) === JSON.stringify(before), "target remove leaves the toolchain as it was");
xclang(["target", "add", "test-corrupt", ...i], 1);
xclang(["target", "add", "test-conflict", ...i], 1);
check(!fs.existsSync(path.join(tree, "test-conflict")) && fs.readFileSync(path.join(tree, "LICENSE"), "utf8") === license,
  "target add refuses to overwrite the toolchain's files and takes back what it wrote");
check(/needs the windows SDK/.test(xclang(["target", "add", "test-msvc", ...i]).err), "target add names the SDK a target needs");
xclang(["target", "remove", "test-msvc"]);
check(JSON.stringify(listTree()) === JSON.stringify(before), "the toolchain is as it was");
if (release !== "unknown") {
  fs.writeFileSync(indexFile, JSON.stringify(index("0.0.0.0")));
  xclang(["target", "add", triple, ...i], 1);
}
summary.push("- target list, add, remove: against a test index");

/// 5. sdk remove.
xclang(["sdk", "remove", path.basename(sdks.macos!)]);
check(!fs.existsSync(sdks.macos!), "sdk remove removes the SDK");
finish();
