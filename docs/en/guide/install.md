# Installation

Four ways to get xclang. Each gives the same toolchain from the same
release, so pick the one that fits your build.

| way | for | what it downloads |
|---|---|---|
| [pixi or conda](#pixi-and-conda) | a developer machine, CI, any build system | the host toolchain, as a conda package |
| [release archive](#archives) | anything: unpack and use | the host toolchain |
| [CMake FetchContent](#cmake-fetchcontent) | a CMake project that configures with nothing installed | the host toolchain, into the user's cache |
| [Bazel registry](#bazel) | a Bazel project | the host toolchain, and libclang if used, by `sha256` |

In these docs, the *toolchain directory* (`$XCLANG` in commands) is where
the toolchain is installed or unpacked. Its `bin/` holds clang, lld and the
other tools ([archive layout](../reference/layout.md)).

## pixi and conda

xclang is published in the [clice conda channel](https://conda.clice.io).
In a pixi workspace, add the channel and the `xclang` package:

<!-- file: examples/quickstart/pixi.toml -->
```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "*"
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi install
```

- The package unpacks the host archive, with every target included, into
  `$PREFIX/opt/xclang`. Activating the environment puts `$PREFIX/opt/xclang/bin`
  first in `PATH`. Nothing is placed in `$PREFIX/bin`, so conda-forge's
  compilers stay untouched.
- There is one package per host platform: `linux-64`, `linux-aarch64`,
  `osx-64`, `osx-arm64`, `win-64` and `win-arm64`.
- `llvm-option-inc`, a `noarch` package in the same channel, installs the
  option tables into `$PREFIX/include/llvm-options-td`.

xclang is not a compiler for building conda-forge recipes
([hermeticity](../design/hermeticity.md)).

## Archives

Every [GitHub release](https://github.com/clice-io/xclang/releases)
publishes a toolchain archive for each host,
`xclang-<version>-<host>.tar.xz` (about 100 MB). Unpack it anywhere and run
the tools from `xclang/bin/`. The `SHA256SUMS` file of the newest release
names its archives and version. On Linux:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
v=$(sed -n "s/^[0-9a-f]*  xclang-\(.*\)-$h\.tar\.xz$/\1/p" SHA256SUMS)
curl -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
sha256sum -c --ignore-missing SHA256SUMS
tar -xf xclang-$v-$h.tar.xz
xclang/bin/clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

On macOS, verify the digest with
`shasum -a 256 -c --ignore-missing SHA256SUMS`. On Windows, use PowerShell,
where `tar` is the system's `C:\Windows\System32\tar.exe`:

<!-- excerpt: .github/workflows/examples.yml -->
```powershell
$h = "x86_64-w64-mingw32"
curl.exe -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
$v = (Select-String -Path SHA256SUMS -Pattern "  xclang-(.+)-$h\.tar\.xz$").Matches[0].Groups[1].Value
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
$sum = (Get-FileHash xclang-$v-$h.tar.xz -Algorithm SHA256).Hash.ToLower()
if (-not (Select-String -SimpleMatch -Quiet "$sum  xclang-$v-$h.tar.xz" SHA256SUMS)) { throw "sha256 mismatch" }
tar -xf xclang-$v-$h.tar.xz
xclang\bin\clang++ --target=aarch64-unknown-linux-gnu hello.cpp -o hello
```

To pin a specific release, set `v` to its version and download `SHA256SUMS`
from `releases/download/$v`. `hello.cpp` is from the
[quick start](quick-start.md). Put `xclang/bin` in `PATH` or invoke the
binaries by path. A Windows archive contains no symbolic links, so it
unpacks without administrator rights or developer mode
([Windows](../targets/windows.md)). Vendor SDKs that `xclang sdk fetch`
adds on Windows are reached through junctions, which hold absolute paths:
after the toolchain directory moves, `xclang sdk use <name>` points them to
the new place, and a macOS SDK is fetched again
([the `xclang` command](../reference/xclang-command.md)).

## CMake FetchContent

A CMake project can download the host toolchain before `project()`, so the
build configures on a machine with only CMake, Ninja and Git installed:

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG latest)
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

`xclang.cmake` downloads the host archive for the release, verifies it
against the release's `SHA256SUMS`, and unpacks it into the user's cache
once per release and host ([CMake](../integrations/cmake.md)).

## Bazel

The clice registry at [bazel.clice.io](https://bazel.clice.io) hosts the
`xclang` Bazel module. Add the registry to `.bazelrc`:

<!-- excerpt: examples/bazel/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

Then declare the dependency in `MODULE.bazel`:

<!-- excerpt: examples/bazel/MODULE.bazel -->
```python
bazel_dep(name = "xclang", version = "23.1.5.1")
```

The module downloads the host archive verified by its pinned `sha256` and
registers it as the C++ toolchain for every target
([Bazel](../integrations/bazel.md)).

## Versions

Every release is tagged `<llvm version>.<revision>`. `23.1.2.1` is the
first build of LLVM 23.1.2, and `23.1.2.2` is the second. The version
identifies the upstream LLVM version and sorts consistently in conda, Bazel
and CMake.

Published releases are never replaced. A fix or rebuild is always published
as the next revision, and the release workflow refuses a version tag that
already exists. A version and the `sha256` digests of its archives refer to
the exact same bytes permanently.

When a change affects only the packaging, such as the Bazel module, the
CMake package or the target config files, the release is a *repack*: the
next revision reuses the compiler and runtimes of the previous release,
byte for byte.

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
| `xclang-<version>-<host>.tar.xz` | the toolchain archive, one per host, with all eight bundled targets | about 100 MB |
| `libclang-<version>-<host>.tar.xz` | the static libraries and headers of clang and LLVM, one per host ([libclang](../features/libclang.md)) | about 265 MB |
| `libclang-<version>-<host>-asan.tar.xz` | the ASan-instrumented build of libclang, for Linux x64 and macOS arm64 | about 200 MB |
| `llvm-option-inc-<version>.tar.xz` | the pre-generated option tables of clang, lld, llvm-lib and llvm-dlltool | about 200 KB |
| `xclang-<version>.profdata` | the PGO profile the release was built with ([PGO](../design/pgo.md)) | about 50 MB |
| `SHA256SUMS` | the `sha256` digest of every other asset in the release | |

The six `<host>` triples are `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`,
`aarch64-apple-darwin` and `x86_64-apple-darwin`.

## Checking a Download

The release workflow generates `SHA256SUMS` from the assets it uploads. You
can verify any downloaded asset against `SHA256SUMS` (pass `<version>` to
`gh release download` for a specific release):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
gh release download -R clice-io/xclang -p SHA256SUMS -p 'llvm-option-inc-*'
sha256sum -c --ignore-missing SHA256SUMS
```

The Bazel module checks every downloaded archive against the `sha256`
digest pinned in its `versions.bzl`. CMake's `xclang.cmake` checks the
toolchain archive against the `SHA256SUMS` file of the release.
Pinning a digest in `versions.bzl` or in your own repository also protects
against an archive and `SHA256SUMS` being replaced together on GitHub;
immutable GitHub releases are planned ([roadmap](../design/roadmap.md)).

## Check It Works

Run `clang++ --version` from `PATH` or from the toolchain directory to
print the compiler version and `InstalledDir`, the `bin/` directory it runs
from:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ --version
```

`xclang --version` prints its own version, the toolchain directory and its
release, `<llvm version>.<revision>`. What changed in each release is recorded in the
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## Next

- [Quick Start](quick-start.md): build programs for every target and a
  CMake project with `import std`.
- [Cross-Compiling](../targets/cross-compiling.md): targets, vendor SDKs
  and build system flags.
