# Hermeticity

xclang holds every target to one rule:

> A program depends at run time only on the system libraries every
> installation of its OS has and no one may redistribute. Everything else
> is linked into it. At build time, the only inputs from outside the
> toolchain are vendor SDKs.

Every bundled target and every target on the [roadmap](roadmap.md#targets)
follows this rule. A compiled binary is a single file that runs on any
machine of its target OS floor without installing a C++ runtime package or
shipping runtime DLLs alongside it.

At build time, the only inputs from outside the toolchain are vendor SDKs
that no one may redistribute ([vendor SDKs](../guide/cross-compiling.md#vendor-sdks)):

- **macOS targets**: on macOS hosts, `clang` builds against Xcode's or the
  Command Line Tools' SDK (`xcrun`), which xclang does not pin. On Linux and
  Windows hosts, `xclang sdk fetch macos` downloads Apple's SDK pinned by
  version, `sha256` and content digest
  ([macOS](macos.md#apple-s-sdk-without-xcode)).
- **Windows MSVC targets**: `xclang sdk fetch windows` downloads Microsoft's
  CRT, STL and Windows SDK pinned by version and `sha256`
  ([Windows](windows.md#the-sdk-without-visual-studio)). On a Windows host
  with no SDK fetched, `clang` falls back to an installed Visual Studio,
  which xclang does not pin.

## What a Program Loads

| target | loaded at run time from the system | linked statically |
|---|---|---|
| Linux (glibc) | glibc 2.17 or later: `libc`, `libm`, `libpthread`, `libdl`, `librt`, the dynamic loader | `libc++`, `libc++abi`, `libunwind`, `compiler-rt` builtins |
| Linux (musl) | nothing: Linux kernel system calls only | `musl`, `libc++`, `libc++abi`, `libunwind`, `compiler-rt` builtins |
| macOS | `libSystem` (the C library and unwinder) and the system frameworks the program links | `libc++`, `libc++abi`, `compiler-rt` builtins |
| Windows (MinGW) | Windows OS DLLs (`kernel32.dll`, ...) and UCRT (`api-ms-win-crt-*`), part of Windows 10 and later | `libc++`, `libc++abi`, `libunwind`, `compiler-rt` builtins, `winpthreads`, the `mingw-w64` runtime |
| Windows (MSVC) | Windows OS DLLs and UCRT (`ucrtbase.dll`), as for MinGW | `libc++` (or Microsoft's STL), Microsoft's VC runtime ([the hybrid CRT](windows.md#the-hybrid-crt)), `compiler-rt` builtins |

The libraries in the middle column cannot be linked into or redistributed
with a program: glibc's dynamic loader and `libc` form one ABI with the host
system, `libSystem` is the only supported interface to the macOS kernel, and
UCRT and the system DLLs are OS components of Windows 10 and later.
Everything in the right column can be linked into the binary, and xclang
links it statically by default.

The toolchain binaries follow the same rule. `clang`, `lld`, the LLVM binary
tools and `xclang` are linked statically against xclang's own `libc++` on
every host, macOS included, and never load `/usr/lib/libc++.1.dylib`.

The one test-only exception is dynamic sanitizer runtimes
([sanitizers](../features/sanitizers.md)). On macOS, the sanitizer runtimes
are `.dylib` files loaded from the toolchain or the binary's directory
([the sanitizers' dylibs](macos.md#the-sanitizers-dylibs)). On `x86_64`
Windows (MinGW and MSVC), the AddressSanitizer runtime is a DLL loaded from
the binary's directory or `PATH` ([ASan's DLL](windows.md#asan-s-dll)).
Sanitizer builds are for testing, not shipping.

## Why Not Shared Runtimes

Most toolchains link a shared `libc++` or `libstdc++` by default, which
shifts three costs onto deployment:

- **The program needs the runtime installed on the target machine.** On
  Linux, `libc++.so.1` is not part of a default OS installation, so a
  binary linked against it needs a system package, a bundled copy via
  `DT_RUNPATH`, or a container. On Windows, `libc++.dll`, `libunwind.dll`
  and `libwinpthread-1.dll` (or `vcruntime140.dll` and `msvcp140.dll`) must
  be shipped beside every executable.
- **The runtime version is the target machine's, not the build's.** A shared
  library loaded from the OS is whatever version that machine happens to
  have, not the version the program was compiled and tested with. On macOS,
  linking `/usr/lib/libc++.1.dylib` ties C++ library features to the target
  macOS version rather than the toolchain release
  ([macOS](macos.md#why-xclang-s-libc-and-not-the-system-s)).
- **The build environment leaks into the binary.** conda-forge's compilers
  link against the `libcxx` and `libstdcxx` conda packages and record them in
  a package's runtime dependencies through `run_exports`. Inside a conda
  environment that provides those packages, that works; outside conda, the
  resulting binaries depend on shared libraries that user machines do not
  have. Because xclang links its runtimes statically into every binary and
  has no `run_exports`, it is not a compiler for building conda-forge
  packages ([roadmap](roadmap.md#conda-forge)).

The price of static runtimes is binary size, since each executable carries
the parts of `libc++` it uses, and one private copy of `libc++` in each
shared object.

## One libc++ per Shared Object

`libc++`, `libc++abi` and `libunwind` are built as position-independent
static archives (`CMAKE_POSITION_INDEPENDENT_CODE=ON`) with hidden symbol
visibility (`LIBCXX_HERMETIC_STATIC_LIBRARY=ON`,
`LIBCXXABI_HERMETIC_STATIC_LIBRARY=ON`, `LIBUNWIND_HIDE_SYMBOLS=ON`). Every
executable and every shared library (`-shared`) linked by xclang carries its
own private copy of `libc++`, with no symbols exported to other shared
objects ([shared runtime on the roadmap](roadmap.md#shared-runtime)).

When an application loads more than one shared object linked this way, it
faces the same constraints the
[Android NDK documents](https://developer.android.com/ndk/guides/cpp-support)
for its static `libc++`:

- **C++ objects and allocations must not cross shared-object boundaries.** A
  `std::string` or `std::vector` constructed in one shared object and
  destroyed or resized in another mixes the state of two runtime copies.
  Memory allocated in one shared object must be freed in the same shared
  object.
- **Exceptions and RTTI across shared objects.** Each copy has its own
  `std::type_info` instances for `std::exception` and the other standard
  types. On Linux and macOS, `libc++` compares `type_info` by address, so a
  standard exception thrown in one shared object is caught in another only by
  `catch (...)`, not by `catch (const std::exception&)`. Comparing
  `type_info` by name everywhere would cost a string comparison on every
  mismatch and merge same-named types in anonymous namespaces, so xclang
  keeps upstream `libc++`'s default. On Windows, `type_info` is compared by
  name and catches across DLLs when both sides share one ABI.
- **Process-wide `libc++` globals are per shared object**: the buffer of
  `std::cout`, `std::locale::global`, `std::set_new_handler` and
  `std::set_terminate`.

A program that links its C++ libraries statically into one executable has
none of these problems, which is why the
[Bazel module links libraries statically by default](bazel-module.md#static-by-default).
Across shared-object or plugin boundaries, expose a C interface.

## Why glibc 2.17

glibc versions its symbols, and the linker binds each symbol to the newest
version present in the build sysroot's `libc.so.6`. A Linux binary therefore
runs on the glibc version it was linked against and any later version, never
an earlier one.

xclang's Linux sysroots carry the headers, startup objects and stub libraries
of glibc 2.17 (taken from CentOS 7 via conda-forge's `sysroot_linux-64` and
`sysroot_linux-aarch64` 2.17 packages), the same floor used by conda-forge
and
[Rust's official Linux targets](https://github.com/rust-lang/rust/blob/main/src/ci/docker/host-x86_64/dist-x86_64-linux/Dockerfile).
What glibc 2.17 lacks (`-static-pie`, `-pg` with PIE, and `quadmath.h`) is
covered in
[cross-compiling](../guide/cross-compiling.md#glibc-2-17-floor-static-pie-and-pg),
and a newer glibc target is [considered](roadmap.md#glibc-newer). Because
glibc 2.17 predates `__cxa_thread_atexit_impl` (added in glibc 2.18),
`libc++abi` is built with `LIBCXXABI_HAS_CXA_THREAD_ATEXIT_IMPL=OFF` so it
references the symbol weakly and falls back to its own `thread_local`
destructor list on glibc 2.17.

Two adjustments in `toolchain/sysroot.ts` make the glibc 2.17 sysroots work
across hosts and link modes:

- **`-static` links.** glibc 2.17's `libpthread.a` is a single object file
  that redefines `__libc_sigaction` and cancellation points from `libc.a`.
  Because `libunwind`'s dependent-library note pulls in `libpthread.a` after
  `libc.a`, `-static` links failed with duplicate symbol errors. The sysroot
  renames `libc.a` to `libglibc.a` and replaces `libc.a` with a linker
  script, `GROUP ( /usr/lib64/libpthread.a /usr/lib64/libglibc.a )`, so both
  archives are searched together in an order that links cleanly.
- **No symbolic links or case collisions.** Creating symbolic links on
  Windows requires elevated privileges or Developer Mode, and conda packages
  for Windows cannot carry them. In the Linux sysroots, directory links
  (`lib -> lib64`) are resolved in linker scripts and removed, soname links
  (`libc.so.6 -> libc-2.17.so`) are replaced by the files themselves, and
  `.so` development links (`libm.so`) become `INPUT ( ... )` linker scripts
  like glibc's own `libc.so`. Netfilter headers whose filenames differ only
  in case (`xt_DSCP.h` beside `xt_dscp.h`) keep only the lowercase file so
  every archive unpacks on case-insensitive file systems.

## GCC Library Names

Build scripts written for GCC name GCC's runtime libraries on the link line:
`-latomic` for wide atomics, `-lgcc_s` and `-lgcc_eh` for the unwinder,
`-lgcc` for compiler builtins, and `-lssp` for the stack protector on MinGW.
In xclang, those functions live in `compiler-rt`, `libunwind` and
`mingw-w64`. The Linux, musl and MinGW sysroots therefore provide empty
archive stubs (`!<arch>\n`) under those names so GCC link lines succeed
without changes:

- **`-latomic`**: the `__atomic_*` functions for atomics too wide to be
  lock-free (structs, or `__int128` without `cx16`) are built into the
  `compiler-rt` builtins (`COMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=OFF`).
- **`-lgcc`, `-lgcc_s`, `-lgcc_eh`**: compiler helpers and unwinding come
  from `compiler-rt` and `libunwind`. Because `libgcc_s.a` and `libgcc_eh.a`
  are empty archives, linking with `-nodefaultlibs` (as `rustc` does on
  `*-unknown-linux-gnu`) gets no unwinder unless `-l:libunwind.a` is passed;
  `xclang cargo` handles this automatically
  ([Rust and Cargo](../integrations/cargo.md#what-xclang-cargo-sets), and
  making `libgcc_s.a` a linker script is
  [considered](roadmap.md#libgcc-s-script)).
- **`-lssp`, `-lssp_nonshared`**: `clang`'s MinGW driver adds these for
  `-fstack-protector`; the functions are provided by `libmingwex.a` in
  `mingw-w64`.
- **`-lstdc++`**: needs no stub archive because the `clang` driver replaces
  `-lstdc++` with `-lc++` unless `-nostdlib`, `-nodefaultlibs` or
  `-nostdlib++` is passed.
- **`windres`**: linked to `llvm-windres` in `bin/`, the tool name CMake's
  MinGW platform module looks for when compiling `.rc` files.

## Static Programs with musl

Unlike glibc, musl is built to be linked statically. The
`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` targets link
musl 1.2.6 (compiled with `--disable-shared` and asynchronous unwind tables),
`libc++`, `libc++abi`, `libunwind` and `compiler-rt` into a static executable
with no program interpreter (`PT_INTERP`) and no dynamic section, removing
even the C library from the runtime dependencies.

The trade-offs of static musl binaries:

- **Binary size**: musl adds 51 KB unstripped (27 KB stripped) to a C++
  `iostream` hello-world program on Linux x64 (1.17 MB vs 1.12 MB unstripped,
  826 KB vs 799 KB stripped).
- **No shared libraries or dynamic sanitizers**: the bundled sysroot has no
  `libc.so`, so `dlopen` and `-shared` libraries are not supported and UBSan
  is the only available sanitizer
  ([sanitizers](../features/sanitizers.md#musl-targets)).
- **Runtime behavior differences from glibc**: allocator lock contention
  under threads, `C`-only locale formatting, and direct DNS queries without
  NSS are covered in
  [cross-compiling](../guide/cross-compiling.md#musl-targets).

## The Platform's C++ Library

A program that passes C++ standard library types across an interface to a
library built with the platform's C++ library (a Linux distribution's
`libstdc++` packages, a macOS library using `/usr/lib/libc++.1.dylib`, or a
Windows library compiled with MSVC's STL) must use that same C++ library and
ABI. Passing `-stdlib=platform` deliberately leaves the hermeticity rule by
switching to `bin/<triple>-system.cfg`
([toolchain structure](toolchain.md#the-platform-s-c-library)); how to use it
and what the resulting binary loads at run time on each target are covered in
[cross-compiling](../guide/cross-compiling.md#the-platform-s-c-library).
