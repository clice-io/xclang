# Compatibility

The oldest systems and tools xclang and the programs it builds work with,
and what is not supported.

## The toolchain

| host | needs |
|---|---|
| Linux x64, arm64 | glibc 2.17 or later; nothing else (clang and lld link libc++ statically) |
| macOS arm64, x64 | macOS 13 or later; for macOS targets, Xcode or the Command Line Tools (the SDK) |
| Windows x64, arm64 | Windows 10 or later (UCRT is part of the OS) |

## Programs it builds

| target | runs on |
|---|---|
| Linux x64, arm64 | glibc 2.17 or later: CentOS 7, Debian 8, Ubuntu 14.04 and every later distribution with glibc |
| Windows x64, arm64 | Windows 10 or later, where UCRT is part of the OS |
| macOS arm64, x64 | macOS 13.0 or later (`-mmacos-version-min=13.0` in the config file; one given on the command line comes after it and replaces it) |

What a program loads at run time is in
[hermeticity](../design/hermeticity.md).

## Build tools

| tool | version | why |
|---|---|---|
| CMake | 3.28 or later | the first that builds C++20 modules without experimental switches; `find_package(xclang)` refuses older ones |
| Ninja | 1.11 or later | what CMake requires to build C++20 modules; Ninja and Ninja Multi-Config are the generators that build them for these targets |
| Bazel | 9 | the module's toolchains are rules_cc 0.2.25's; C++20 modules need `--experimental_cpp_modules` |
| Xcode | one whose SDK ld64.lld reads: Xcode 27's macOS 27 SDK needs 23.1.2.6 or later (patch 0009) | |
| Rust | Rust's `*-windows-gnullvm` targets for Windows (not `*-windows-gnu`) | see [Rust and cargo](../integrations/cargo.md) |

## Not supported

- **Linux, from glibc 2.17**: no `-static-pie` (glibc 2.17 has no
  `rcrt1.o`); `-pg` needs `-no-pie` (its `gcrt1.o` is not
  position-independent); no `quadmath.h` (`libquadmath` is GCC's own;
  `__float128` arithmetic works).
- **No OpenMP runtime** (`-fopenmp`), **no MemorySanitizer** (it needs every
  library instrumented, libc++ too:
  [roadmap](../design/roadmap.md#libc-built-on-demand)), **no sanitizers
  for Windows targets**.
- **No clang-format, clang-tidy or clangd binaries**: xclang is a compiler
  toolchain; libclang has the libraries tools on clang link.
- **One libc++ per shared object**: a standard exception thrown by one
  shared library is caught by type in another only on Windows; on Linux and
  macOS only as `catch (...)`. See
  [hermeticity](../design/hermeticity.md#one-libc-per-shared-object).
- **macOS targets from Linux or Windows hosts**: not yet
  ([roadmap](../design/roadmap.md)); the SDK is Xcode's.
- **MSVC-ABI targets** (`*-pc-windows-msvc`): not yet, in research. clang,
  clang-cl and lld-link build for them against the user's own MSVC and
  Windows SDK, as upstream clang does, but xclang has no config files or
  runtimes for them yet.
- **Building conda-forge packages**: conda-forge's compilers link
  dynamically against packaged runtimes and integrate with `run_exports`;
  xclang does neither.
