# Releases

Every xclang release is published to GitHub releases, the clice conda
channel, CMake `FetchContent`, and the clice Bazel registry. How to install
xclang is in the [quick start](../guide/quick-start.md), and what is inside
an unpacked archive is in [archive layout](layout.md).

## Versions

Every release is tagged `<llvm version>.<revision>`. `23.1.2.1` is the
first build of LLVM 23.1.2, and `23.1.2.2` is the second. The version
identifies the upstream LLVM version and sorts consistently in conda, Bazel
and CMake.

Published releases are never replaced. A fix or rebuild is always published
as the next revision, and the release workflow refuses a version tag that
already exists. A version and the `sha256` digests of its archives refer to
the exact same bytes permanently. What changed in each release is recorded
in the [CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## Repacks

When a change affects only the packaging, such as the Bazel module, the
CMake package or the target config files, the release is a *repack*: the
next revision reuses the compiler and runtimes of the previous release,
byte for byte.

## Channels

Each channel publishes the release under its `<version>` and provides a way
to select a pinned release or the newest one:

| channel | what it publishes | pin a release | take the newest |
|---|---|---|---|
| [GitHub releases](https://github.com/clice-io/xclang/releases) | all 17 release assets | `releases/download/<version>` | `releases/latest`, whose `SHA256SUMS` names the version |
| [conda.clice.io](https://conda.clice.io) | `xclang` per host and `noarch` `llvm-option-inc`, built from the release archives | `xclang = "<version>.*"` (the package build number counts packaging fixes of that release) | `xclang = "*"`, locked in `pixi.lock` until `pixi update` |
| CMake FetchContent | the repository tag `<version>` | `GIT_TAG <version>` | `GIT_TAG latest`, a branch at the newest release tag |
| [bazel.clice.io](https://bazel.clice.io) | the `xclang` Bazel module, published after it builds and tests against the release archives | `version = "<version>"` | Bazel resolves the newest version requested across the dependency graph |

## Assets

Every [GitHub release](https://github.com/clice-io/xclang/releases)
contains the same 17 assets:

| asset | contents | size |
|---|---|---|
| `xclang-<version>-<host>.tar.xz` | the toolchain archive, one per host, with all eight bundled targets ([archive layout](layout.md)) | about 100 MB |
| `libclang-<version>-<host>.tar.xz` | the static libraries and headers of `clang` and LLVM, one per host ([libclang](../features/libclang.md)) | about 265 MB |
| `libclang-<version>-<host>-asan.tar.xz` | the ASan-instrumented build of `libclang`, for Linux x64 and macOS arm64 ([the ASan build](../features/libclang.md#the-asan-build)) | about 200 MB |
| `llvm-option-inc-<version>.tar.xz` | the pre-generated option tables of `clang`, `lld`, `llvm-lib` and `llvm-dlltool` ([the option tables](../features/libclang.md#the-option-tables)) | about 200 KB |
| `xclang-<version>.profdata` | the PGO profile the release was built with ([PGO](../design/pgo.md)) | about 50 MB |
| `SHA256SUMS` | the `sha256` digest of every other asset in the release | |

The six `<host>` triples are `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`,
`aarch64-apple-darwin` and `x86_64-apple-darwin`.

## Checking a Download

The release workflow generates `SHA256SUMS` from the assets it uploads.
Verify any downloaded asset against `SHA256SUMS` (pass `<version>` to
`gh release download` for a specific release):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
gh release download -R clice-io/xclang -p SHA256SUMS -p 'llvm-option-inc-*'
sha256sum -c --ignore-missing SHA256SUMS
```

The Bazel module checks every downloaded archive against the `sha256`
digest pinned in its `versions.bzl`. CMake's `xclang.cmake` checks the
toolchain archive against the `SHA256SUMS` file of the release. Pinning a
digest in `versions.bzl` or in your own repository also protects against an
archive and `SHA256SUMS` being replaced together on GitHub
([immutable GitHub releases](../design/roadmap.md#immutable-releases)).

## Reproducible Builds

Every release makes each host's archives twice, on two machines, and builds
the `xclang` command twice, and compares them byte for byte: the archives
are sorted, carry the commit's time and no owner, and are compressed in
fixed blocks. A rebuild of a revision with its profile,
`xclang-<version>.profdata`, is meant to give every archive again: every
full rebuild starts a second full build, which checks that it does before
the release is published. That is checked, not guaranteed: a
bug of the compiler or linker that builds xclang can break it. A rebuild
also needs GitHub's runners, as the programs keep some paths of the build
and the macOS builds record the runner's Xcode SDK version.
