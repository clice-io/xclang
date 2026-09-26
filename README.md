# xclang

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

It is not a compiler for building conda-forge packages. conda-forge's own
`clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## What a release holds

- **The toolchain**, one archive per host: clang, lld and the LLVM binary
  tools (`llvm-ar`, `llvm-nm`, `llvm-objcopy`, `llvm-rc`, `llvm-profdata`,
  ...). Every LLVM target is enabled. No clang-tools-extra, no clang-format.
- **libclang**, one archive per host: the clang and LLVM static libraries
  and headers, for tools built on clang such as clice. They are the
  libraries that host's clang was linked from, taken from the same build
  without the parts a tool does not link: PGO and ThinLTO bitcode, so they
  need an lld of the same release. An ASan build with assertions is
  published next to it for debugging.
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
  bin/                     clang, clang++, ld.lld, lld-link, llvm-ar, ..., <triple>.cfg
  lib/clang/<ver>/         resource headers, compiler-rt for every target
  lib/libLTO.dylib         macOS hosts: LTO for the system's ld
  <triple>/                one directory per target: its sysroot with libc++
                           in it (Linux: usr/include, usr/lib64; Windows and
                           macOS: include/, lib/)
```

The config files apply to native builds too, so a plain `clang++ main.cpp`
on Linux compiles against glibc 2.17 and links everything but glibc
statically. `--no-default-config` gives the bare compiler, for building
against the system's own headers and libraries.

compiler-rt carries the builtins, the profile runtime, and for Linux and
macOS targets AddressSanitizer and UBSan.

On macOS the linker is the system's `ld`, with xclang's `libLTO.dylib` for
LTO, as Apple's own toolchain does: ld64.lld's ThinLTO loses exception
handling on arm64 in LLVM 23.1.2 (a program built with it cannot catch
what it throws). ld64.lld is still there, behind `-fuse-ld=lld`.

The Windows archives are zip files, which have no symlinks: `clang++.exe`,
`ld.lld.exe`, `lld-link.exe` and the other names that matter are copies,
the rest (`clang-cl.exe`, `ld64.lld.exe`, `wasm-ld.exe`) are left out.

## How it is built

1. A bootstrap clang builds the runtimes of every target and an
   instrumented clang and lld. The bootstrap clang is the previous xclang
   release; until there is one, it is LLVM's own release build, which is
   PGO and ThinLTO optimized too.
2. The instrumented toolchain compiles a fixed training set on Linux x64:
   C and C++ sources (abseil, sqlite), a PCH and C++20 modules
   (`import std`), code completion requests, at `-O0 -g` and `-O2`, for
   x86_64 and aarch64, linked with lld (ELF, COFF, ThinLTO). This gives
   one profile per release.
3. Every host's clang, lld and tools are built with that profile and
   ThinLTO; the same build tree gives that host's libclang archive. The
   profile comes from frontend instrumentation, whose function hashes
   depend only on the source, so the profile recorded on Linux applies to
   every host; a remapping file matches names whose mangling differs
   (`unsigned long` against `unsigned long long`).
4. Each host's archive is tested on that host before the release is
   published: its own programs load no C++ runtime (and need glibc 2.17
   at most), C and C++ programs build for every target and run where they
   can, and `import std`, a PCH and ThinLTO work natively.

## Repository

```
cmake/caches/      what each build is: runtimes, the host toolchain, the
                   instrumented one, the ASan libclang
cmake/toolchain.cmake   building for a target with an xclang tree
config/            the per-target clang config files
scripts/           TypeScript, run by Node: bootstrap, runtimes (with the
                   sysroots), toolchain, package
pgo/               the training (train.ts, its corpus) and remap.txt
tests/smoke.ts     the per-host checks
.github/workflows/ main.yml runs the stages above, by hand
```

`pixi run <task>` runs each stage the way CI does (pixi.toml); the builds
themselves need CI-sized machines.

## Status

| piece | state |
|---|---|
| runtimes and sysroots of all six targets | done |
| PGO training on Linux x64 | done: 18 min, about 220k functions with counts |
| PGO + ThinLTO toolchain and libclang of all six hosts | done: about 2 h per host |
| ASan libclang (Linux x64, macOS arm64) | done |
| per-host smoke tests | done |
| draft GitHub release | done |
| patch series against LLVM | later |
| conda packages on [conda.clice.io](https://conda.clice.io) | later |

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
