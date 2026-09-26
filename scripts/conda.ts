/// The conda packages of a release, from its archives, for the clice conda
/// channel (clice-io/conda, https://conda.clice.io):
///
///   xclang                   one per host subdir: bin/ (llvm, its names, the
///                            config files), clang's resource headers, and
///                            the activation scripts that put bin/ in PATH
///   xclang-<triple>          noarch, one per Linux and Windows target: its
///                            directory (sysroot, libc++) and its compiler-rt
///   xclang-apple-darwin      noarch: both macOS targets and their universal
///                            compiler-rt
///   llvm-option-inc          noarch: the option tables, in include/
///
/// Everything installs under $PREFIX/opt/xclang, the same path on every
/// platform, as noarch packages need; nothing goes to $PREFIX/bin, so
/// conda-forge's clang is left alone. `xclang` depends on the target package
/// of its own platform and pins the others to its version. Versions are the
/// release's (23.1.2.1); a build number counts packaging fixes only.
///
///   node scripts/conda.ts --dist <release assets> --version <x.y.z.r>
///     --rattler-build <path> --out <channel directory>

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "./common.ts";

const { values } = parseArgs({
  options: {
    dist: { type: "string" },
    version: { type: "string" },
    "rattler-build": { type: "string", default: "rattler-build" },
    out: { type: "string" },
    build: { type: "string", default: "0" },
    /// A subset of the hosts, for trying the packaging out.
    hosts: { type: "string" },
  },
});
if (!values.dist || !values.version || !values.out) {
  common.fail("--dist <release assets> --version <x.y.z.r> [--rattler-build <path>] --out <dir>");
}
const version = values.version;
const dist = path.resolve(values.dist);
const out = path.resolve(values.out);
const work = path.join(common.WORK, "conda");
fs.rmSync(work, { recursive: true, force: true });

const SUBDIRS: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "linux-64",
  "aarch64-unknown-linux-gnu": "linux-aarch64",
  "x86_64-w64-mingw32": "win-64",
  "aarch64-w64-mingw32": "win-arm64",
  "x86_64-apple-darwin": "osx-64",
  "aarch64-apple-darwin": "osx-arm64",
};
/// Each target package: its name, what it takes from a tree, its licenses.
const LINUX_LICENSE = "Apache-2.0 WITH LLVM-exception AND LGPL-2.1-or-later";
const MINGW_LICENSE = "Apache-2.0 WITH LLVM-exception AND ZPL-2.1 AND MIT";
const TARGET_PACKAGES = [
  ...common.TARGETS.filter((t) => t.os !== "darwin").map((t) => ({
    name: `xclang-${t.triple}`,
    dirs: [t.triple, `lib/clang/${common.LLVM_MAJOR}/lib/${common.normalized(t)}`],
    license: t.os === "linux" ? LINUX_LICENSE : MINGW_LICENSE,
    summary: `xclang's ${t.triple} target: its sysroot, libc++ and compiler-rt`,
  })),
  {
    name: "xclang-apple-darwin",
    dirs: ["aarch64-apple-darwin", "x86_64-apple-darwin", `lib/clang/${common.LLVM_MAJOR}/lib/darwin`],
    license: "Apache-2.0 WITH LLVM-exception",
    summary: "xclang's macOS targets (arm64, x86_64): libc++ and compiler-rt",
  },
];
const nativePackage = (host: common.Target) =>
  host.os === "darwin" ? "xclang-apple-darwin" : `xclang-${host.triple}`;

const hosts = values.hosts ? values.hosts.split(",").map((h) => common.target(h)) : common.TARGETS;
if (!hosts.some((h) => h.triple === "x86_64-unknown-linux-gnu")) common.fail("the target packages come from x86_64-unknown-linux-gnu's archive");

/// The tree of every host, unpacked.
const trees = new Map<string, string>();
for (const host of hosts) {
  const archive = path.join(dist, `xclang-${version}-${host.triple}.tar.xz`);
  if (!fs.existsSync(archive)) common.fail(`missing ${archive}`);
  const dir = path.join(work, "unpacked", host.triple);
  fs.mkdirSync(dir, { recursive: true });
  common.run("tar", ["-C", dir, "-xJf", archive]);
  trees.set(host.triple, path.join(dir, "xclang"));
}

const moveInto = (from: string, stage: string, relative: string) => {
  const to = path.join(stage, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
};

interface Package {
  name: string;
  stage: string;
  subdir?: string;
  noarch?: boolean;
  run?: string[];
  constraints?: string[];
  license: string;
  summary: string;
}
const packages: Package[] = [];

/// Target packages from Linux x64's tree; every tree carries the same.
const reference = trees.get("x86_64-unknown-linux-gnu")!;
for (const t of TARGET_PACKAGES) {
  const stage = path.join(work, "stage", t.name);
  for (const dir of t.dirs) moveInto(path.join(reference, dir), stage, path.join("opt", "xclang", dir));
  packages.push({ name: t.name, stage, noarch: true, license: t.license, summary: t.summary });
}

/// Host packages: what is left of each tree once the targets are taken
/// out, which must be bin/, the resource headers, libLTO.dylib and LICENSE.
const targetDirs = new Set(TARGET_PACKAGES.flatMap((t) => t.dirs));
for (const host of hosts) {
  const tree = trees.get(host.triple)!;
  const stage = path.join(work, "stage", `xclang-${SUBDIRS[host.triple]}`);
  for (const dir of targetDirs) fs.rmSync(path.join(tree, dir), { recursive: true, force: true });
  const left = (fs.readdirSync(tree, { recursive: true }) as string[])
    .filter((f) => !fs.statSync(path.join(tree, f)).isDirectory() || fs.lstatSync(path.join(tree, f)).isSymbolicLink())
    .filter((f) => !/^(bin|lib[/\\]clang[/\\]\d+[/\\]include)[/\\]/.test(f) && !["LICENSE", path.join("lib", "libLTO.dylib")].includes(f));
  if (left.length) common.fail(`${host.triple}: files no package holds: ${left.slice(0, 10).join(", ")}`);
  moveInto(tree, stage, path.join("opt", "xclang"));
  for (const phase of ["activate", "deactivate"]) {
    for (const ext of host.os === "mingw" ? ["bat", "ps1"] : ["sh"]) {
      const to = path.join(stage, "etc", "conda", `${phase}.d`, `xclang.${ext}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(common.ROOT, "conda", `${phase}.${ext}`), to);
    }
  }
  const native = nativePackage(host);
  packages.push({
    name: "xclang",
    stage,
    subdir: SUBDIRS[host.triple],
    run: [`${native} ==${version}`],
    constraints: TARGET_PACKAGES.map((t) => t.name).filter((n) => n !== native).map((n) => `${n} ==${version}`),
    license: "Apache-2.0 WITH LLVM-exception",
    summary: "A self-contained clang toolchain: clang, lld and the LLVM tools, PGO and ThinLTO optimized",
  });
}

/// The option tables.
{
  const archive = path.join(dist, `llvm-option-inc-${version}.tar.xz`);
  const dir = path.join(work, "unpacked", "llvm-option-inc");
  fs.mkdirSync(dir, { recursive: true });
  common.run("tar", ["-C", dir, "-xJf", archive]);
  const stage = path.join(work, "stage", "llvm-option-inc");
  moveInto(path.join(dir, "llvm-option-inc", "include"), stage, "include");
  packages.push({
    name: "llvm-option-inc",
    stage,
    noarch: true,
    license: "Apache-2.0 WITH LLVM-exception",
    summary: "The option tables of clang, lld, llvm-lib and llvm-dlltool, generated by TableGen",
  });
}

/// One recipe per package: the staged tree copied into $PREFIX as it is,
/// no relocation, no prefix detection (nothing in it names a prefix).
const list = (key: string, items?: string[]) => (items?.length ? [`    ${key}:`, ...items.map((i) => `      - "${i}"`)] : []);
for (const p of packages) {
  const recipe = path.join(path.dirname(p.stage), `${path.basename(p.stage)}.recipe`, "recipe.yaml");
  fs.mkdirSync(path.dirname(recipe), { recursive: true });
  fs.writeFileSync(recipe, [
    "package:",
    `  name: ${p.name}`,
    `  version: "${version}"`,
    "source:",
    `  - path: ${JSON.stringify(p.stage)}`,
    "    use_gitignore: false",
    "build:",
    `  number: ${values.build}`,
    ...(p.noarch ? ["  noarch: generic"] : []),
    "  script:",
    `    - cp -a . "$PREFIX/"`,
    "  dynamic_linking:",
    "    binary_relocation: false",
    "    overlinking_behavior: ignore",
    "    overdepending_behavior: ignore",
    "  prefix_detection:",
    "    ignore: true",
    ...(p.run || p.constraints ? ["requirements:", ...list("run", p.run), ...list("run_constraints", p.constraints)] : []),
    "about:",
    "  homepage: https://github.com/clice-io/xclang",
    "  repository: https://github.com/clice-io/xclang",
    `  license: ${JSON.stringify(p.license)}`,
    `  summary: ${JSON.stringify(p.summary)}`,
    "",
  ].join("\n"));
  common.run(values["rattler-build"]!, [
    "build", "--recipe", recipe, "--output-dir", out, "--test", "skip", "--no-build-id",
    ...(p.subdir ? ["--target-platform", p.subdir] : []),
  ]);
  /// What rattler-build leaves behind is a copy of the package: gone, or
  /// six hosts do not fit on a CI machine's disk.
  fs.rmSync(p.stage, { recursive: true, force: true });
  fs.rmSync(path.join(out, "bld"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "src_cache"), { recursive: true, force: true });
}

for (const subdir of fs.readdirSync(out).filter((d) => fs.statSync(path.join(out, d)).isDirectory())) {
  for (const file of fs.readdirSync(path.join(out, subdir)).filter((f) => f.endsWith(".conda"))) {
    console.log(`${(fs.statSync(path.join(out, subdir, file)).size / 1048576).toFixed(0).padStart(5)} MB  ${subdir}/${file}`);
  }
}
