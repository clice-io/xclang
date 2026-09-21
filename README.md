# xclang

A self-contained, cross-compiling clang toolchain: one install that targets
Linux, Windows and macOS on x86_64 and aarch64, with the sysroots and runtimes
for every target bundled next to the compiler. The goal is the `zig cc`
experience, on stock clang:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

No `--sysroot`, no `-L`, no installed SDK: clang finds
`xclang/aarch64-w64-mingw32/` on its own, and links the libc++, libunwind
and compiler-rt builtins that were built for exactly that target.

## Layout

```
xclang/
  bin/                     clang, clang++, lld, llvm-ar, llvm-windres, ...
  lib/clang/<ver>/         resource headers and per-target compiler-rt
  x86_64-w64-mingw32/      mingw-w64 headers, CRT, libc++ for Windows x64
  aarch64-w64-mingw32/     the same for Windows arm64
  <triple>/                one directory per supported target
```

The compiler itself is built with PGO and ThinLTO, and ships binaries only:
no libLLVM, no libclang, no headers for building against LLVM.

## Distribution

- **conda-forge**: `pixi add xclang` gives a project a pinned, reproducible
  toolchain. Two feedstocks, generated from `recipes/`: `xclang-bootstrap`
  (the sysroots and the PGO profile, built once on Linux, noarch) and
  `xclang` (the compiler and runtimes, one build per host).
- **GitHub releases**: planned. The same build, as a tarball per host.

## Status

| piece | state |
|---|---|
| `xclang-sysroot-<triple>` — mingw-w64 headers, CRT and winpthreads, built with clang, for `x86_64-w64-mingw32` and `aarch64-w64-mingw32` | recipe done, CI builds it and runs a linked exe on Windows x64 and arm64 |
| `xclang-profdata` — PGO profile for the compiler, an output of `xclang-bootstrap` | planned |
| `xclang` — the PGO+ThinLTO clang/lld and per-target runtimes | planned |

## Why not ...

- **conda-forge's `clang` + `clang_win-64`**: MSVC-targeted; downloads the
  Windows SDK at install time under a license you have to accept; no
  aarch64 Windows sysroot anywhere on conda-forge. xclang targets mingw-w64,
  so the same Itanium ABI, DWARF, and libc++ work on every platform, and
  one PGO profile serves every host.
- **llvm-mingw**: the closest relative, and the reference for much of the
  layout. It is a GitHub-release-only project with no conda packaging, and
  it targets Windows only.
- **`m2w64-*` / `gcc_win-64`**: GCC-bootstrapped, x86_64 only (GCC has no
  aarch64-w64-mingw32 target), libgcc + libstdc++ ABI.

## Building locally

```sh
rattler-build build --recipe recipes/xclang-bootstrap/recipe.yaml --channel conda-forge
```

The CI does the same on Linux, then installs the packages with pixi on
`windows-2025` and `windows-11-arm` and runs a program linked against them.

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
