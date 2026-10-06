# Archive Layout

What an unpacked toolchain archive holds: the toolchain directory, `$XCLANG`
in these docs. Every host archive holds every sysroot; the archives differ
only in the programs of `bin/`. Why it is laid out this way is in
[toolchain structure](../design/toolchain.md).

```
xclang/
  bin/                     llvm and its names (clang, clang++, clang-cl,
                           clang-scan-deps, ld.lld, ld64.lld, lld-link,
                           llvm-ar, llvm-objcopy, windres, dsymutil,
                           llvm-gsymutil, ...), the tools outside it
                           (llvm-profdata, llvm-cov, llvm-dwarfdump,
                           llvm-strings, FileCheck), and <target>.cfg for
                           every spelling of every target
  lib/clang/<major>/       clang's resource headers, compiler-rt's headers,
                           and compiler-rt for every target
  lib/cmake/xclang/        the CMake package
  lib/libLTO.dylib         macOS hosts: LTO for the system's ld (-fuse-ld=ld)
  <target>/                the sysroot of each target (below)
  sdk/                     not in the archive: the vendor SDKs that the
                           unreleased xclang command fetches, and
                           sdk/windows, sdk/macos, those in use
```

The [unreleased](../design/roadmap.md#msvc) MSVC targets have no
sysroot: their compiler-rt is `lib/clang/<major>/lib/windows`, their C and
C++ libraries are the fetched SDK's.

## Sysroots

| | Linux | Windows (MinGW) | macOS |
|---|---|---|---|
| C library | glibc 2.17's headers in `usr/include`, its startup files and libraries in `lib64`, `usr/lib64` | mingw-w64 (UCRT) and winpthreads in `include`, `lib` | none: Apple's SDK, Xcode's, or on Linux and Windows hosts `sdk/macos` ([unreleased](../design/roadmap.md#macos-any-host)) |
| libc++, libc++abi, libunwind | `usr/include/c++/v1`, `usr/lib` | `include/c++/v1`, `lib` | `include/c++/v1`, `lib` (no libunwind: the system's, in libSystem) |
| libc++ module sources | `usr/share/libc++/v1` | `share/libc++/v1` | `share/libc++/v1` |
| libc++ module manifest | `usr/lib/libc++.modules.json` | `lib/libc++.modules.json` | `lib/libc++.modules.json` |
| ASan libc++ | `usr/lib/asan` | none | `lib/asan` |
| GCC library names | empty `libatomic.a`, `libgcc.a`, `libgcc_eh.a`, `libgcc_s.a` | the same, and `libssp.a`, `libssp_nonshared.a` | none |

`clang++ --target=<target> -print-library-module-manifest-path` prints the
path of the manifest. Why the GCC names are empty archives is in
[hermeticity](../design/hermeticity.md#gcc-library-names).

## Without Links

On Linux and macOS hosts, the tool names in `bin/` are symbolic links to
`llvm`. The Windows archives hold no symbolic links, so they unpack without
extra rights, and conda can package them; every tool name is a small
[launcher](../design/windows.md#the-launchers) instead. The Linux sysroots
hold no links either: soname links are the files themselves, and `libfoo.so`
links are linker scripts
([why glibc 2.17](../design/hermeticity.md#why-glibc-2-17)).
