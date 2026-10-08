/// The C runtime of a target, put into <tree>/<triple>:
///
/// - Linux: glibc 2.17 headers and startup files, from conda-forge's
///   sysroot packages (pixi.toml installs them).
/// - Linux, musl: musl's headers, startup files and libc.a, built with the
///   clang of <tree> with the patches of toolchain/musl, and the kernel's
///   UAPI headers.
/// - Windows: mingw-w64 headers, CRT and winpthreads, built with the clang
///   of <tree>.
/// - macOS: nothing; the SDK comes from Xcode.

import { createHash } from "node:crypto";
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
  withoutCaseClashes(dest);
  /// glibc 2.17's libpthread.a is one object that redefines some of
  /// libc.a's (__libc_sigaction, the cancellation points), so a static link
  /// has to see it first, or both get pulled in; libunwind names it only
  /// through its dependent-library note, after libc. libc.a becomes a linker
  /// script that puts libpthread.a ahead of the archive itself. (A config
  /// file option cannot: clang adds its link-only ones to a PCH build too.)
  const lib = path.join(dest, "usr", "lib64");
  fs.renameSync(path.join(lib, "libc.a"), path.join(lib, "libglibc.a"));
  fs.writeFileSync(path.join(lib, "libc.a"),
    "/* xclang: libpthread.a ahead of glibc's archive, for -static (toolchain/sysroot.ts) */\n" +
    "GROUP ( /usr/lib64/libpthread.a /usr/lib64/libglibc.a )\n");
  console.log(`glibc sysroot of ${t.triple} in ${dest}`);
}

/// The kernel headers name a few netfilter targets and matches alike but
/// for case (xt_DSCP.h, xt_dscp.h), which cannot both exist where Windows
/// and macOS unpack the Linux sysroots: the lowercase one stays.
function withoutCaseClashes(root: string): void {
  const byLowercase = new Map<string, string[]>();
  for (const file of fs.readdirSync(root, { recursive: true }) as string[]) {
    const key = file.toLowerCase();
    byLowercase.set(key, [...(byLowercase.get(key) ?? []), file]);
  }
  for (const [key, files] of byLowercase) {
    if (files.length < 2) continue;
    const keep = files.includes(key) ? key : files.sort()[0];
    for (const file of files.filter((f) => f !== keep)) {
      fs.rmSync(path.join(root, file), { recursive: true });
      console.log(`${file} dropped: it clashes with ${keep} but for case`);
    }
  }
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
    /// No compile time in the COFF objects (toolchain/cmake/toolchain.cmake).
    CC: `${path.join(bin, "clang")} --target=${t.triple} --no-default-config --sysroot=${dest} -mno-incremental-linker-compatible`,
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
  /// libtool's notes name the directory it was built in.
  for (const file of fs.readdirSync(path.join(dest, "lib")).filter((f) => f.endsWith(".la"))) {
    fs.rmSync(path.join(dest, "lib", file));
  }
  console.log(`mingw-w64 sysroot of ${t.triple} in ${dest}`);
}

/// musl's source with the patches of toolchain/musl applied (those of
/// musl's security advisories against the release), unpacked once.
async function muslSource(): Promise<string> {
  const src = path.join(common.WORK, "src", `musl-${common.MUSL_VERSION}`);
  const dir = path.join(import.meta.dirname, "musl");
  const patches = fs.readdirSync(dir).filter((f) => f.endsWith(".patch")).sort();
  const series = patches
    .map((p) => `${p} ${createHash("sha256").update(fs.readFileSync(path.join(dir, p))).digest("hex")}\n`).join("");
  const stamp = path.join(src, ".xclang-patches");
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== series) {
    fs.rmSync(src, { recursive: true, force: true });
    common.extract(await common.fetchSource("musl"), src);
    for (const p of patches) common.run("patch", ["-p1", "-F0", "--forward", "--silent", "-i", path.join(dir, p)], { cwd: src });
    fs.writeFileSync(stamp, series);
  }
  return src;
}

/// The kernel's UAPI headers for the target's architecture into include:
/// `make headers` of the pinned release, the .h files that
/// `make headers_install` would copy.
async function linuxHeaders(t: common.Target, include: string): Promise<void> {
  const src = path.join(common.WORK, "src", `linux-${common.LINUX_VERSION}`);
  if (!fs.existsSync(path.join(src, "Makefile"))) common.extract(await common.fetchSource("linux"), src);
  const build = path.join(common.WORK, "build", `linux-headers-${t.arch}`);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  /// (Its host programs, unifdef among them, are built with this machine's cc.)
  common.run("make", ["-C", src, `O=${build}`, `ARCH=${t.arch === "x86_64" ? "x86" : "arm64"}`, "-s", "headers"]);
  const out = path.join(build, "usr", "include");
  for (const file of (fs.readdirSync(out, { recursive: true }) as string[]).filter((f) => f.endsWith(".h"))) {
    fs.mkdirSync(path.dirname(path.join(include, file)), { recursive: true });
    fs.copyFileSync(path.join(out, file), path.join(include, file));
  }
}

/// musl and the kernel's UAPI headers in dest/usr, as clang's Linux driver
/// looks for them: the headers in usr/include, libc.a, the startup files
/// and the empty libm.a, libpthread.a, ... in usr/lib. Static only, no
/// libc.so: every program links musl into itself (toolchain/config/musl.cfg).
/// The objects are position-independent (clang's default is PIE, and musl's
/// libc.a then takes the objects of libc.so), for -static-pie too, and have
/// unwind tables, which musl leaves out by default: a C++ exception passes
/// through qsort and bsearch, and a stack trace through musl's functions.
async function musl(t: common.Target, tree: string, dest: string): Promise<void> {
  const src = await muslSource();
  fs.rmSync(dest, { recursive: true, force: true });
  await linuxHeaders(t, path.join(dest, "usr", "include"));
  const bin = path.join(tree, "bin");
  const build = path.join(common.WORK, "build", `musl-${t.triple}`);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  common.run(path.join(src, "configure"), [
    `--target=${t.triple}`, "--prefix=/usr", "--disable-shared", "--disable-wrapper",
    `CC=${path.join(bin, "clang")} --target=${t.triple} --no-default-config`,
    `AR=${path.join(bin, "llvm-ar")}`,
    `RANLIB=${path.join(bin, "llvm-ranlib")}`,
    "CFLAGS=-funwind-tables -fasynchronous-unwind-tables",
  ], { cwd: build });
  common.run("make", [`-j${common.jobs()}`], { cwd: build });
  common.run("make", ["install-libs", "install-headers", `DESTDIR=${dest}`], { cwd: build });
  withoutCaseClashes(dest);
  const links = (fs.readdirSync(dest, { recursive: true }) as string[]).filter((f) => fs.lstatSync(path.join(dest, f)).isSymbolicLink());
  if (links.length) common.fail(`links in the musl sysroot: ${links.join(", ")}`);
  console.log(`musl sysroot of ${t.triple} in ${dest}`);
}

export async function buildSysroot(t: common.Target, tree: string): Promise<void> {
  const dest = path.join(tree, t.triple);
  if (t.os === "linux") glibc(t, dest);
  else if (t.os === "musl") await musl(t, tree, dest);
  else if (t.os === "mingw") await mingw(t, tree, dest);
  else fs.mkdirSync(dest, { recursive: true });
}
