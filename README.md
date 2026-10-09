# xclang

[中文](README.zh-CN.md) · [Documentation](https://docs.clice.io/xclang)

Cross-compiling with clang the way rustup, cross-rs and cargo-zigbuild let
Rust do it: one compiler for every target. Today every toolchain carries six
common targets, prebuilt, and cross-compiling to them is a `--target` flag.
Its `xclang` command fetches the vendor SDKs that cannot be redistributed,
Microsoft's and Apple's, for the MSVC targets and for macOS targets on
Linux and Windows hosts. Where it is going: more targets, fetched when a
build needs them, and runtimes built from source on demand. None of that
is in a release yet; the
[roadmap](https://docs.clice.io/xclang/design/roadmap) gives each item's
status.

It aims to be close to the current best practice for hermetic, modern C++
builds: [why xclang](https://docs.clice.io/xclang/guide/why-xclang) makes
that case angle by angle.

One directory holds the compiler, the linker, the binary tools and, for
the six targets, the sysroot and the runtimes:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

No `--sysroot`, no `-L`, no SDK to install: `bin/aarch64-w64-mingw32.cfg`,
which clang reads for that target, points it at
`xclang/aarch64-w64-mingw32/`, and it links the libc++, libunwind and
compiler-rt built for that exact target.

## Targets

Every host toolchain (Linux, Windows and macOS, x64 and arm64) carries the
six common targets: Linux x64 and arm64 with glibc 2.17, Windows x64 and
arm64 with MinGW-w64 (UCRT), and macOS arm64 and x64, with Xcode's SDK on
macOS hosts. From 23.1.2.10 on, also the **musl targets**, Linux x64 and
arm64: static programs that take nothing from the system they run on
([musl targets](https://docs.clice.io/xclang/reference/targets#musl-targets)).

With the SDKs the user fetches with the toolchain's `xclang` command
(`xclang sdk fetch`), from 23.1.2.7 on:

- **MSVC-ABI targets**, Windows x64 and arm64 against Microsoft's CRT, STL
  and Windows SDK, from every host
  ([MSVC targets](https://docs.clice.io/xclang/integrations/clang#msvc-targets)).
- **macOS targets from Linux and Windows**, with Apple's SDK
  ([macOS](https://docs.clice.io/xclang/design/macos#the-sdk-on-linux-and-windows-hosts)).

Not supported yet, each with its status in the roadmap:

- **Other Linux architectures**, musl's too, WebAssembly, Android,
  FreeBSD and bare metal:
  [considered](https://docs.clice.io/xclang/design/roadmap#targets).
- **Target archives** for `xclang target add`, to fetch targets beyond
  these: [planned](https://docs.clice.io/xclang/design/roadmap#target-archives).

## Who it is for

People who want a toolchain they can pin, ship and reproduce, and binaries
that run wherever they are copied:

- **Hermetic.** A program depends at run time only on the system libraries
  every installation of its OS has and no one may redistribute: glibc on
  Linux (2.17 or later), libSystem and the system frameworks it uses on
  macOS, the OS's DLLs on Windows, UCRT included (Windows 10 and later).
  Everything else, libc++, libc++abi, libunwind and the builtins among them,
  is linked statically. At build time the only inputs from outside the
  toolchain are the vendor SDKs: the installed Xcode's on macOS hosts, and
  those the user fetches with the `xclang` command. Sanitizer runtimes are
  the exception
  ([hermeticity](https://docs.clice.io/xclang/design/hermeticity)).
- **Every piece is usable on its own.** The sysroots and runtimes are plain
  directories laid out the way clang's drivers expect.
- **Fast.** clang and lld are built with PGO and ThinLTO, and linked
  statically against xclang's own libc++ on every host.
- **Small.** clang, lld and most tools are one program, `llvm`, 86 to
  94 MB an archive.
- **For tools on clang** too: each release has the libclang it was built
  from and the option tables.

It is not a compiler for building conda-forge packages: conda-forge's
`clang`/`gcc` stacks link dynamically against packaged runtimes and
integrate with `run_exports`; xclang deliberately does neither.

## Install

From the [clice conda channel](https://conda.clice.io), with pixi:

```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "*"
```

`"*"` is the newest release, which `pixi.lock` keeps until `pixi update`.
The environment puts xclang's `bin/` first in `PATH` and leaves
conda-forge's compilers alone. Or take the archives from the
[GitHub release](https://github.com/clice-io/xclang/releases) and unpack
them anywhere. The
[quick start](https://docs.clice.io/xclang/guide/quick-start) goes from here
to programs for every target and a CMake project with `import std`.

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
bazel_dep(name = "xclang", version = "23.1.2.8")  # or newer
```

and, from 23.1.2.6 on, another target is a platform:

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //...
```

## Documentation

At [docs.clice.io/xclang](https://docs.clice.io/xclang), from
[docs/en](docs/en):

- Guide:
  [What is xclang?](https://docs.clice.io/xclang/guide/what-is-xclang),
  [Quick Start](https://docs.clice.io/xclang/guide/quick-start),
  [Installation](https://docs.clice.io/xclang/guide/install),
  [Cross-Compiling](https://docs.clice.io/xclang/guide/cross-compiling),
  [Why xclang?](https://docs.clice.io/xclang/guide/why-xclang),
  [Comparisons](https://docs.clice.io/xclang/guide/comparisons) with zig cc,
  llvm-mingw, conda-forge and others,
  [FAQ](https://docs.clice.io/xclang/guide/faq)
- Integrations: [CMake](https://docs.clice.io/xclang/integrations/cmake),
  [Bazel](https://docs.clice.io/xclang/integrations/bazel),
  [Make and Meson](https://docs.clice.io/xclang/integrations/clang),
  [Cargo](https://docs.clice.io/xclang/integrations/cargo),
  [CI](https://docs.clice.io/xclang/integrations/ci)
- Features: [Modules](https://docs.clice.io/xclang/features/modules),
  [Sanitizers](https://docs.clice.io/xclang/features/sanitizers),
  [Debugging](https://docs.clice.io/xclang/features/debugging),
  [libclang](https://docs.clice.io/xclang/features/libclang),
  [ThinLTO Cache](https://docs.clice.io/xclang/features/thinlto-cache)
- Reference: [Targets](https://docs.clice.io/xclang/reference/targets),
  [Compatibility](https://docs.clice.io/xclang/reference/compatibility),
  [Archive Layout](https://docs.clice.io/xclang/reference/layout),
  [CMake API](https://docs.clice.io/xclang/reference/cmake-api),
  [Bazel API](https://docs.clice.io/xclang/reference/bazel-api),
  [Releases](https://docs.clice.io/xclang/reference/releases),
  [LLVM Patches](https://docs.clice.io/xclang/reference/patches),
  [xclang Command](https://docs.clice.io/xclang/reference/xclang-command)
- Design: [Hermeticity](https://docs.clice.io/xclang/design/hermeticity),
  [PGO](https://docs.clice.io/xclang/design/pgo),
  [Roadmap](https://docs.clice.io/xclang/design/roadmap), and more
- Development:
  [Contributing](https://docs.clice.io/xclang/dev/contributing),
  [Build Pipeline](https://docs.clice.io/xclang/dev/release-build),
  [Testing](https://docs.clice.io/xclang/dev/testing),
  [Releasing](https://docs.clice.io/xclang/dev/releasing)
- [CHANGELOG](CHANGELOG.md), [contributing](CONTRIBUTING.md),
  [security](SECURITY.md)

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user;
[catter](https://github.com/clice-io/catter) builds with it too.
