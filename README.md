# xclang

[中文](README.zh-CN.md)

Cross-compiling with clang the way rustup, cross-rs and cargo-zigbuild
let Rust do it: one compiler for every target. The common targets come
with the toolchain; everything else (more targets, and the vendor SDKs
that cannot be redistributed) is fetched when a build needs it. The
runtimes are prebuilt, and are later to be built on demand as well. Partly
like `zig cc`, with stock clang, and without bundling everything.

Today one directory holds the compiler, the linker, the binary tools and,
for six targets, the sysroot and the runtimes, so cross-compiling is a
`--target` flag and nothing else:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

No `--sysroot`, no `-L`, no SDK to install: `bin/aarch64-w64-mingw32.cfg`,
which clang reads for that target, points it at `xclang/aarch64-w64-mingw32/`,
and it links the libc++, libunwind and compiler-rt built for that exact
target.

## Targets

Every host toolchain (Linux, Windows and macOS, x64 and arm64) carries the
six common targets: Linux x64 and arm64 with glibc 2.17, Windows x64 and
arm64 with MinGW-w64 (UCRT), and macOS arm64 and x64, which use Xcode's SDK
and so build on macOS hosts only.

MinGW is today's Windows target; MSVC-ABI targets, against the user's own
MSVC and Windows SDK, are to be first-class. They are in research, as is
building for macOS from any host with Apple's SDK. A command, `xclang`,
that fetches more targets and the vendor SDKs (`xclang target add`,
`xclang sdk fetch`) is planned and does not exist yet. The
[roadmap](docs/roadmap.md) lists the targets, their tiers and where each
stands.

## Who it is for

People who want a toolchain they can pin, ship and reproduce, and binaries
that run wherever they are copied:

- **Hermetic.** A program depends at run time only on the system libraries
  every installation of its OS has and no one may redistribute: glibc on
  Linux (2.17 or later), libSystem and the system frameworks it uses on
  macOS, the OS's DLLs on Windows, UCRT included (Windows 10 and later).
  Everything else, libc++, libc++abi, libunwind and the builtins among
  them, is linked statically. At build time the only inputs from outside
  are vendor SDKs, pinned. Sanitizer runtimes are the exception
  ([layout](docs/layout.md#hermeticity)).
- **Every piece is usable on its own.** The sysroots and runtimes are plain
  directories laid out the way clang's drivers expect.
- **Fast.** clang and lld are built with PGO and ThinLTO, and linked
  statically against xclang's own libc++ on every host.
- **Small.** clang, lld and most tools are one program, `llvm`, 80 to
  120 MB an archive.
- **For tools on clang** too: each release has the libclang it was built
  from and the option tables.

It is not a compiler for building conda-forge packages: conda-forge's
`clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## Install

From the [clice conda channel](https://conda.clice.io), with pixi:

```toml
[workspace]
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "osx-arm64", "win-64"]

[dependencies]
xclang = "23.1.2.6.*"
```

The environment puts xclang's `bin/` first in `PATH` and leaves
conda-forge's compilers alone. Or take the archives from the
[GitHub release](https://github.com/clice-io/xclang/releases) and unpack
them anywhere.

## Use

```sh
clang++ main.cpp -o main                                # this host
clang++ --target=x86_64-w64-mingw32 main.cpp -o main.exe  # another target
```

CMake, with `import std` from the toolchain's libc++ (from 23.1.2.6 on):

```cmake
cmake_minimum_required(VERSION 3.28)
project(app LANGUAGES CXX)
find_package(xclang REQUIRED CONFIG)
add_executable(app main.cpp)
target_link_libraries(app PRIVATE xclang::std)
```

Bazel, from the clice registry [bazel.clice.io](https://bazel.clice.io):

```starlark
bazel_dep(name = "xclang", version = "23.1.2.6")
```

and, from 23.1.2.6 on, another target is a platform:

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //...
```

## Documentation

- [Installing](docs/install.md): pixi and conda, the release archives, versions
- [Using clang](docs/clang.md): targets and config files, GCC's library names, sanitizers, `import std` by hand
- [CMake](docs/cmake.md): `find_package(xclang)`, `xclang::std`, other targets, downloading the toolchain with FetchContent
- [Bazel](docs/bazel.md): the module, its toolchains, cross-compiling, C++20 modules and sanitizers
- [libclang and the option tables](docs/libclang.md): for tools built on clang
- [Hosts, targets and layout](docs/layout.md), and the limits
- [How a release is built](docs/build.md): the PGO pipeline, the tests, the workflows, the repository
- [Patches](docs/patches.md) to LLVM
- [Roadmap](docs/roadmap.md): the aim, the targets and their tiers, what is planned, considered or in research
- [CHANGELOG](CHANGELOG.md)

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user; [catter](https://github.com/clice-io/catter)
builds with it too.
