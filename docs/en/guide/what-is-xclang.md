# What is xclang?

xclang is a clang toolchain for cross-compiling: one compiler for every
target. One directory holds the compiler, the linker, the binary tools, and
the *sysroot* (the C library's headers and libraries) and prebuilt runtimes
for eight targets. Cross-compiling is a `--target` flag and nothing else:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

## What Is in a Release

- **clang, lld and the LLVM binary tools**, built from stock LLVM with a
  few [patches](../reference/patches.md) on their way upstream, packaged as
  one multicall program (`llvm`) and linked statically against xclang's own
  `libc++` for six hosts ([toolchain structure](../design/toolchain.md)).
- **Eight targets in every archive**: [Linux](cross-compiling.md#linux) x64
  and arm64 (glibc 2.17, and musl 1.2.6 for static programs),
  [Windows](cross-compiling.md#windows) x64 and arm64 (MinGW-w64 with UCRT),
  and [macOS](cross-compiling.md#macos) arm64 and x64. Each target has its
  sysroot, `libc++`, `libc++abi`, `libunwind` and `compiler-rt`, prebuilt,
  and a config file that points `clang` at them
  ([cross-compiling](cross-compiling.md)).
- **The MSVC targets**, Windows x64 and arm64 with Microsoft's CRT and
  xclang's `libc++` (or Microsoft's STL), from every host, against the SDK
  that the `xclang` command fetches from Microsoft or an installed Visual
  Studio on Windows ([Windows](cross-compiling.md#windows),
  [Windows design](../design/windows.md)).
- **The `xclang` command**: it fetches the Apple and Microsoft SDKs that no
  one may redistribute, and `xclang cargo` builds Rust for xclang's targets
  with no cargo config ([the `xclang` command](../reference/xclang-command.md),
  [Rust and Cargo](../integrations/cargo.md)).
- **A CMake package and a Bazel module**, for the host or any target, with
  `import std` built for the build ([CMake](../integrations/cmake.md),
  [Bazel](../integrations/bazel.md)).
- **The runtimes' sources**, which the CMake package and the Bazel module
  build on demand for MemorySanitizer and for `libc++`'s hardening and ABI
  options, for every target but the MSVC ones
  ([runtimes from source](../features/runtimes-from-source.md)).
- **libclang**: the static libraries and headers of `clang` and LLVM that
  the release was built from, for tools built on `clang`
  ([libclang](../features/libclang.md)).

Targets and features that no release has yet are in the
[roadmap](../design/roadmap.md).

## What It Does for a Build

A C++ build is *hermetic* when its output depends only on its declared
inputs: the same sources and toolchain give the same program on any
machine and in any directory. That is what xclang is built for.

- **Reproducible.** A release is never replaced: a rebuild is the next
  revision. The Bazel module and CMake download check every archive by its
  `sha256`. In Bazel builds, no command line or debug information holds an
  absolute path except for Xcode's macOS SDK, so a build in a second
  checkout produces the same bytes ([the Bazel module](../design/bazel-module.md)).
- **Portable programs.** A program depends at run time only on the system
  libraries every installation of its OS has: glibc 2.17 or later on
  [Linux](cross-compiling.md#linux) (or nothing with musl),
  [Windows 10](cross-compiling.md#windows) or later, or
  [macOS 13](cross-compiling.md#macos) or later. `libc++` and the other
  runtimes are linked in, and build scripts written for GCC (`-latomic`,
  `-lgcc_s`, `-lstdc++`) link unchanged
  ([hermeticity](../design/hermeticity.md)).
- **One compiler for every target.** `clang` compiles for every LLVM target,
  and xclang ships the target libraries beside it. Selecting a target takes
  only `--target=<triple>`, and a compiler upgrade applies to all targets at
  once ([cross-compiling](cross-compiling.md)).
- **Correct build caches.** With a compiler taken from the machine, a new
  compiler version leaves a build cache serving objects from the old one. In
  Bazel, every toolchain file that an action reads is a declared input, so
  a new release rebuilds what it should, and module files are inputs of
  their importers
  ([the Bazel module](../design/bazel-module.md), [C++20 modules](../features/modules.md)).
- **C++20 modules.** A module file is usable only by importers compiled with
  the same language options, so a prebuilt `std` module cannot be shipped.
  xclang compiles `libc++`'s `std` and `std.compat` modules for each build
  with its options, as `xclang::std` in CMake without experimental switches
  and `@xclang//bazel:std` in Bazel ([C++20 modules](../features/modules.md)).
- **Fast.** `clang` and `lld` are built with PGO and ThinLTO on every host,
  trained on compiling real C and C++ code, precompiled headers, C++20
  modules and code completion ([PGO](../design/pgo.md)). `libclang` ships as
  ThinLTO bitcode, and the ThinLTO cache reduces relinks of tools built on it
  to seconds ([libclang](../features/libclang.md)).
- **Correctness tools.** xclang ships sanitizer runtimes along with an ASan
  build of `libc++` that prevents false container-overflow reports
  ([sanitizers](../features/sanitizers.md)), and builds the runtimes from
  source for MemorySanitizer ([runtimes from source](../features/runtimes-from-source.md)).
  Debug symbols come apart from the program: GSYM files, the same on every
  run, for every target but the MSVC ones, which have PDBs, and dSYMs for
  macOS ([debugging](../features/debugging.md)).
- **Supply chain.** Every archive is listed in `SHA256SUMS`, built from
  LLVM's release tarball with documented [patches](../reference/patches.md),
  made twice on two machines and compared byte for byte, and packaged with
  its components' licenses and an SPDX document
  ([releases](../reference/releases.md), [archive layout](../reference/layout.md)).
  Vendor SDKs are never in an archive; you fetch them from the vendor,
  pinned by version and `sha256`
  ([the `xclang` command](../reference/xclang-command.md)).
- **One toolchain for every build.** The same toolchain directory serves
  [plain clang, Make and Meson](../integrations/clang.md),
  [CMake](../integrations/cmake.md), [Bazel](../integrations/bazel.md), and
  [cargo](../integrations/cargo.md), from pixi, an archive, FetchContent or
  the Bazel registry ([quick start](quick-start.md)).

## Who It Is For

- **Projects that ship programs** to user machines: command-line tools,
  language servers and build tools that run as a single file without a
  redistributable or Homebrew.
- **CI that builds for several targets** from one runner OS, with one
  compiler version for all of them ([CI](../integrations/ci.md)).
- **Teams that pin one toolchain** across developer machines and CI, in
  CMake, Bazel and plain commands.
- **C++20 modules** with `import std`, in CMake and Bazel.
- **Tools on clang**, which link `libclang` built with PGO.

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
[catter](https://github.com/clice-io/catter) builds with it too. xclang's
CI cross-compiles the tests of
[kotatsu](https://github.com/clice-io/kotatsu) for Windows from Linux and
runs them on Windows.

## What It Is Not

- **C++ libraries from another toolchain need its C++ library.** xclang's
  C++ library is `libc++`, linked into every program. A C++ library built
  with GCC's `libstdc++` or MSVC's STL has another ABI. Build C++
  dependencies with xclang for the target, or pass `-stdlib=platform` to
  use the platform's C++ library and give up self-contained programs
  ([cross-compiling](cross-compiling.md#the-platform-s-c-library)). C
  libraries are not affected.
- **One `libc++` per shared object.** Each shared library carries its own
  `libc++`, so C++ objects should not cross shared libraries, and on Linux
  and macOS a standard exception thrown in one is caught in another only by
  `catch (...)` ([hermeticity](../design/hermeticity.md#one-libc-per-shared-object),
  [roadmap](../design/roadmap.md#shared-runtime)).
- **No OpenMP runtime, and no `clang-format`, `clang-tidy` or `clangd`
  programs.** xclang is a compiler toolchain
  ([OpenMP](../design/roadmap.md#openmp),
  [tool binaries](../design/roadmap.md#tool-binaries)).
- **Not for conda-forge packages.** Use conda-forge's compilers, which link
  its shared runtime packages through `run_exports`; xclang does not
  ([roadmap](../design/roadmap.md#conda-forge)).

## Next

- [Quick Start](quick-start.md): install xclang, build programs for every
  target, and build a CMake project with `import std`.
- [Cross-Compiling](cross-compiling.md): targets, vendor SDKs, and platform
  details.
- [Releases](../reference/releases.md): version tags, channels, assets, and
  verifying downloads.
