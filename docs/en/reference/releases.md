# Versions and Releases

How releases are numbered, what each one publishes, and how to check a
download. What each release changed is in the
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## Versions

A release is tagged `<llvm version>.<revision>`. `23.1.2.1` is the first
build of LLVM 23.1.2, and `23.1.2.6` the sixth. The version sorts the way
conda, Bazel and CMake sort versions, and says which LLVM it is.

Nothing published is ever replaced. A fix to a release, even one that only
rebuilds it, is the next revision, and the workflow that drafts a release
refuses a version that exists. So a version, and the sha256 of each of its
archives, means one thing forever. Pinning by digest relies on that, in
the `versions.bzl` of the Bazel module and in the CMake download.

| where | version |
|---|---|
| GitHub release and tag | `23.1.2.6` |
| conda package | `23.1.2.6`; the build number counts packaging fixes of the release, each the same toolchain packaged again |
| Bazel module | `23.1.2.6` |

## Assets

Every [GitHub release](https://github.com/clice-io/xclang/releases) has the
same 17 assets:

| asset | | size (23.1.2.6) |
|---|---|---|
| `xclang-<version>-<host>.tar.xz` | the toolchain, one per host, every target in each | 95 to 128 MB |
| `libclang-<version>-<host>.tar.xz` | the static libraries and headers of clang and LLVM, one per host ([libclang](../features/libclang.md)) | 260 to 274 MB |
| `libclang-<version>-<host>-asan.tar.xz` | their ASan build, for Linux x64 and macOS arm64 | 191, 210 MB |
| `llvm-option-inc-<version>.tar.xz` | the option tables of clang, lld, llvm-lib and llvm-dlltool | 175 KB |
| `xclang-<version>.profdata` | the PGO profile the release was built with | 52 MB |
| `SHA256SUMS` | the sha256 of every other asset | |

The hosts are `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
`x86_64-w64-mingw32`, `aarch64-w64-mingw32`, `aarch64-apple-darwin` and
`x86_64-apple-darwin`.

## Checking a Download

The workflow that drafts the release writes `SHA256SUMS` from the files it
uploads. This checks a download against it:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
gh release download 23.1.2.6 -R clice-io/xclang -p SHA256SUMS -p 'llvm-option-inc-*'
sha256sum -c --ignore-missing SHA256SUMS
```

The Bazel module checks every archive against the sha256 that its
`versions.bzl` pins. The `xclang.cmake` of the CMake package checks the
toolchain against the `SHA256SUMS` of the release.

Both are as trustworthy as the release. An archive and the `SHA256SUMS`
beside it could in principle be replaced together. A pin in `versions.bzl`,
or a digest recorded in a project of its own, is not affected by that.
Immutable releases are [planned](../design/roadmap.md#immutable-releases).

## Where Else a Release Is Published

- **conda**: [conda.clice.io](https://conda.clice.io) has the `xclang`
  package for each host, and the noarch `llvm-option-inc`. They are made
  from the archives of the release after it is published
  ([installation](../guide/install.md#pixi-and-conda)).
- **Bazel**: [bazel.clice.io](https://bazel.clice.io) has the module of
  the tag, published once it builds and tests with the published archives
  ([Bazel](../integrations/bazel.md)).
- **CMake**: FetchContent checks out the tag itself
  ([CMake](../integrations/cmake.md#without-xclang-installed)).

How a release is built and tested is in the
[build pipeline](../dev/release-build.md).
