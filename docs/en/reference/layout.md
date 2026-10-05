# Layout

What an unpacked toolchain archive holds. Every host's archive holds every
target directory; the archives differ only in the programs of `bin/`.

```
xclang/
  bin/                     llvm and its names (clang, clang++, clang-cl,
                           clang-scan-deps, ld.lld, ld64.lld, lld-link,
                           llvm-ar, llvm-objcopy, windres, dsymutil,
                           llvm-gsymutil, ...), the tools outside it
                           (llvm-profdata, llvm-cov, llvm-dwarfdump,
                           llvm-strings, FileCheck), and <triple>.cfg for
                           every spelling of every target
  lib/clang/<major>/       clang's resource headers, compiler-rt's headers,
                           and compiler-rt for every target
  lib/cmake/xclang/        the CMake package (from 23.1.2.6 on)
  lib/libLTO.dylib         macOS hosts: LTO for the system's ld (-fuse-ld=ld)
  <triple>/                one directory per target (below)
```

## A target's directory

| | Linux | Windows (MinGW) | macOS |
|---|---|---|---|
| C library | glibc 2.17's headers in `usr/include`, its startup files and libraries in `lib64`, `usr/lib64` | mingw-w64 (UCRT) and winpthreads in `include`, `lib` | none: Xcode's SDK |
| libc++, libc++abi, libunwind | `usr/include/c++/v1`, `usr/lib` | `include/c++/v1`, `lib` | `include/c++/v1`, `lib` (no libunwind: the system's, in libSystem) |
| libc++'s module sources | `usr/share/libc++/v1` | `share/libc++/v1` | `share/libc++/v1` |
| libc++'s module manifest | `usr/lib/libc++.modules.json` | `lib/libc++.modules.json` | `lib/libc++.modules.json` |
| libc++'s ASan build | `usr/lib/asan` | none | `lib/asan` |
| GCC's library names | empty `libatomic.a`, `libgcc.a`, `libgcc_eh.a`, `libgcc_s.a` | the same, and `libssp.a`, `libssp_nonshared.a` | none |

`clang++ --target=<triple> -print-library-module-manifest-path` prints the
manifest's path. Why the GCC names are empty archives, and why `-lstdc++`
needs none, is in [hermeticity](../design/hermeticity.md#gcc-library-names).

## Why it looks like this

- **One program.** clang, lld and most tools are one program, `llvm`
  (LLVM's `LLVM_TOOL_LLVM_DRIVER_BUILD`), which the other names start;
  each tool would otherwise carry LLVM in full. See
  [the toolchain's shape](../design/toolchain.md).
- **No symlinks in Windows archives.** The names of `llvm.exe`
  (`clang++.exe`, `ld.lld.exe`, ...) are a small launcher,
  `windows/alias.c`, so the system's `tar` unpacks the archive without
  extra rights and conda can package it. See [Windows](../design/windows.md).
- **No symlinks in the Linux sysroots.** A shared library's soname link is
  the file itself, and its `libfoo.so` link is a linker script naming it, as
  glibc's own `libc.so` is.
- **Unpacks on case-insensitive file systems.** Eight netfilter headers
  named like another but for case (`xt_DSCP.h` next to `xt_dscp.h`) are
  left out of the Linux sysroots, so they unpack on Windows and macOS.
- **What compiling and linking read, nothing else.** The Linux sysroots hold
  headers, startup files and libraries, not glibc's programs, locales or
  gconv modules.

The sysroots and runtimes are plain directories laid out the way clang's
drivers expect, so any clang pointed at one with `--sysroot` and
`-resource-dir` uses it too.
