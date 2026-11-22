/// Experiment (exp/musl-hosts only): after toolchain.ts has built a musl
/// host, relink its llvm with other allocators and without the larger
/// thread stacks, into work/out/variants-<host>/<name>/llvm (stripped), and
/// <name>-syms (symbols kept, no debug info) for perf.
///
///   node exp/musl/variants.ts --host <triple>

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";

const { values } = parseArgs({ options: { host: { type: "string" } } });
const host = common.target(values.host!);
const stage = path.join(common.WORK, "stage", `toolchain-${host.triple}-release`);
const build = path.join(common.WORK, "build", `toolchain-${host.triple}`);
const out = path.join(common.WORK, "out", `variants-${host.triple}`);
const tool = (name: string) => path.join(stage, "bin", name);
/// common.run, but throwing: a variant that fails leaves the others.
function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): void {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${cmd} exited with ${result.status ?? result.signal}`);
}
fs.rmSync(out, { recursive: true, force: true });

const SOURCES = {
  mimalloc2: { url: "https://github.com/microsoft/mimalloc/archive/refs/tags/v2.5.3.tar.gz", sha256: "d0e7b923533db035bbda50e1582c3a9b1d06827b03be68618d789071e024e1ee" },
  snmalloc: { url: "https://github.com/microsoft/snmalloc/archive/refs/tags/0.7.6.tar.gz", sha256: "41eb07b22c835051e7f28e812b2436c56f7476fe1dde4aeafb5a5c1ebcec1547" },
  jemalloc: { url: "https://github.com/jemalloc/jemalloc/releases/download/5.4.0/jemalloc-5.4.0.tar.bz2", sha256: "200776fac271093e7c2f21edd6d62657ecd2be578d9328633f2a86bfa6ef4f1d" },
};
async function source(name: keyof typeof SOURCES): Promise<string> {
  const dir = path.join(common.WORK, "src", `exp-${name}`);
  if (fs.existsSync(dir)) return dir;
  const file = path.join(common.WORK, "downloads", path.basename(SOURCES[name].url));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run("curl", ["-sfL", "-o", file, SOURCES[name].url]);
  const sum = common.capture("sha256sum", [file]).split(" ")[0];
  if (sum !== SOURCES[name].sha256) common.fail(`${file}: ${sum}`);
  fs.mkdirSync(dir, { recursive: true });
  run("tar", ["-xf", file, "-C", dir, "--strip-components=1"]);
  return dir;
}

const cmakeArgs = (src: string, dir: string, extra: string[]) => [
  "-G", "Ninja", "-S", src, "-B", dir, ...common.cmakeToolchainArgs(stage, host), "-DCMAKE_BUILD_TYPE=Release", ...extra,
];

async function mimalloc2(): Promise<string> {
  const src = await source("mimalloc2");
  const dir = path.join(common.WORK, "build", `exp-mimalloc2-${host.triple}`);
  run("cmake", cmakeArgs(src, dir, ["-DMI_OVERRIDE=ON", "-DMI_LIBC_MUSL=ON", "-DMI_OPT_ARCH=OFF", "-DMI_BUILD_SHARED=OFF", "-DMI_BUILD_TESTS=OFF"]));
  run("cmake", ["--build", dir, "--target", "mimalloc-obj"]);
  return path.join(dir, "CMakeFiles", "mimalloc-obj.dir", "src", "static.c.o");
}

async function snmalloc(): Promise<string> {
  const src = await source("snmalloc");
  const dir = path.join(common.WORK, "build", `exp-snmalloc-${host.triple}`);
  run("cmake", cmakeArgs(src, dir, ["-DSNMALLOC_STATIC_LIBRARY_PREFIX=", "-DSNMALLOC_CLEANUP=CXX11_DESTRUCTORS", "-DSNMALLOC_BUILD_TESTING=OFF"]));
  run("cmake", ["--build", dir, "--target", "snmallocshim-static"]);
  return path.join(dir, "libsnmallocshim-static.a");
}

async function jemalloc(): Promise<string> {
  const src = await source("jemalloc");
  const dir = path.join(common.WORK, "build", `exp-jemalloc-${host.triple}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cc = `${tool("clang")} --target=${host.triple}`;
  run(path.join(src, "configure"), [
    `--host=${host.triple}`, "--build=x86_64-pc-linux-gnu", "--disable-cxx", "--disable-stats", "--disable-libdl",
    `--with-lg-page=${host.arch === "aarch64" ? 16 : 12}`,
  ], { cwd: dir, env: { ...process.env, CC: cc, CXX: `${tool("clang++")} --target=${host.triple}`, AR: tool("llvm-ar"),
    RANLIB: tool("llvm-ranlib"), NM: tool("llvm-nm"), CFLAGS: "-O3" } });
  run("make", ["-j", common.jobs(), "build_lib_static"], { cwd: dir });
  return path.join(dir, "lib", "libjemalloc.a");
}

const cache = fs.readFileSync(path.join(build, "CMakeCache.txt"), "utf8");
const base = /^CMAKE_EXE_LINKER_FLAGS:STRING=(.*)$/m.exec(cache)![1]!.split(" ");
const mi3 = base.find((f) => f.endsWith("static.c.o"))!;
const stack = base.find((f) => f.startsWith("-Wl,-z,stack-size="))!;
const without = (...drop: string[]) => base.filter((f) => !drop.includes(f));
const whole = (lib: string) => ["-Wl,--whole-archive", lib, "-Wl,--no-whole-archive"];
console.log(`base flags: ${base.join(" ")}`);

function save(name: string, syms: boolean): void {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  run(tool("llvm-strip"), ["--strip-all", "-o", path.join(dir, "llvm"), path.join(build, "bin", "llvm")]);
  if (syms) {
    fs.mkdirSync(`${dir}-syms`, { recursive: true });
    run(tool("llvm-strip"), ["--strip-debug", "-o", path.join(`${dir}-syms`, "llvm"), path.join(build, "bin", "llvm")]);
  }
}

save("mimalloc3", true);
const variants: [string, () => Promise<string[]>, boolean][] = [
  ["mallocng", async () => without(mi3), true],
  ["mimalloc3-nostack", async () => without(stack), false],
  ["mimalloc2", async () => [...without(mi3), await mimalloc2()], false],
  ["snmalloc", async () => [...without(mi3), ...whole(await snmalloc())], false],
  ["jemalloc", async () => [...without(mi3), ...whole(await jemalloc())], false],
];
const summary: string[] = [];
for (const [name, flags, syms] of variants) {
  try {
    const f = await flags();
    run("cmake", ["-B", build, `-DCMAKE_EXE_LINKER_FLAGS=${f.join(" ")}`]);
    const start = Date.now();
    fs.rmSync(path.join(build, "bin", "llvm"));
    run("ninja", ["-C", build, "bin/llvm"]);
    summary.push(`${name}: relinked in ${Math.round((Date.now() - start) / 1000)} s`);
    save(name, syms);
  } catch (error) {
    summary.push(`${name}: failed ${error}`);
  }
}
const nm = (dir: string) => new Set(common.capture(tool("llvm-nm"), ["--defined-only", "--just-symbol-name", path.join(out, dir, "llvm")]).split("\n"));
for (const dir of ["mimalloc3-syms", "mallocng-syms"]) {
  const s = nm(dir);
  summary.push(`${dir}: mi_malloc ${s.has("mi_malloc")}, __libc_malloc_impl ${s.has("__libc_malloc_impl")}, __malloc_alloc_meta ${s.has("__malloc_alloc_meta")}`);
}
for (const dir of fs.readdirSync(out)) {
  const file = path.join(out, dir, "llvm");
  const ph = common.capture(tool("llvm-readelf"), ["--program-headers", file]);
  summary.push(`${dir}: ${(fs.statSync(file).size / 1048576).toFixed(1)} MB, ${/GNU_STACK.*$/m.exec(ph)?.[0].replace(/\s+/g, " ")}`);
}
console.log(summary.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["```", ...summary, "```", ""].join("\n"));
