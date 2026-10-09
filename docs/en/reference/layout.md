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
                           llvm-strings, FileCheck), the xclang command,
                           and <target>.cfg for every spelling of every
                           target; <target>-sdk.cfg, the SDK in use of an
                           MSVC target, which the xclang command writes
  lib/clang/<major>/       clang's resource headers, compiler-rt's headers,
                           and compiler-rt for every target; for the MSVC
                           targets libc++ too
  lib/cmake/xclang/        the CMake package
  libc++/include/c++/v1/   libc++'s headers, the same for every target
  libc++/include/<target>/c++/v1/
                           each target's own __config_site, <target> as
                           clang spells it (x86_64-w64-windows-gnu)
  libc++/src/              the runtimes' sources, the same for every target,
                           in llvm-project's layout, patched (below); in the
                           releases after 23.1.2.10
  mingw-w64/include/       mingw-w64's headers, the same for both Windows
                           targets
  share/licenses/          the license notices of everything in the archive
                           (below)
  <target>/                the sysroot of each target (below)
  sdk/                     not in the archive: the vendor SDKs that the
                           xclang command fetches, and sdk/windows,
                           sdk/macos, those in use
```

The MSVC targets have no sysroot: their C library is the fetched SDK's.
Their compiler-rt and libc++ are in `lib/clang/<major>/lib/windows`, the
directory lld-link searches by itself: `libc++-<arch>.lib`,
`libc++experimental-<arch>.lib` and, for x64, `libc++asan-x86_64.lib`,
which the target's `__config_site` names in every object that includes
libc++ ([Windows](../design/windows.md#libc-and-the-stl)). Their
`<target>/` holds libc++'s module sources (`share/libc++/v1`), its module
manifest (`lib/libc++.modules.json`), which
`-print-library-module-manifest-path` does not report for them, and the
ASan build's `__config_site` (`lib/asan/include`).

## Sysroots

| | Linux | Linux (musl) | Windows (MinGW) | macOS |
|---|---|---|---|---|
| C library | glibc 2.17's headers in `usr/include`, its startup files and libraries in `lib64`, `usr/lib64` | musl 1.2.6's headers in `usr/include`, its startup files and `libc.a` in `usr/lib`, and its empty `libm.a`, `libpthread.a`, ... | mingw-w64 (UCRT) and winpthreads: the libraries in `lib`, the headers in the shared `mingw-w64/include` | none: Apple's SDK, Xcode's, or on Linux and Windows hosts `sdk/macos` ([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)) |
| kernel headers | Linux 3.10's (x64), 4.18's (arm64), in `usr/include` | Linux 6.18's, in `usr/include` | | |
| libc++, libc++abi, libunwind | `usr/lib`; the headers in the shared `libc++/include/c++/v1` | `usr/lib`; the same | `lib`; the same | `lib` (no libunwind: the system's, in libSystem); the same |
| libc++ module sources | `usr/share/libc++/v1` | `usr/share/libc++/v1` | `share/libc++/v1` | `share/libc++/v1` |
| libc++ module manifest | `usr/lib/libc++.modules.json` | `usr/lib/libc++.modules.json` | `lib/libc++.modules.json` | `lib/libc++.modules.json` |
| ASan libc++ | `usr/lib/asan` | none | none | `lib/asan` |
| GCC library names | empty `libatomic.a`, `libgcc.a`, `libgcc_eh.a`, `libgcc_s.a` | the same | the same, and `libssp.a`, `libssp_nonshared.a` | none |

The musl targets' directories are in every archive from 23.1.2.10 on.

`clang++ --target=<target> -print-library-module-manifest-path` prints the
path of the manifest.

## Shared Headers

The headers that are the same for several targets are in the archive
once, without links. libc++'s headers differ between the targets only in
`__config_site`, which is each target's own: `libc++/include` is LLVM's
per-target runtime layout, `c++/v1` for all and `<target>/c++/v1` for each.
mingw-w64's headers are the same for x64 and arm64, in `mingw-w64/include`.
The config files name the directories: `-stdlib++-isystem` the target's
`__config_site`, then the shared libc++ headers; for the Windows targets
`-idirafter mingw-w64/include`, which comes after clang's own headers, as
the sysroot's `include` would. A build with `--no-default-config` that sets
its own `--sysroot` names them too.

They are not in an `include/` at the top: clang's drivers look for libc++
in `<toolchain>/include/c++/v1` by themselves, the macOS one before the
SDK's, so `--no-default-config` would find xclang's headers without a
`__config_site` there instead of the system's. Before 23.1.2.7 each target
directory had its own copies, 155 MB of the 800 MB unpacked.

## The Runtimes' Sources

`libc++/src` holds what the runtimes of every target are built from, once:
llvm-project's `runtimes/`, `cmake/`, `llvm/cmake/`, `libcxx/`,
`libcxxabi/`, `libunwind/` and `compiler-rt/`, without tests and
documentation, and the headers of LLVM's libc that libc++ includes, with
xclang's patches of them applied. The CMake package and the Bazel module
build the runtimes from them ([runtimes from source](../features/runtimes-from-source.md)),
LLVM's `runtimes/` as from a checkout. They are 35 MB unpacked, in the
releases after 23.1.2.10.

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
| `musl` | the musl targets' C library, 1.2.6, from 23.1.2.10 on | MIT, and the parts its `COPYRIGHT` names: BSD-2-Clause, BSD-3-Clause, ISC, SunPro |
| `linux` | the Linux targets' kernel UAPI headers, glibc's and musl's | GPL-2.0-only WITH Linux-syscall-note |
| `nss` | the Linux targets' `libfreebl3.so`, which glibc's `libcrypt` loads | MPL-2.0 |
| `mingw-w64` | the Windows targets' headers, CRT and winpthreads, which the Windows hosts' programs link too | ZPL-2.1, and the runtime's other parts |
| `rust`, `rust-crates/<crate>-<version>` | Rust's standard library and the crates `bin/xclang` links | each its own |

glibc, the glibc targets' kernel headers and NSS are those of CentOS 7, as
conda-forge's sysroot packages repackage them: the README names those
packages, CentOS's source RPMs and the upstream releases. musl and the
musl targets' kernel headers are built from musl's release and kernel.org's. The libclang archives carry `xclang`,
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
