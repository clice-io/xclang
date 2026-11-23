/// Experiment (exp/mimalloc-hosts only): what exp/mimalloc's benchmarks
/// share. This machine's native target; one command's seconds and peak
/// memory, by exp/mimalloc/peak.c; medians.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const windows = process.platform === "win32";
export const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
export const native = windows ? `${arch}-w64-mingw32`
  : process.platform === "darwin" ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
export const machine = `${native} (${os.cpus()[0]?.model ?? "?"}, ${os.availableParallelism()} threads)`;

/// name=<program> [--prefix name=<arg>]: run as `<program> <arg> ...`
/// (llvm.exe clang++, the program behind a Windows launcher).
export interface Compiler { name: string; path: string; prefix: string[] }
export function compilers(specs: string[], prefixes: string[]): Compiler[] {
  return specs.map((s) => {
    const name = s.slice(0, s.indexOf("="));
    return {
      name, path: s.slice(s.indexOf("=") + 1),
      prefix: prefixes.filter((p) => p.startsWith(`${name}=`)).map((p) => p.slice(name.length + 1)),
    };
  });
}

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "peak-")), "peak.txt");

/// Seconds and peak memory (MiB) of one run, or the failure's output.
export function measure(peak: string, program: string, args: string[], env?: NodeJS.ProcessEnv):
  { seconds: number; mib: number } | { error: string } {
  fs.rmSync(out, { force: true });
  const start = process.hrtime.bigint();
  const r = spawnSync(peak, [program, ...args], { encoding: "utf8", env: { ...(env ?? process.env), PEAK_OUT: out }, maxBuffer: 1 << 28 });
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  if (r.status !== 0) return { error: `${r.status} ${r.signal ?? ""}\n${(r.stderr ?? "").slice(-3000)}` };
  return { seconds, mib: Number(fs.readFileSync(out, "utf8").trim()) / 1024 };
}

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/// Unpack members of a tarball with the system's tar (bsdtar on Windows).
export function untar(archive: string, dest: string, members: string[] = [], strip = 1): void {
  fs.mkdirSync(dest, { recursive: true });
  const tar = windows ? "C:\\Windows\\System32\\tar.exe" : "tar";
  const r = spawnSync(tar, ["-xf", archive, "-C", dest, `--strip-components=${strip}`, ...members], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${tar} -xf ${archive} exited with ${r.status}`);
}
