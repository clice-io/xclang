# xclang

Recipes for **xclang**, a cross-compiling clang toolchain published on conda-forge:
a PGO+LTO clang/lld with mingw-w64 sysroots and LLVM runtimes for every target it
serves, self-contained under `$PREFIX/xclang/`.

| recipe | what it publishes |
|---|---|
| `recipes/xclang-sysroot` | `xclang-sysroot-<triple>`: mingw-w64 headers, CRT and winpthreads per target triple |

Each recipe is submitted to `conda-forge/staged-recipes` from here; the resulting
`conda-forge/<name>-feedstock` is the publishing side. This repository keeps the
recipes together, and its CI builds them with rattler-build and exercises the
packages on real Windows runners.
