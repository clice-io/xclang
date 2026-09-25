/// The C runtime of a target, put into <tree>/<triple>:
///
/// - Linux: glibc 2.17 headers and startup files, from conda-forge's
///   sysroot packages (pixi.toml installs them).
/// - Windows: mingw-w64 headers, CRT and winpthreads, built with the clang
///   of <tree>.
/// - macOS: nothing; the SDK comes from Xcode.

import fs from "node:fs";
import path from "node:path";
import * as common from "./common.ts";

const WIN32_WINNT = "0x0A00"; /// Windows 10

function glibc(t: common.Target, dest: string): void {
  const prefix = process.env.CONDA_PREFIX;
  if (!prefix) common.fail("the glibc sysroots come from the pixi environment (CONDA_PREFIX is unset)");
  const src = path.join(prefix, `${t.arch}-conda-linux-gnu`, "sysroot");
  if (!fs.existsSync(path.join(src, "usr", "include", "stdio.h"))) common.fail(`no glibc sysroot at ${src}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (file) => path.basename(file) !== "share",
  });
  console.log(`glibc sysroot of ${t.triple} in ${dest}`);
}

async function mingw(t: common.Target, tree: string, dest: string): Promise<void> {
  const src = path.join(common.WORK, "src", `mingw-w64-${common.MINGW_VERSION}`);
  if (!fs.existsSync(path.join(src, "mingw-w64-crt", "configure"))) {
    common.extract(await common.fetchSource("mingw-w64"), src);
  }
  const bin = path.join(tree, "bin");
  const build = path.join(common.WORK, "build", `mingw-w64-${t.triple}`);
  fs.rmSync(build, { recursive: true, force: true });

  const configure = (name: string, source: string, args: string[], env = process.env): string => {
    const dir = path.join(build, name);
    fs.mkdirSync(dir, { recursive: true });
    common.run(path.join(source, "configure"), [`--host=${t.triple}`, `--prefix=${dest}`, ...args], { cwd: dir, env });
    return dir;
  };
  const make = (dir: string, env: NodeJS.ProcessEnv) => {
    common.run("make", [`-j${common.jobs()}`], { cwd: dir, env });
    common.run("make", ["install"], { cwd: dir, env });
  };

  const headers = configure("headers", path.join(src, "mingw-w64-headers"), [
    "--enable-idl", "--without-widl",
    `--with-default-win32-winnt=${WIN32_WINNT}`, "--with-default-msvcrt=ucrt",
  ]);
  common.run("make", ["install"], { cwd: headers });

  /// No config file: the runtimes it would link do not exist yet, and
  /// nothing here is linked into a program.
  const rc = `${path.join(bin, "llvm-windres")} --target=${t.triple} -I${path.join(dest, "include")}`;
  const env = {
    ...process.env,
    CC: `${path.join(bin, "clang")} --target=${t.triple} --no-default-config --sysroot=${dest}`,
    AR: path.join(bin, "llvm-ar"),
    RANLIB: path.join(bin, "llvm-ranlib"),
    DLLTOOL: path.join(bin, "llvm-dlltool"),
    NM: path.join(bin, "llvm-nm"),
    STRIP: path.join(bin, "llvm-strip"),
    OBJCOPY: path.join(bin, "llvm-objcopy"),
    LD: path.join(bin, "ld.lld"),
    RC: rc,
    WINDRES: rc,
  };
  const libs = t.arch === "x86_64"
    ? ["--disable-lib32", "--enable-lib64"]
    : ["--disable-lib32", "--disable-lib64", "--enable-libarm64"];
  make(configure("crt", path.join(src, "mingw-w64-crt"), [
    ...libs, "--with-default-msvcrt=ucrt", "--enable-silent-rules", "--disable-dependency-tracking",
  ], env), env);
  make(configure("winpthreads", path.join(src, "mingw-w64-libraries", "winpthreads"), [
    "--enable-static", "--disable-shared", "--enable-silent-rules", "--disable-dependency-tracking",
    "CFLAGS=-O2",
  ], env), env);
  console.log(`mingw-w64 sysroot of ${t.triple} in ${dest}`);
}

export async function buildSysroot(t: common.Target, tree: string): Promise<void> {
  const dest = path.join(tree, t.triple);
  if (t.os === "linux") glibc(t, dest);
  else if (t.os === "mingw") await mingw(t, tree, dest);
  else fs.mkdirSync(dest, { recursive: true });
}
