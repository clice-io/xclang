# Hosts, targets and layout

## Hosts and targets

| host | built on |
|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Linux x64 (arm64 cross-compiled) |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | macOS arm64 (x64 cross-compiled) |
| `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | Linux x64, cross-compiled; the Windows toolchain is a mingw program |

Every host toolchain carries every target directory:

| target | C runtime in the sysroot | C++ runtime |
|---|---|---|
| Linux x64, arm64 | glibc 2.17 headers and startup files | libc++, libc++abi, libunwind |
| Windows x64, arm64 | mingw-w64 (UCRT), winpthreads | libc++, libc++abi, libunwind |
| macOS arm64, x64 | none: Apple's SDK cannot be redistributed, the one from Xcode is used | libc++, libc++abi, linked statically instead of the system's |

Programs built for Linux run on glibc 2.17 and later, those built for macOS
on 13.0 and later; the toolchain itself has the same floors.

## Hermeticity

A program depends at run time only on the system libraries every
installation of its OS has and no one may redistribute; everything else is
linked statically. At build time the only inputs from outside are vendor
SDKs, pinned (today Xcode's, for the macOS targets).

| target | at run time, from the system | linked statically |
|---|---|---|
| Linux (glibc) | glibc 2.17 or later: `libc`, `libm`, `libpthread`, `libdl`, `librt`, the dynamic loader | libc++, libc++abi, libunwind, the builtins |
| macOS | libSystem (the C library and the unwinder), the system frameworks the program links | libc++, libc++abi, the builtins |
| Windows (MinGW) | the OS's DLLs (`kernel32`, ...), UCRT (`api-ms-win-crt-*`, part of Windows 10 and later) | libc++, libc++abi, libunwind, the builtins, winpthreads, mingw-w64's own runtime |

Sanitizer runtimes are the exception: macOS's are dylibs, which a program
loads from the toolchain or from its own directory.

The toolchain follows the rule too: clang and lld are linked statically
against xclang's own libc++ on every host, macOS included: the system's
libc++.dylib is never used.

## Layout

```
xclang/
  bin/                     llvm and its names (clang, clang++, ld.lld, lld-link,
                           llvm-ar, windres, ...), the tools outside it
                           (llvm-profdata, llvm-cov, llvm-dwarfdump,
                           llvm-strings, FileCheck), <triple>.cfg
  lib/clang/<ver>/         resource headers, compiler-rt for every target
  lib/cmake/xclang/        the CMake package (from 23.1.2.6 on)
  lib/libLTO.dylib         macOS hosts: LTO for the system's ld (-fuse-ld=ld)
  <triple>/                one directory per target: its sysroot with libc++
                           in it (Linux: usr/include, usr/lib, and glibc in
                           lib64 and usr/lib64; Windows and macOS: include/,
                           lib/), libc++'s module sources in share/libc++/v1
                           (usr/share on Linux), and libc++'s ASan build in
                           lib/asan (Linux and macOS)
```

clang, lld and most tools are one program, `llvm`, which the other names
start; they would otherwise each carry LLVM in full.

The Linux sysroots hold what compiling and linking read (headers, startup
files, libraries), not glibc's programs, locales or gconv modules, and no
symlinks: their soname links are the files themselves, their `libfoo.so`
links are linker scripts naming them, as glibc's own `libc.so` is. Eight
netfilter headers named like another but for case (`xt_DSCP.h` next to
`xt_dscp.h`) are left out, so the sysroots unpack on Windows and macOS.

Every archive is a `.tar.xz`, and a Windows one holds no symlinks at all,
so it unpacks without extra rights and packs into conda: the names of
`llvm.exe` (`clang++.exe`, `ld.lld.exe`, ...) are a small program
(`windows/alias.c`) that starts `llvm.exe <name> <arguments>`. The name
goes in as a subcommand because LLVM on Windows replaces the file name in
`argv[0]` with its own before reading it.

## Limits

- Linux: glibc 2.17 has no `rcrt1.o`, so no `-static-pie`, and its
  `gcrt1.o` is not position-independent, so `-pg` needs `-no-pie`.
  `libquadmath` is GCC's own: `__float128` arithmetic works, `quadmath.h`
  does not exist.
- No OpenMP runtime (`-fopenmp`), no sanitizers for Windows targets, no
  MemorySanitizer.
- libc++ is linked into every program and shared library on its own and
  hidden, so on Linux and macOS a standard exception thrown by one shared
  library is caught by type in another only as `catch (...)`: each has its
  own `std::exception` type information. Windows compares it by name.
- No clang-format, clang-tidy or clangd binaries.
