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
| Linux x64, arm64 (musl), from 23.1.2.10 on | any distribution, with glibc or without: the programs are static |
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

Since 23.1.2.7, clang and clang-cl build for `*-pc-windows-msvc` against
the SDK the `xclang` command fetches, not an installed Visual Studio
([MSVC targets](../integrations/clang.md#msvc-targets)); lld-link, which
reads no config file, finds its libraries where they say, or by
`/winsysroot`. Without a fetched SDK, 23.1.2.7 and 23.1.2.8 stop at loading
the config file, for every compile of the target. Since 23.1.2.9, clang
looks for Visual Studio then on Windows, as upstream clang does and
releases before 23.1.2.7 did, and stops elsewhere only at a header or
library of Microsoft's. `--no-default-config` looks for Visual Studio
always.

## Not Yet Supported

| | status |
|---|---|
| [MemorySanitizer](../design/roadmap.md#msan) | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |

## Known Limitations

- **Linux, from glibc 2.17**: no `-static-pie`, as glibc 2.17 has no
  `rcrt1.o` (the musl targets have it). `-pg` needs `-no-pie`, as its `gcrt1.o` is not
  position-independent. No `quadmath.h`: `libquadmath` is GCC's own, and
  `__float128` arithmetic works.
- **musl targets**: static programs only. There is no `libc.so`, so no
  shared library and no `dlopen` of one, and of the sanitizers only UBSan
  ([sanitizers](../features/sanitizers.md#musl-targets)). Where musl
  differs from glibc, measured on GitHub's Linux x64 runners (4 cores):
  - **`malloc` under threads**: musl's allocator takes a lock that its
    threads contend for. 4 million `malloc` and `free` of 16 to 528 bytes
    took 0.21 s in one thread (glibc: 0.07 s); four threads doing as many
    each, at once, took 4.8 s (glibc: 0.12 s). A program that allocates
    from many threads wants an allocator of its own linked in.
  - **Locales**: musl has no locale data. It accepts any locale name and
    formats as the C locale: `printf("%'.1f")` of 1234567.5 prints
    `1234567.5` in `en_US.UTF-8`, where glibc prints `1,234,567.5`;
    libc++'s `std::locale` likewise.
  - **Name lookup**: musl reads `/etc/hosts` and `/etc/resolv.conf` and asks
    DNS itself. It has no NSS, so what `nsswitch.conf` adds through
    modules (mDNS `.local` names, LDAP or SSSD users and groups) does not
    reach it. `getaddrinfo` of a public name and `getpwuid` of a local user
    work as with glibc.
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
