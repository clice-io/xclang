# Installation

Four ways to get xclang. Each gives the same toolchain of the same
release, so pick the one that fits the build.

| way | for | what it downloads |
|---|---|---|
| [pixi or conda](#pixi-and-conda) | a developer machine, CI, any build system | the host toolchain, as a conda package |
| [release archive](#archives) | anything: unpack and use | the host toolchain |
| [CMake FetchContent](#cmake-fetchcontent) | a CMake project that configures with nothing installed | the host toolchain, into the cache of the user |
| [Bazel registry](#bazel) | a Bazel project | the host toolchain, and libclang if used, by sha256 |

In these docs, the *toolchain directory* is where the toolchain is
installed or unpacked, `$XCLANG` in commands. Its `bin/` holds clang, lld
and the other tools ([archive layout](../reference/layout.md)).

## pixi and conda

xclang is in the [clice conda channel](https://conda.clice.io). With
pixi, a workspace names the channel and the release:

<!-- file: examples/quickstart/pixi.toml -->
```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "23.1.2.8.*"
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi install
```

- The package is the host archive, every target included, in
  `$PREFIX/opt/xclang`. The activation of the environment puts its `bin/`
  first in `PATH`. Nothing goes to `$PREFIX/bin`, so the compilers of
  conda-forge stay as they are.
- There is one package per host: `linux-64`, `linux-aarch64`, `osx-64`,
  `osx-arm64`, `win-64` and `win-arm64`.
- `23.1.2.8.*` takes the newest build of the release. The build number
  counts packaging fixes ([versions](../reference/releases.md#versions)).
- `llvm-option-inc`, a noarch package, holds the option tables in
  `$PREFIX/include/llvm-options-td`.

xclang is not a compiler for building conda-forge packages
([why](../design/hermeticity.md#why-not-shared-runtimes)).

## Archives

Every [GitHub release](https://github.com/clice-io/xclang/releases) has
the toolchain for each host, `xclang-<version>-<host>.tar.xz`, 86 to
94 MB. It unpacks anywhere, and is used from there: the toolchain
directory is `xclang/`. On Linux:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
v=23.1.2.8 h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
curl -LO https://github.com/clice-io/xclang/releases/download/$v/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
tar -xf xclang-$v-$h.tar.xz
xclang/bin/clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

On macOS, check the download with
`shasum -a 256 -c --ignore-missing SHA256SUMS`. On Windows, use PowerShell,
whose `tar` is the one of the system (`C:\Windows\System32\tar.exe`):

<!-- excerpt: .github/workflows/examples.yml -->
```powershell
$v = "23.1.2.8"; $h = "x86_64-w64-mingw32"
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/SHA256SUMS
$sum = (Get-FileHash xclang-$v-$h.tar.xz -Algorithm SHA256).Hash.ToLower()
if (-not (Select-String -SimpleMatch -Quiet "$sum  xclang-$v-$h.tar.xz" SHA256SUMS)) { throw "sha256 mismatch" }
tar -xf xclang-$v-$h.tar.xz
xclang\bin\clang++ --target=aarch64-unknown-linux-gnu hello.cpp -o hello
```

`hello.cpp` is the one of the [quick start](quick-start.md). Put
`xclang/bin` in `PATH`, or name the programs by their path. A Windows
archive holds no symbolic links, so it unpacks without extra rights
([launchers](../design/windows.md#the-launchers)). The other assets of a
release, such as libclang, are listed in
[releases](../reference/releases.md#assets).

## CMake FetchContent

A CMake project can download the toolchain itself, before `project()`, so
it configures on a machine with nothing but CMake and Ninja:

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
set(XCLANG_VERSION 23.1.2.8)
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG ${XCLANG_VERSION})
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

It checks the archive against the `SHA256SUMS` of the release, and unpacks
it into the cache of the user, once per release and host. The whole
project is in [CMake](../integrations/cmake.md#without-xclang-installed).

## Bazel

The clice registry, [bazel.clice.io](https://bazel.clice.io), has the
module. Add the registry to `.bazelrc`:

<!-- excerpt: examples/bazel/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

Then depend on xclang in `MODULE.bazel`:

<!-- excerpt: examples/bazel/MODULE.bazel -->
```python
bazel_dep(name = "xclang", version = "23.1.2.8")
```

The module downloads the host archive by the sha256 that its release pins,
and registers it as the C++ toolchain for every target. The whole project
is in [Bazel](../integrations/bazel.md#set-up-a-project).

## Check It Works

`clang++ --version`, from `PATH` or from the toolchain directory, prints
the clang version and `InstalledDir`, the `bin/` it runs from:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ --version
```

The release, `23.1.2.8`, is tagged `<llvm version>.<revision>`
([versions](../reference/releases.md#versions)). What each release changed
is in the
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## Next

- [Quick Start](quick-start.md): programs for every target, and a CMake
  project with `import std`.
- [Cross-Compiling](cross-compiling.md).
