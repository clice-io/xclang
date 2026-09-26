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

/// What compiling and linking for the target never reads: programs,
/// configuration, locales (a 100 MB locale archive) and gconv modules.
const GLIBC_DROP = ["etc", "var", "sbin", "usr/bin", "usr/sbin", "usr/libexec", "usr/share",
  "usr/lib64/locale", "usr/lib64/gconv", "usr/lib64/audit"];

function glibc(t: common.Target, dest: string): void {
  const prefix = process.env.CONDA_PREFIX;
  if (!prefix) common.fail("the glibc sysroots come from the pixi environment (CONDA_PREFIX is unset)");
  const src = path.join(prefix, `${t.arch}-conda-linux-gnu`, "sysroot");
  if (!fs.existsSync(path.join(src, "usr", "include", "stdio.h"))) common.fail(`no glibc sysroot at ${src}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (file) => !GLIBC_DROP.includes(path.relative(src, file).split(path.sep).join("/")),
  });
  withoutLinks(dest);
  console.log(`glibc sysroot of ${t.triple} in ${dest}`);
}

/// Every host's toolchain carries the Linux sysroots, and Windows makes
/// links only with extra rights (conda packages for Windows carry none),
/// so the sysroot has none:
///
/// - a directory link (lib -> lib64) goes, once the linker scripts that
///   go through it name the real directory;
/// - a shared library's soname link (libc.so.6 -> libc-2.17.so) takes the
///   file's place;
/// - a development link (usr/lib64/libm.so -> ../../lib64/libm.so.6)
///   becomes a linker script naming the file, as glibc's libc.so does;
/// - any other link becomes a copy.
function withoutLinks(root: string): void {
  const links = (): string[] => (fs.readdirSync(root, { recursive: true }) as string[])
    .map((f) => path.join(root, f)).filter((f) => fs.lstatSync(f).isSymbolicLink())
    .filter((f) => fs.existsSync(f) || (fs.rmSync(f), console.log(`dangling ${f} dropped`), false));
  const inSysroot = (file: string) => "/" + path.relative(root, file).split(path.sep).join("/");
  const target = (link: string) => path.resolve(path.dirname(link), fs.readlinkSync(link));

  const dirs = links().filter((l) => fs.statSync(l).isDirectory());
  for (const file of (fs.readdirSync(root, { recursive: true }) as string[]).map((f) => path.join(root, f))) {
    if (dirs.some((d) => file.startsWith(d + path.sep))) continue;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096 || !/\.so$/.test(file)) continue;
    let script = fs.readFileSync(file, "latin1");
    if (!/\b(GROUP|INPUT)\s*\(/.test(script)) continue;
    for (const d of dirs) {
      const [from, to] = [inSysroot(d), inSysroot(target(d))];
      script = script.replace(new RegExp(`(^|[\\s(])${from}/`, "g"), `$1${to}/`);
    }
    fs.writeFileSync(file, script, "latin1");
  }
  for (const d of dirs) fs.rmSync(d);

  for (let left = links(); left.length; left = links()) {
    const targets = new Map(left.map((l) => [l, target(l)]));
    const ready = left.filter((l) => !fs.lstatSync(targets.get(l)!).isSymbolicLink());
    if (!ready.length) common.fail(`links in a cycle: ${left.join(", ")}`);
    for (const link of ready) {
      const real = targets.get(link)!;
      const shared = left.filter((l) => targets.get(l) === real).length > 1;
      fs.rmSync(link);
      if (/\.so\.\d+$/.test(link) && path.dirname(real) === path.dirname(link) && !shared) {
        fs.renameSync(real, link);
      } else if (/\.so$/.test(link)) {
        fs.writeFileSync(link, `/* ${path.basename(link)}, for -l${path.basename(link, ".so").slice(3)} */\nINPUT ( ${inSysroot(real)} )\n`);
      } else {
        fs.copyFileSync(real, link);
      }
    }
  }
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
    "--without-widl",
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
