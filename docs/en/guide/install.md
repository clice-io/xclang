# Installing

Four ways to get xclang, by how a project builds. Each gives the same
toolchain of the same release; pick the one that fits the build, not the
other way round.

| way | for | what it downloads |
|---|---|---|
| [pixi or conda](#pixi-and-conda) | a developer's machine, CI, any build system | the host's toolchain, as a conda package |
| [release archive](#archives) | anything: unpack and use | the host's toolchain |
| [CMake FetchContent](#cmake-fetchcontent) | a CMake project that should configure with nothing installed | the host's toolchain, into the user's cache |
| [Bazel registry](#bazel) | a Bazel project | the host's toolchain, and libclang if used, by sha256 |

## pixi and conda

From the [clice conda channel](https://conda.clice.io), with pixi:

```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "23.1.2.6.*"
```

The package is the host's archive, every target included, under
`$PREFIX/opt/xclang`, whose `bin/` the environment's activation puts first
in `PATH`; nothing goes to `$PREFIX/bin`, so conda-forge's compilers stay as
they are. There is one package per host: `linux-64`, `linux-aarch64`,
`osx-64`, `osx-arm64`, `win-64` and `win-arm64`. `llvm-option-inc` (noarch)
holds the option tables in `$PREFIX/include/llvm-options-td`.

The package's version is the release's; its build number counts packaging
fixes of that release. `23.1.2.6.*` takes the newest build of 23.1.2.6.

xclang is not a compiler for building conda-forge packages. conda-forge's
own `clang`/`gcc` stacks link dynamically against packaged runtimes
(`libcxx`, `libstdcxx`) and add them to a package's dependencies through
`run_exports`; xclang links its runtimes into every program and has no
`run_exports`, on purpose ([hermeticity](../design/hermeticity.md)).

Tested by: [examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml)
installs this workspace from conda.clice.io on every host and runs the
[quick start](quick-start.md); conda.yml tests each package before it is
published.

## Archives

Every [GitHub release](https://github.com/clice-io/xclang/releases) has the
toolchain for each host, `xclang-<version>-<host>.tar.xz`, 95 to 128 MB:
clang, lld and the LLVM binary tools, FileCheck, xclang's CMake package and
every target's sysroot and runtimes. The other assets (libclang, the
option tables, the PGO profile) are in [releases](../reference/releases.md).

An archive unpacks anywhere and is used from there: the toolchain is the
directory `xclang/`. On Linux:

```sh
v=23.1.2.6 h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
curl -LO https://github.com/clice-io/xclang/releases/download/$v/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
tar -xf xclang-$v-$h.tar.xz
xclang/bin/clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

On macOS the same, with `shasum -a 256 -c --ignore-missing SHA256SUMS`. On
Windows, in PowerShell, whose `tar` is the system's own
(`C:\Windows\System32\tar.exe`):

```powershell
$v = "23.1.2.6"; $h = "x86_64-w64-mingw32"
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/SHA256SUMS
$sum = (Get-FileHash xclang-$v-$h.tar.xz -Algorithm SHA256).Hash.ToLower()
if (-not (Select-String -SimpleMatch -Quiet "$sum  xclang-$v-$h.tar.xz" SHA256SUMS)) { throw "sha256 mismatch" }
tar -xf xclang-$v-$h.tar.xz
xclang\bin\clang++ --target=aarch64-unknown-linux-gnu hello.cpp -o hello
```

A Windows archive holds no symbolic links, so it unpacks without extra
rights ([why](../design/toolchain.md#windows-launchers-not-links)). Put
`xclang/bin` in `PATH`, or name the programs by their path.

Tested by: examples.yml runs these commands on a machine of every host.

## CMake FetchContent

A CMake project can download the toolchain itself, before `project()`, so
it configures on a machine with nothing but CMake and Ninja:

```cmake
set(XCLANG_VERSION 23.1.2.6)
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG ${XCLANG_VERSION})
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

It checks the archive against the release's `SHA256SUMS` and unpacks it
into the user's cache once per version and host. See
[CMake](../integrations/cmake.md#without-xclang-installed).

## Bazel

From the clice registry, [bazel.clice.io](https://bazel.clice.io):

```
# .bazelrc
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

```python
# MODULE.bazel
bazel_dep(name = "xclang", version = "23.1.2.6")
```

The module downloads the host's archive by the sha256 its release pins,
and registers it as the C++ toolchain for every target. See
[Bazel](../integrations/bazel.md).

## Versions

A release is tagged `<llvm version>.<revision>`: `23.1.2.6` is the sixth
build of LLVM 23.1.2. Nothing published is ever replaced; a rebuild is the
next revision ([versions and releases](../reference/releases.md)). The
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md)
says what each release changed.
