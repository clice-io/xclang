# xclang

A self-contained clang cross toolchain. One directory holds the compiler,
the sysroot and the runtimes for every target it serves, so cross-compiling
is a `--target` flag and nothing else:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

No `--sysroot`, no `-L`, no SDK to install: clang finds
`xclang/aarch64-w64-mingw32/` next to itself and links the libc++,
libunwind and compiler-rt built for that exact target. Think `zig cc`,
with stock clang.

## Who it is for

People who want a toolchain they can pin, ship and reproduce, and binaries
that run wherever they are copied:

- **Hermetic by default.** libc++, libc++abi, libunwind and the builtins
  are static. The output depends on the OS and nothing else.
- **Every piece is usable on its own.** The sysroots and runtimes are plain
  directories laid out the way clang's drivers expect. Point any clang at
  them with `--sysroot` / `-resource-dir` and it cross-compiles.
- **Fast.** The compiler is built with PGO and ThinLTO. Binaries only, no
  libLLVM, no headers for building against LLVM.

It is not a compiler for building conda-forge packages. conda-forge's own
`clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## Layout

```
xclang/
  bin/                     clang, clang++, lld, llvm-ar, llvm-windres, ...
  lib/clang/<ver>/         resource headers, per-target compiler-rt
  x86_64-w64-mingw32/      mingw-w64 headers, CRT, libc++ for Windows x64
  aarch64-w64-mingw32/     same for Windows arm64
  <triple>/                one directory per target
```

## Distribution

- **conda-forge**: `pixi add xclang`. Two feedstocks, both generated from
  `recipes/`: `xclang-bootstrap` (sysroots and the PGO profile, noarch,
  built once on Linux) and `xclang` (compiler and runtimes, one build per
  host).
- **GitHub releases**: planned. Same build, one tarball per host.

## Status

| piece | state |
|---|---|
| `xclang-sysroot-<triple>` — mingw-w64 headers, CRT, winpthreads for `x86_64-w64-mingw32` and `aarch64-w64-mingw32`, built with clang | done; CI builds it and runs a linked exe on Windows x64 and arm64 |
| `xclang-profdata` — PGO profile, second output of `xclang-bootstrap` | planned |
| `xclang` — PGO+ThinLTO clang/lld, per-target runtimes | planned |

## Building locally

```sh
rattler-build build --recipe recipes/xclang-bootstrap/recipe.yaml --channel conda-forge
```

CI does the same on Linux, then installs the packages with pixi on
`windows-2025` and `windows-11-arm` and runs a program linked against them.

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
