# Compatibility

The oldest systems and tools that xclang, and the programs it builds, work
with.

## The Toolchain

| host | needs |
|---|---|
| Linux x64, arm64 | glibc 2.17 or later; nothing else (clang and lld link libc++ statically) |
| macOS arm64, x64 | macOS 13 or later; for macOS targets, Xcode or the Command Line Tools (the SDK) |
| Windows x64, arm64 | Windows 10 or later (UCRT is part of the OS) |

## Programs It Builds

| target | runs on |
|---|---|
| Linux x64, arm64 | glibc 2.17 or later: CentOS 7, Debian 8, Ubuntu 14.04 and every later distribution with glibc |
| Windows x64, arm64 | Windows 10 or later, where UCRT is part of the OS |
| macOS arm64, x64 | macOS 13.0 or later; a `-mmacos-version-min` on the command line comes after the config file's 13.0 and replaces it |

What a program loads at run time is in
[hermeticity](../design/hermeticity.md).

## Build Tools

| tool | version | why |
|---|---|---|
| CMake | 3.28 or later | the first that builds C++20 modules without experimental switches; `find_package(xclang)` refuses older ones |
| Ninja | 1.11 or later | what CMake requires to build C++20 modules; only the Ninja generators build them for these targets |
| Bazel | 9, with rules_cc 0.2.25 | the toolchains are rules_cc 0.2.25's; C++20 modules need `--experimental_cpp_modules` |
| Xcode | any whose SDK ld64.lld reads; Xcode 27 needs 23.1.2.6 or later | the macOS 27 SDK lists `arm64e.x1`, which ld64.lld reads with [patch 0009](patches.md) |
| Rust | the `*-windows-gnullvm` targets for Windows, not `*-windows-gnu` | their std links libunwind and UCRT, as the MinGW sysroots have them ([Rust and Cargo](../integrations/cargo.md)) |

## Not Yet Supported

| | status |
|---|---|
| [MSVC-ABI targets](../design/roadmap.md#msvc) (`*-pc-windows-msvc`), with their sanitizers | Planned |
| [macOS targets from Linux or Windows hosts](../design/roadmap.md#macos-any-host) | In research |
| [MemorySanitizer](../design/roadmap.md#msan) | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |

clang, clang-cl and lld-link already build for `*-pc-windows-msvc` against
the user's own MSVC and Windows SDK, as upstream clang does. xclang's
config files and runtimes for those targets come with the
[planned](../design/roadmap.md#msvc) MSVC targets.

## Known Limitations

- **Linux, from glibc 2.17**: no `-static-pie`, as glibc 2.17 has no
  `rcrt1.o`. `-pg` needs `-no-pie`, as its `gcrt1.o` is not
  position-independent. No `quadmath.h`: `libquadmath` is GCC's own, and
  `__float128` arithmetic works.
- **One libc++ per shared object**: a standard exception thrown by one
  shared library is caught by type in another only on Windows; on Linux and
  macOS only as `catch (...)`. See
  [hermeticity](../design/hermeticity.md#one-libc-per-shared-object).
- **No OpenMP runtime** (`-fopenmp`); one is
  [not planned](../design/roadmap.md#openmp).
- **No clang-format, clang-tidy or clangd programs**: xclang is a compiler
  toolchain, and libclang has the libraries tools on clang link. They are
  [not planned](../design/roadmap.md#tool-binaries).
- **Not for building conda-forge packages**: conda-forge's compilers link
  dynamically against packaged runtimes and integrate with `run_exports`;
  xclang does neither ([not planned](../design/roadmap.md#conda-forge)).
