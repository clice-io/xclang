# Installing xclang

## pixi and conda

From the [clice conda channel](https://conda.clice.io), with pixi:

```toml
[workspace]
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "osx-arm64", "win-64"]

[dependencies]
xclang = "23.1.2.5.*"
```

The package is the host's archive, every target included, under
`$PREFIX/opt/xclang`, whose `bin/` the environment's activation puts first in
`PATH`; nothing goes to `$PREFIX/bin`, so conda-forge's compilers stay as
they are. There is one package per host: `linux-64`, `linux-aarch64`,
`osx-64`, `osx-arm64`, `win-64` and `win-arm64`. `llvm-option-inc` (noarch)
holds the option tables in `$PREFIX/include/llvm-options-td`.

The package's version is the release's; its build number counts packaging
fixes of that release.

xclang is not a compiler for building conda-forge packages. conda-forge's
own `clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## Archives

Every [GitHub release](https://github.com/clice-io/xclang/releases) holds:

- **The toolchain**, one archive per host, 80 to 120 MB:
  `xclang-<version>-<host>.tar.xz`. clang, lld and the LLVM binary tools
  (`llvm-ar`, `llvm-nm`, `llvm-objcopy`, `llvm-rc`, `llvm-profdata`, ...),
  and FileCheck for lit tests, and every target's sysroot and runtimes.
  Every LLVM target is enabled. No clang-tools-extra, no clang-format.
  From 23.1.2.6 on it holds xclang's CMake package too, in
  `lib/cmake/xclang` ([CMake](cmake.md)).
- **libclang**, one archive per host: the clang and LLVM static libraries
  and headers, for tools built on clang such as clice, and an ASan build of
  them for Linux x64 and macOS arm64 ([libclang](libclang.md)).
- **The option tables** of clang, lld, llvm-lib and llvm-dlltool
  (`llvm-option-inc-<version>.tar.xz`), for tools that parse those command
  lines without linking LLVM, such as catter.
- **The PGO profile** the release was built with
  (`xclang-<version>.profdata`).
- `SHA256SUMS`, the digests of all of them. The Bazel module and CMake's
  download of the toolchain check each archive against it.

An archive unpacks anywhere and is used from there: the toolchain is the
directory `xclang/`. A Windows archive holds no symbolic links, so the
system's own `tar` unpacks it without extra rights:

```
tar -xf xclang-23.1.2.5-x86_64-w64-mingw32.tar.xz
```

Put `xclang/bin` in `PATH`, or name the programs by their path.

## Versions

A release is tagged `<llvm version>.<revision>`, `23.1.2.1` for the first
build of LLVM 23.1.2, a version conda can order. Nothing published is ever
replaced; a rebuild gets the next revision. [CHANGELOG.md](../CHANGELOG.md)
lists what each release changed.
