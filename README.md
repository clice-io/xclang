# xclang

[中文](README.zh-CN.md)

A self-contained clang toolchain. One directory holds the compiler, the
linker, the binary tools and, for every target it serves, the sysroot and
the runtimes, so cross-compiling is a `--target` flag and nothing else:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

No `--sysroot`, no `-L`, no SDK to install: `bin/aarch64-w64-mingw32.cfg`,
which clang reads for that target, points it at `xclang/aarch64-w64-mingw32/`,
and it links the libc++, libunwind and compiler-rt built for that exact
target. Think `zig cc`, with stock clang.

## Who it is for

People who want a toolchain they can pin, ship and reproduce, and binaries
that run wherever they are copied:

- **Hermetic by default.** libc++, libc++abi, libunwind and the builtins
  are static. The output depends on the OS and nothing else.
- **Every piece is usable on its own.** The sysroots and runtimes are plain
  directories laid out the way clang's drivers expect. Point any clang at
  them with `--sysroot` / `-resource-dir` and it cross-compiles.
- **Fast.** clang and lld are built with PGO and ThinLTO, and linked
  statically against xclang's own libc++ on every host, macOS included:
  the system's libc++.dylib is never used.
- **Small.** clang, lld and most tools are one program, `llvm`, which the
  other names start; they would otherwise each carry LLVM in full.

It is not a compiler for building conda-forge packages. conda-forge's own
`clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## What a release holds

- **The toolchain**, one archive per host, 75 to 110 MB: clang, lld and the
  LLVM binary tools (`llvm-ar`, `llvm-nm`, `llvm-objcopy`, `llvm-rc`,
  `llvm-profdata`, ...), and FileCheck for lit tests. Every LLVM target
  is enabled. No clang-tools-extra, no clang-format.
- **libclang**, one archive per host: the clang and LLVM static libraries
  and headers, for tools built on clang such as clice. They are the
  libraries that host's clang was linked from, taken from the same build
  without the parts a tool does not link: PGO and ThinLTO bitcode, so they
  need an lld of the same release. An ASan build with assertions is
  published next to it for debugging.
- **The option tables** of clang, lld, llvm-lib and llvm-dlltool
  (`llvm-option-inc`), TableGen's output from the same build, for tools
  that parse those command lines without linking LLVM, such as catter.
- **The PGO profile** the release was built with.

A release is tagged `<llvm version>.<revision>`, `23.1.2.1` for the first
build of LLVM 23.1.2, a version conda can order. Nothing published is ever
replaced; a rebuild gets the next revision.

## Hosts and targets

| host | built on |
|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Linux x64 (arm64 cross-compiled) |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | macOS arm64 (x64 cross-compiled) |
| `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | Linux x64, cross-compiled; the Windows toolchain is a mingw program |

Every host toolchain carries every target directory:

| target | C runtime in the sysroot | C++ runtime |
|---|---|---|
| Linux x64, arm64 | glibc 2.17 headers and startup files | libc++, libc++abi, libunwind |
| Windows x64, arm64 | mingw-w64 (UCRT), winpthreads | libc++, libc++abi, libunwind |
| macOS arm64, x64 | none: Apple's SDK cannot be redistributed, the one from Xcode is used | libc++, libc++abi, linked statically instead of the system's |

Programs built for Linux run on glibc 2.17 and later, those built for macOS
on 13.0 and later; the toolchain itself has the same floors.

libc++ is built with hardening mode `none`. The mode is a per-translation-unit
macro, so a debug build opts in with `-D_LIBCPP_HARDENING_MODE=...`.

## Layout

```
xclang/
  bin/                     llvm and its names (clang, clang++, ld.lld, lld-link,
                           llvm-ar, windres, ...), the tools outside it
                           (llvm-profdata, llvm-cov, llvm-dwarfdump,
                           llvm-strings, FileCheck), <triple>.cfg
  lib/clang/<ver>/         resource headers, compiler-rt for every target
  lib/libLTO.dylib         macOS hosts: LTO for the system's ld
  <triple>/                one directory per target: its sysroot with libc++
                           in it (Linux: usr/include, usr/lib, and glibc in
                           lib64 and usr/lib64; Windows and macOS: include/,
                           lib/)
```

The config files apply to native builds too, so a plain `clang++ main.cpp`
on Linux compiles against glibc 2.17 and links everything but glibc
statically. `--no-default-config` gives the bare compiler, for building
against the system's own headers and libraries.

compiler-rt carries the builtins (with the `__atomic_*` functions of
atomics too wide to be lock-free), the profile runtime, and for Linux and
macOS targets AddressSanitizer, ThreadSanitizer, LeakSanitizer, UBSan and
libFuzzer. zlib and zstd are linked in statically: `-gz=zlib`, `-gz=zstd`
and compressed profiles work on every host.

Build scripts written for GCC keep working: `-latomic`, `-lgcc`,
`-lgcc_eh`, `-lgcc_s` (and on Windows `-lssp`, which `-fstack-protector`
asks for) find empty archives, the functions being in compiler-rt,
libunwind and mingw-w64; `-lstdc++` means libc++. `-static` links fully
static Linux programs. `windres`, the name CMake looks for to compile a
MinGW project's `.rc` files, is `llvm-windres`.

The Linux sysroots hold what compiling and linking read (headers, startup
files, libraries), not glibc's programs, locales or gconv modules, and no
symlinks: their soname links are the files themselves, their `libfoo.so`
links are linker scripts naming them, as glibc's own `libc.so` is. Eight
netfilter headers named like another but for case (`xt_DSCP.h` next to
`xt_dscp.h`) are left out, so the sysroots unpack on Windows and macOS.

On macOS the linker is the system's `ld`, with xclang's `libLTO.dylib` for
LTO, as Apple's own toolchain does: ld64.lld's ThinLTO loses exception
handling on arm64 in LLVM 23.1.2 (a program built with it cannot catch
what it throws). ld64.lld is still there, behind `-fuse-ld=lld`.

Every archive is a `.tar.xz`, and a Windows one holds no symlinks at all,
so it unpacks without extra rights and packs into conda: the names of
`llvm.exe` (`clang++.exe`, `ld.lld.exe`, ...) are a small program
(`windows/alias.c`) that starts `llvm.exe <name> <arguments>`. The name
goes in as a subcommand because LLVM on Windows replaces the file name in
`argv[0]` with its own before reading it.

## How it is built

1. A bootstrap clang builds the runtimes of every target and an
   instrumented clang and lld. The bootstrap clang is the previous xclang
   release; until there is one, it is LLVM's own release build, which is
   PGO and ThinLTO optimized too.
2. The instrumented toolchain compiles a fixed training set on Linux x64,
   at `-O0 -g` and `-O2`, for x86_64 and aarch64, linked with lld (ELF,
   COFF, ThinLTO): C and C++ sources (abseil, sqlite); precompiled
   headers, a shared one and a preamble per abseil source, parsed and
   completed on as an editor does; C++20 modules (libc++'s `std` and
   `std.compat`, magic_enum's, Vulkan-Hpp's, a wrapped nlohmann/json, a
   module of partitions) and their importers, two-phase and one-phase
   with reduced BMIs; P1689 scans by clang-scan-deps; code completion
   requests. This gives one profile per release.
3. Every host's clang, lld and tools are built with that profile and
   ThinLTO; the same build tree gives that host's libclang archive. The
   profile comes from frontend instrumentation, whose function hashes
   depend only on the source, so the profile recorded on Linux applies to
   every host; a remapping file matches names whose mangling differs
   (`unsigned long` against `unsigned long long`).
4. Each host's archives are tested on that host before the release is
   published: its own programs load no C++ runtime (and need glibc 2.17
   at most); C and C++ programs build for every target and run where they
   can, with wide atomics, hardening flags, GCC's library names, a version
   resource, and `-static` on Linux; `import std`, a PCH, ThinLTO, ASan,
   TSan and libFuzzer work natively; and a small tool on libclang, found
   through `find_package(Clang)`, builds and runs.

## Limits

- Linux: glibc 2.17 has no `rcrt1.o`, so no `-static-pie`, and its
  `gcrt1.o` is not position-independent, so `-pg` needs `-no-pie`.
  `libquadmath` is GCC's own: `__float128` arithmetic works, `quadmath.h`
  does not exist.
- No OpenMP runtime (`-fopenmp`), no sanitizers for Windows targets, no
  MemorySanitizer.
- libc++ is linked into every program and shared library on its own and
  hidden, so on Linux and macOS a standard exception thrown by one shared
  library is caught by type in another only as `catch (...)`: each has its
  own `std::exception` type information. Windows compares it by name.
- No clang-format, clang-tidy or clangd binaries.

## Repository

```
cmake/caches/      what each build is: runtimes, the host toolchain, the
                   instrumented one, the ASan libclang
cmake/toolchain.cmake   building for a target with an xclang tree
config/            the per-target clang config files
scripts/           TypeScript, run by Node: bootstrap, runtimes (with the
                   sysroots), toolchain, package
pgo/               the training (train.ts, its corpus) and remap.txt
windows/alias.c    the launcher behind every name of llvm.exe
tests/             smoke.ts and libclang.ts, the per-host checks; bench.ts,
                   compile speed against other compilers
.github/workflows/ main.yml runs the stages above, by hand
```

`pixi run <task>` runs each stage the way CI does (pixi.toml); the builds
themselves need CI-sized machines.

## Status

| piece | state |
|---|---|
| runtimes and sysroots of all six targets | done |
| PGO training on Linux x64 | done: 23 min, about 1700 compiler runs |
| PGO + ThinLTO toolchain and libclang of all six hosts | done: about 2 h per host |
| ASan libclang (Linux x64, macOS arm64) | done |
| per-host smoke tests, libclang consumer test | done |
| catter built with xclang (Linux, Windows) | done, with its tests |
| draft GitHub release | done |
| patch series against LLVM | later |
| conda packages on [conda.clice.io](https://conda.clice.io) | later |

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
