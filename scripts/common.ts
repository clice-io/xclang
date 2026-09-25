/// What every build script shares: versions, pinned downloads, targets,
/// paths, and how a toolchain tree is put together.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const WORK = path.resolve(process.env.XCLANG_WORK ?? path.join(ROOT, "work"));

export const LLVM_VERSION = "23.1.2";
export const LLVM_MAJOR = LLVM_VERSION.split(".")[0];
export const MINGW_VERSION = "14.0.0";
export const MACOS_MIN = "13.0";

const GH = "https://github.com";
const LLVM = `${GH}/llvm/llvm-project/releases/download/llvmorg-${LLVM_VERSION}`;

/// Nothing is downloaded without a pinned digest.
export const SOURCES = {
  "llvm-project": {
    url: `${LLVM}/llvm-project-${LLVM_VERSION}.src.tar.xz`,
    sha256: "c98bbef08a2b4c2613cd50e9aa9ae7b69b1fe6c16b2c40373bc0ab6116fdf78a",
  },
  /// LLVM's own release builds (clang/cmake/caches/Release.cmake: PGO and
  /// ThinLTO), the bootstrap compiler until there is an xclang release.
  "bootstrap-linux": {
    url: `${LLVM}/LLVM-${LLVM_VERSION}-Linux-X64.tar.zst`,
    sha256: "6382de1c1a210ce5a5cc49d18bc8444d137742e7cbf9b19f4ae602bb1ab52534",
  },
  "bootstrap-macos": {
    url: `${LLVM}/LLVM-${LLVM_VERSION}-macOS-ARM64.tar.zst`,
    sha256: "3da0e91b5dfe3a5ec795ad2be79b3f5e6f28c8b23edcd3847fad7742b25e0507",
  },
  /// The training corpus (pgo/train.ts).
  "abseil": {
    url: `${GH}/abseil/abseil-cpp/archive/refs/tags/20250814.1.tar.gz`,
    sha256: "1692f77d1739bacf3f94337188b78583cf09bab7e420d2dc6c5605a4f86785a1",
  },
  "sqlite": {
    url: "https://www.sqlite.org/2025/sqlite-autoconf-3500400.tar.gz",
    sha256: "a3db587a1b92ee5ddac2f66b3edb41b26f9c867275782d46c3a088977d6a5b18",
  },
  "mingw-w64": {
    url: `${GH}/mingw-w64/mingw-w64/archive/refs/tags/v${MINGW_VERSION}.tar.gz`,
    sha256: "d71cc644cd5a37c337f2719f3e0c79d89e8d8d5fb9e2952a62d3fa23623dc137",
  },
} as const;
export type Source = keyof typeof SOURCES;

export type Os = "linux" | "mingw" | "darwin";
export type Arch = "x86_64" | "aarch64";
export type Machine = "linux" | "macos";

export interface Target {
  /// Also the name of its directory in a toolchain tree.
  triple: string;
  os: Os;
  arch: Arch;
}

export const TARGETS: readonly Target[] = [
  { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64" },
  { triple: "aarch64-unknown-linux-gnu", os: "linux", arch: "aarch64" },
  { triple: "x86_64-w64-mingw32", os: "mingw", arch: "x86_64" },
  { triple: "aarch64-w64-mingw32", os: "mingw", arch: "aarch64" },
  { triple: "aarch64-apple-darwin", os: "darwin", arch: "aarch64" },
  { triple: "x86_64-apple-darwin", os: "darwin", arch: "x86_64" },
];

export function target(triple: string): Target {
  const t = TARGETS.find((t) => t.triple === triple);
  if (!t) fail(`unknown target ${triple}; one of: ${TARGETS.map((t) => t.triple).join(", ")}`);
  return t;
}

/// The kind of CI machine that builds for a target.
export function buildMachine(t: Target): Machine {
  return t.os === "darwin" ? "macos" : "linux";
}

/// The spelling clang's driver uses (llvm::Triple::normalize), which names
/// the target's compiler-rt directory and selects its config file.
export function normalized(t: Target): string {
  return t.os === "mingw" ? `${t.arch}-w64-windows-gnu` : t.triple;
}

/// Every spelling of the triple that should reach the target's config file.
export function cfgNames(t: Target): string[] {
  if (t.os === "mingw") return [`${t.arch}-w64-windows-gnu`, `${t.arch}-pc-windows-gnu`];
  if (t.os === "darwin") {
    const archs = t.arch === "aarch64" ? ["arm64", "aarch64"] : ["x86_64"];
    return archs.flatMap((a) => [`${a}-apple-darwin`, `${a}-apple-macos`]);
  }
  return [t.triple];
}

export function machine(): Machine {
  return process.platform === "darwin" ? "macos" : "linux";
}

/// The target that runs natively on this machine.
export function machineTarget(): Target {
  const arch: Arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
  const o: Os = process.platform === "darwin" ? "darwin" : "linux";
  return TARGETS.find((t) => t.os === o && t.arch === arch)!;
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): void {
  console.log(`+ ${[cmd, ...args].join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    fail(`${cmd} exited with ${result.status ?? result.signal}`);
  }
}

export function capture(cmd: string, args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  return result.stdout.toString();
}

/// Download a pinned source once into work/downloads, checking its digest.
export async function fetchSource(name: Source): Promise<string> {
  const { url, sha256 } = SOURCES[name];
  const dest = path.join(WORK, "downloads", url.slice(url.lastIndexOf("/") + 1));
  if (fs.existsSync(dest) && (await sha256Of(dest)) === sha256) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`${url}: HTTP ${response.status}`);
  const partial = `${dest}.part`;
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream),
    new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    fs.createWriteStream(partial),
  );
  const actual = hash.digest("hex");
  if (actual !== sha256) {
    fs.rmSync(partial);
    fail(`${url}: sha256 ${actual}, expected ${sha256}`);
  }
  fs.renameSync(partial, dest);
  return dest;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/// Run tar on the decompressed stream of an archive. The decompressor is
/// explicit: LLVM's .tar.zst releases use a long window that a plain
/// `zstd -d` (what tar would start) refuses.
function tarStream(archive: string, args: string[], output: "inherit" | "pipe"): string {
  const decompress = archive.endsWith(".zst")
    ? "zstd -dc --long=31"
    : archive.endsWith(".xz") ? "xz -dc" : "gzip -dc";
  const script = `set -o pipefail; ${decompress} "$0" | tar -f - "$@"`;
  console.log(`+ ${decompress} ${archive} | tar ${args.join(" ")}`);
  const result = spawnSync("bash", ["-c", script, archive, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", output, "inherit"],
  });
  if (result.status !== 0) fail(`unpacking ${archive} exited with ${result.status}`);
  return result.stdout ?? "";
}

/// Unpack a tarball (gz, xz or zst) into dest, dropping the leading
/// directory; `keep` selects members by their path below it.
export function extract(archive: string, dest: string, keep?: (member: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  const args = ["-x", "-C", dest, "--strip-components=1"];
  if (keep) {
    const members = tarStream(archive, ["-t"], "pipe")
      .split("\n")
      .filter((m) => m && !m.endsWith("/"))
      .filter((m) => keep(m.slice(m.indexOf("/") + 1)));
    const list = path.join(dest, ".members");
    fs.writeFileSync(list, members.join("\n") + "\n");
    tarStream(archive, [...args, "-T", list], "inherit");
    fs.rmSync(list);
  } else {
    tarStream(archive, args, "inherit");
  }
}

/// The llvm-project source tree, unpacked once.
export async function llvmSource(): Promise<string> {
  const src = path.join(WORK, "src", `llvm-project-${LLVM_VERSION}`);
  if (!fs.existsSync(path.join(src, "llvm", "CMakeLists.txt"))) {
    extract(await fetchSource("llvm-project"), src);
  }
  return src;
}

export function resourceDir(tree: string): string {
  return path.join(tree, "lib", "clang", LLVM_MAJOR);
}

/// Merge src into dest, keeping symlinks as they are.
export function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, force: true, verbatimSymlinks: true });
}

/// A toolchain tree at dest: the programs and resource headers of the tree
/// `programs` (the bootstrap, or a build here), the target directories and
/// compiler-rt of every tree in `parts`, and the config files. The
/// programs' own compiler-rt is left out, so every runtime in the tree is
/// one built here.
export function makeTree(dest: string, programs: string, parts: string[] = []): string {
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(path.join(programs, "bin"), path.join(dest, "bin"));
  fs.mkdirSync(path.join(dest, "lib"), { recursive: true });
  for (const entry of fs.readdirSync(path.join(programs, "lib"))) {
    if (entry !== "clang") copyTree(path.join(programs, "lib", entry), path.join(dest, "lib", entry));
  }
  copyTree(path.join(resourceDir(programs), "include"), path.join(resourceDir(dest), "include"));
  for (const part of parts) copyTree(part, dest);
  writeConfigs(dest);
  return dest;
}

/// Install the per-target clang config files (config/) into tree/bin.
/// clang reads bin/<triple>.cfg for the target it compiles for, so every
/// target directory of the tree works with a bare --target.
export function writeConfigs(tree: string): void {
  const bin = path.join(tree, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const t of TARGETS) {
    const text = fs
      .readFileSync(path.join(ROOT, "config", `${t.os}.cfg`), "utf8")
      .replaceAll("@TRIPLE@", t.triple)
      .replaceAll("@MACOS_MIN@", MACOS_MIN);
    for (const name of cfgNames(t)) fs.writeFileSync(path.join(bin, `${name}.cfg`), text);
  }
}

/// CMake arguments that build for `t` with the toolchain tree at `tree`.
export function cmakeToolchainArgs(tree: string, t: Target): string[] {
  return [
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(ROOT, "cmake", "toolchain.cmake")}`,
    `-DXCLANG_ROOT=${tree}`,
    `-DXCLANG_TARGET=${t.triple}`,
    `-DXCLANG_TARGET_OS=${t.os}`,
    `-DXCLANG_TARGET_ARCH=${t.arch}`,
    `-DXCLANG_MACOS_MIN=${MACOS_MIN}`,
  ];
}

export function jobs(): string {
  return String(os.availableParallelism());
}
