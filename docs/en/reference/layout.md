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
  share/licenses/          the license notices of everything in the archive
                           (below)
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

## Licenses

Every archive, the toolchain, libclang, the ASan libclang and the option
tables, has `share/licenses`:

```
share/licenses/
  README.md                each component: what of the archive it is, its
                           version, its license (an SPDX expression) and
                           where its source is
  sbom.spdx.json           the same as an SPDX 2.3 document
  <component>/             the component's license and notice files
```

The toolchain's components:

| directory | what | license |
|---|---|---|
| `xclang` | xclang's config files, CMake package and `xclang` command | Apache-2.0 |
| `llvm-project` | clang, lld, the LLVM tools, libc++, libc++abi, libunwind, compiler-rt; the files keep their paths in LLVM's source | Apache-2.0 WITH LLVM-exception, and the third-party parts' |
| `zlib`, `zstd` | linked into the programs (macOS hosts: zstd only) | Zlib; BSD-3-Clause OR GPL-2.0-only |
| `glibc` | the Linux targets' C library, 2.17 | LGPL-2.1-or-later |
| `linux` | the Linux targets' kernel UAPI headers | GPL-2.0-only WITH Linux-syscall-note |
| `nss` | the Linux targets' `libfreebl3.so`, which glibc's `libcrypt` loads | MPL-2.0 |
| `mingw-w64` | the Windows targets' headers, CRT and winpthreads, which the Windows hosts' programs link too | ZPL-2.1, and the runtime's other parts |
| `rust`, `rust-crates/<crate>-<version>` | Rust's standard library and the crates `bin/xclang` links | each its own |

glibc, the kernel headers and NSS are those of CentOS 7, as conda-forge's
sysroot packages repackage them: the README names those packages, CentOS's
source RPMs and the upstream releases. The libclang archives carry `xclang`,
`llvm-project`, `zlib` and `zstd` (and `mingw-w64` on Windows hosts), the
option tables `xclang` and `llvm-project`.

## Without Links

On Linux and macOS hosts, the tool names in `bin/` are symbolic links to
`llvm`. The Windows archives hold no symbolic links, so they unpack without
extra rights, and conda can package them; every tool name is a small
[launcher](../design/windows.md#the-launchers) instead. The Linux sysroots
hold no links either: soname links are the files themselves, and `libfoo.so`
links are linker scripts
([why glibc 2.17](../design/hermeticity.md#why-glibc-2-17)).
