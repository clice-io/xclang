# Versions and releases

## Versions

A release is tagged `<llvm version>.<revision>`: `23.1.2.1` is the first
build of LLVM 23.1.2, `23.1.2.6` the sixth. The version orders the way conda,
Bazel and CMake order versions, and says which LLVM it is.

Nothing published is ever replaced. A fix to a release, even one that only
rebuilds it, is the next revision; the workflow that drafts a release
refuses a version that exists. So a version, and the sha256 of each of its
archives, means one thing forever, which is what pinning by digest
(Bazel's `versions.bzl`, CMake's download) relies on.

The conda package's version is the release's; its build number counts
packaging fixes of that release, each the same toolchain packaged again.
The Bazel module's version is the release's.

What each release changed is in the
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## Assets

Every [GitHub release](https://github.com/clice-io/xclang/releases) has the
same 17 assets:

| asset | | size (23.1.2.6) |
|---|---|---|
| `xclang-<version>-<host>.tar.xz` | the toolchain, one per host, every target in each | 95 to 128 MB |
| `libclang-<version>-<host>.tar.xz` | clang's and LLVM's static libraries and headers, one per host ([libclang](../features/libclang.md)) | 260 to 274 MB |
| `libclang-<version>-<host>-asan.tar.xz` | their ASan build, for Linux x64 and macOS arm64 | 191, 210 MB |
| `llvm-option-inc-<version>.tar.xz` | the option tables of clang, lld, llvm-lib and llvm-dlltool | 175 KB |
| `xclang-<version>.profdata` | the PGO profile the release was built with | 52 MB |
| `SHA256SUMS` | the sha256 of every other asset | |

The hosts are `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
`x86_64-w64-mingw32`, `aarch64-w64-mingw32`, `aarch64-apple-darwin` and
`x86_64-apple-darwin`.

## Checking a download

`SHA256SUMS` is written by the workflow that drafts the release, from the
files it uploads. To check what was downloaded against it:

```sh
gh release download 23.1.2.6 -R clice-io/xclang -p SHA256SUMS -p 'llvm-option-inc-*'
sha256sum -c --ignore-missing SHA256SUMS
```

The Bazel module checks every archive by the sha256 its `versions.bzl` pins,
and CMake's `xclang.cmake` checks the toolchain against the release's
`SHA256SUMS`. Both are as trustworthy as the release: GitHub releases are
not yet immutable, so an archive and the `SHA256SUMS` beside it could in
principle be replaced together. A pin in `versions.bzl`, or a digest
recorded in a project of its own, is not affected by that. Immutable
releases are [planned](../design/roadmap.md#reproducibility).

## Where else a release is published

- **conda**: [conda.clice.io](https://conda.clice.io), the `xclang` package
  per host and the noarch `llvm-option-inc`, made from the release's
  archives after it is published ([installing](../guide/install.md)).
- **Bazel**: [bazel.clice.io](https://bazel.clice.io), the module of the
  release's tag, published once it builds and tests with the published
  archives ([Bazel](../integrations/bazel.md)).
- **CMake**: the tag itself, which FetchContent checks out
  ([CMake](../integrations/cmake.md#without-xclang-installed)).

How a release is built and tested is in
[how a release is built](../design/release-build.md).
