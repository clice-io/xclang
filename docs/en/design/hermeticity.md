# Hermeticity

xclang holds every target to one rule:

> A program depends at run time only on the system libraries every
> installation of its OS has and no one may redistribute. Everything else
> is linked into it. At build time, the only inputs from outside the
> toolchain are vendor SDKs.

## Summary

A program built by xclang is one file that runs on any machine of its
target: glibc 2.17 or later on Linux, Windows 10 or later, macOS 13 or
later. libc++ and the other runtimes are inside it. The price is size, and
one copy of libc++ in every shared library. Today the one vendor SDK is
Xcode's, for the macOS targets, and xclang does not pin it.

## What a Program Loads

| target | at run time, from the system | linked statically |
|---|---|---|
| Linux (glibc) | glibc 2.17 or later: `libc`, `libm`, `libpthread`, `libdl`, `librt`, the dynamic loader | libc++, libc++abi, libunwind, the builtins |
| macOS | libSystem (the C library and the unwinder), the system frameworks the program links | libc++, libc++abi, the builtins |
| Windows (MinGW) | the OS DLLs (`kernel32`, ...) and UCRT (`api-ms-win-crt-*`), part of Windows 10 and later | libc++, libc++abi, libunwind, the builtins, winpthreads, the mingw-w64 runtime |

No one can ship the libraries in the left column with a program. glibc's
dynamic loader and libc form one ABI with the kernel interface of the
machine. libSystem is the only supported way into the macOS kernel. UCRT
is a component of Windows.

Everything in the right column could be a shared library next to the
program, or a package the user installs. xclang makes it part of the
program instead.

The toolchain follows the rule too. clang and lld are linked statically
against xclang's own libc++ on every host, macOS included, and never use
the system's `libc++.dylib`.

## Why Not Shared Runtimes

Most toolchains link a shared libc++ or libstdc++. The user pays for that
later:

- **The program needs it at run time.** On Linux, `libc++.so.1` is not on
  a default installation. A program linked against it needs a package, an
  rpath and a copy beside it, or a container. On Windows, `libc++.dll`
  must be shipped next to every program.
- **Its version is the machine's.** A shared library from the system is
  the one the system has, not the one the program was built and tested
  with. On macOS, the system's `libc++.dylib` is the OS version of libc++,
  not the version of the headers the program was compiled with.
- **The build environment leaks into the program.** conda-forge's
  compilers, for example, link against the `libcxx` and `libstdcxx`
  packages and add them to a package's run-time dependencies through
  `run_exports`. That is right inside conda, where the environment
  provides them. Outside it, they are a dependency nobody installs.

That last point is why xclang is not a compiler for conda-forge packages.
It links its runtimes into every program and has no `run_exports`.

The price of static runtimes is size, since every program carries the
parts of libc++ it uses, and the rule in the next section. For programs
and tools that are copied to other machines, xclang takes that price.

## One libc++ per Shared Object

libc++, libc++abi and libunwind are built as static libraries with hidden
symbols (`LIBCXX_HERMETIC_STATIC_LIBRARY`,
`LIBCXXABI_HERMETIC_STATIC_LIBRARY`, `LIBUNWIND_HIDE_SYMBOLS`). They are
position-independent, so a shared library can carry them too. Every program
and every shared library linked by xclang has a private copy.

The consequences are the ones the Android NDK documents for its static
libc++: "you can only use a static variant of the C++ runtime if you have
one and only one shared library in your application"
([C++ library support](https://developer.android.com/ndk/guides/cpp-support)).

- **C++ objects should not cross shared objects.** A `std::string` made
  by one copy of libc++ and destroyed by another mixes the state of two
  runtimes. Memory that one shared library allocates should be freed by
  the same library.
- **Exceptions and RTTI across shared objects.** Each copy has its own
  `type_info` for `std::exception` and the other standard types. On Linux
  and macOS, libc++ compares type information by address. A standard
  exception thrown in one shared library is then caught in another only by
  `catch (...)`, not by `catch (const std::exception&)`. Windows compares
  by name, and catches it.
- **Globals are per copy**: the buffer of `std::cout`, the locale, the
  `new_handler`.

libc++ can compare type information by name everywhere. That costs a
string comparison on every mismatch, and treats same-named types in
anonymous namespaces as one, so xclang keeps the default.

A program whose libraries are linked into it has none of these problems,
and that is the default xclang is built for. A plugin interface across
shared objects should be a C interface, which is good practice with any
toolchain. The Bazel module links libraries statically for the same
reason ([static by default](bazel-module.md#static-by-default)).

## Why glibc 2.17

A program linked against a glibc runs on that version and every later
one, never an earlier one. glibc versions its symbols, and the linker
picks the newest version of each symbol that the build's glibc has. So
the glibc a Linux program is linked against is its floor. Building on a
current distribution gives a program that needs a current distribution.

xclang's Linux sysroots hold glibc 2.17's headers, startup files and
libraries, taken from conda-forge's `sysroot_linux-64` and
`sysroot_linux-aarch64` 2.17 packages. 2.17 is also the floor of conda-forge
and of Rust's official Linux targets
([Rust's dist builder](https://github.com/rust-lang/rust/blob/main/src/ci/docker/host-x86_64/dist-x86_64-linux/Dockerfile)
builds on CentOS 7 for it). A program from xclang runs on CentOS 7, Debian
8, Ubuntu 14.04 and anything later.

The floor has costs, listed in
[compatibility](../reference/compatibility.md#known-limitations): no
`-static-pie`, `-pg` only with `-no-pie`, no `quadmath.h`. glibc 2.17 also
lacks `__cxa_thread_atexit_impl`, which arrived in 2.18, so libc++abi is
built with its own fallback for `thread_local` destructors. A newer glibc,
for programs that need what 2.17 lacks, is
[considered](roadmap.md#glibc-newer) as a target of its own.

Two things about the sysroots took work:

- **`-static` links.** glibc 2.17's `libpthread.a` is one object that
  redefines `__libc_sigaction` and the cancellation points of `libc.a`.
  libunwind's dependency note pulls it in after `libc.a`, so every
  `-static` link failed with duplicate symbols. The sysroot's `libc.a` is
  a linker script, `GROUP(libpthread.a libglibc.a)`, so both come in
  together, in an order that links.
- **No symlinks.** A Linux sysroot is full of links (`lib -> lib64`,
  `libm.so -> libm.so.6`). Windows creates links only with extra rights,
  and conda packages for Windows cannot carry them. So soname links are
  the files themselves, and `libfoo.so` development links are linker
  scripts (`INPUT(libfoo.so.6)`), as glibc's own `libc.so` is. Eight
  netfilter headers that differ from another only by case (`xt_DSCP.h`
  next to `xt_dscp.h`) are left out, so a sysroot unpacks on a
  case-insensitive file system.

## GCC Library Names

Build scripts written for GCC name GCC's runtime libraries: `-latomic`
for wide atomics, `-lgcc_s` and `-lgcc_eh` for the unwinder, `-lgcc` for
the builtins, `-lssp` for the stack protector on MinGW. Rust's standard
library names `-lgcc_s` when its linker is a C compiler. Here those
functions are in compiler-rt, libunwind and mingw-w64. So each name is an
empty archive: the link finds the library it asked for, and the symbols
come from where they are.

- `-latomic`: the `__atomic_*` functions for atomics too wide to be
  lock-free (a struct, or `__int128` without cx16) are in the compiler-rt
  builtins, built with `COMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=OFF`.
- `-lssp`, `-lssp_nonshared`: the MinGW driver of clang adds them for
  `-fstack-protector`. The functions are in `libmingwex` of mingw-w64.
- `-lstdc++` needs no stub. The clang driver replaces it with the C++
  library it links, libc++, unless `-nostdlib`, `-nodefaultlibs` or
  `-nostdlib++` is given.
- `windres` is `llvm-windres`. It is the name CMake looks for to compile
  the `.rc` files of a MinGW project.

A C++ program, a CMake project or a Rust crate written for GCC links
unchanged. One limit: an empty `libgcc_s.a` gives Rust's standard library,
which links with `-nodefaultlibs`, no unwinder. Rust builds name libunwind
themselves ([Rust and Cargo](../integrations/cargo.md)).

## Not Yet Supported

| | status |
|---|---|
| [A pinned macOS SDK, fetched from Apple by the user](roadmap.md#macos-any-host) | In research |
| [musl targets](roadmap.md#musl), for fully static Linux programs | Planned |
| [MSVC targets](roadmap.md#msvc), with Microsoft's "hybrid CRT": the VC runtime and the STL static, UCRT dynamic | Unreleased |

Planned targets keep the same rule.

## Known Limitations

- **Sanitizer runtimes.** On macOS they are dylibs, which a program loads
  from the toolchain or from its own directory. An ASan build is for
  testing, not for shipping.
- **The macOS SDK.** Apple's SDK cannot be redistributed, so macOS targets
  build against Xcode's, found by `xcrun`. It is the one input from
  outside the toolchain, and xclang does not pin it.
