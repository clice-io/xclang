# Hermeticity

xclang holds every target to one rule:

> A program depends at run time only on the system libraries every
> installation of its OS has and no one may redistribute. Everything else
> is linked into it. At build time, the only inputs from outside the
> toolchain are vendor SDKs, pinned.

This page says what the rule gives, what it costs, and the places where it
had to bend.

## What a program loads

| target | at run time, from the system | linked statically |
|---|---|---|
| Linux (glibc) | glibc 2.17 or later: `libc`, `libm`, `libpthread`, `libdl`, `librt`, the dynamic loader | libc++, libc++abi, libunwind, the builtins |
| macOS | libSystem (the C library and the unwinder), the system frameworks the program links | libc++, libc++abi, the builtins |
| Windows (MinGW) | the OS's DLLs (`kernel32`, ...), UCRT (`api-ms-win-crt-*`, part of Windows 10 and later) | libc++, libc++abi, libunwind, the builtins, winpthreads, mingw-w64's own runtime |

The system libraries in the left column are the ones no one can ship with
a program: glibc's dynamic loader and libc are one ABI with the kernel
interface of the machine, libSystem is the only supported way into the
macOS kernel, and UCRT is a component of Windows. Everything in the right
column could be a shared library the program carries or a package the
user installs; xclang makes it part of the program instead, so a program
is one file that runs where it is copied.

The toolchain follows the rule too: clang and lld are linked statically
against xclang's own libc++ on every host, macOS included. The system's
`libc++.dylib` is never used, and `tests/smoke.ts` checks on every host that
the toolchain's own programs load no C++ runtime and need glibc 2.17 at
most.

## Why not shared runtimes

A shared libc++ is what most toolchains do, and it has a cost the user pays
later:

- **The program needs it at run time.** On Linux, `libc++.so.1` is not on a
  default installation; a program linked against it needs a package, an
  rpath and a copy beside it, or a container. On Windows, `libc++.dll`
  must be shipped next to every program. On macOS, the system's
  `libc++.dylib` is the OS's version of libc++, not the headers' the
  program was compiled with.
- **Its version is the machine's.** A shared library loaded from the system
  is the one the system has, which is not the one the program was built and
  tested with.
- **The build's environment leaks into the program.** conda-forge's
  compilers, for example, link against `libcxx` and `libstdcxx` packages
  and add them to the package's run-time dependencies through
  `run_exports`: right inside conda, where the environment provides them,
  and a dependency outside it.

The price of static runtimes is size (every program carries the parts of
libc++ it uses) and the one-runtime-per-shared-object rule below. For
programs and tools that are copied to machines, xclang takes that price.

## One libc++ per shared object

libc++, libc++abi and libunwind are built as static libraries with hidden
symbols (`LIBCXX_HERMETIC_STATIC_LIBRARY`, `LIBCXXABI_HERMETIC_STATIC_LIBRARY`,
`LIBUNWIND_HIDE_SYMBOLS`), and position-independent, so a shared library can
carry them too. Every program and every shared library linked by xclang
has a private copy. That has consequences, and they are the same ones the
Android NDK documents for its static libc++ ("you can only use a static
variant of the C++ runtime if you have one and only one shared library in
your application",
[C++ library support](https://developer.android.com/ndk/guides/cpp-support)):

- **C++ objects should not cross shared objects.** A `std::string` made by
  one copy of libc++ and destroyed by another mixes the state of two
  runtimes; memory one shared library allocates should be freed by the
  same library.
- **Exceptions and RTTI across shared objects.** Each copy has its own
  `type_info` for `std::exception` and the rest. On Linux and macOS libc++
  compares type information by address, so a standard exception thrown in
  one shared library is caught in another only by `catch (...)`, not by
  `catch (const std::exception&)`. Windows compares it by name, and catches
  it. (libc++ can compare by name everywhere, at the cost of a string
  comparison on every mismatch and of treating same-named types in
  anonymous namespaces as one; xclang keeps the default.)
- **Globals are per copy**: `std::cout`'s buffer, the locale, the
  `new_handler`.

A program whose libraries are linked into it, the default xclang is built
for, has none of these problems. A plugin interface across shared objects
should be a C interface, which is good practice regardless of the
toolchain.

This is also why the Bazel module turns `supports_dynamic_linker` off. Bazel
links `cc_test` and `cc_library` dependencies dynamically by default, one
shared object per library, and kotatsu's tests built that way crashed at
start-up with a double free, every shared object with a libc++ of its
own. On Windows the default DLL of a `cc_library` did not link at all. Libraries now link statically into tests
and programs; `cc_binary(linkshared = True)` still makes a shared library,
and `features = ["supports_dynamic_linker"]` gives a target Bazel's dynamic
linking back ([Bazel](../integrations/bazel.md#what-the-toolchain-does)).

## Why glibc 2.17

A program linked against a glibc runs on that version and every later one,
never an earlier one: glibc versions its symbols, and the linker picks the
newest version of each symbol the build's glibc has. So the glibc a Linux
program is linked against is its floor, and building on a current
distribution gives a program that needs a current distribution.

xclang's Linux sysroots hold glibc 2.17's headers, startup files and
libraries, taken from conda-forge's `sysroot_linux-64` and
`sysroot_linux-aarch64` 2.17 packages. 2.17 is the floor conda-forge and
Rust's official Linux targets also use
([Rust's dist builder](https://github.com/rust-lang/rust/blob/main/src/ci/docker/host-x86_64/dist-x86_64-linux/Dockerfile)
builds on CentOS 7 for it), so a program from xclang runs on CentOS 7,
Debian 8, Ubuntu 14.04 and anything later.

The floor has costs, in [compatibility](../reference/compatibility.md):
no `-static-pie` (glibc 2.17 has no `rcrt1.o`), `-pg` needs `-no-pie`, no
`quadmath.h`. `__cxa_thread_atexit_impl` arrived in glibc 2.18, so libc++abi
is built with its own fallback for `thread_local` destructors. A newer
glibc for programs that need what 2.17 lacks is
[being considered](roadmap.md#targets) as a target of its own.

Two things about the sysroots took work:

- **`-static` links.** glibc 2.17's `libpthread.a` is one object that
  redefines `libc.a`'s `__libc_sigaction` and cancellation points, and
  libunwind's dependency note pulls it in after `libc.a`: every `-static`
  link failed with duplicate symbols. The sysroot's `libc.a` is a linker
  script, `GROUP(libpthread.a libglibc.a)`, so both come in together and
  in an order that links.
- **No symlinks.** A Linux sysroot is full of links (`lib -> lib64`,
  `libm.so -> libm.so.6`), which Windows creates only with extra rights and
  conda packages for Windows cannot carry. Soname links are the files
  themselves, and `libfoo.so` development links are linker scripts
  (`INPUT(libfoo.so.6)`), as glibc's own `libc.so` is. Eight netfilter
  headers that differ from another only by case are left out, so a
  sysroot unpacks on a case-insensitive file system.

## GCC library names

Build scripts written for GCC name GCC's runtime libraries: `-latomic` for
wide atomics, `-lgcc_s` and `-lgcc_eh` for the unwinder, `-lgcc` for the
builtins, `-lssp` for the stack protector on MinGW. Rust's standard library
names `-lgcc_s` when its linker is a C compiler. Their functions are in
compiler-rt, libunwind and mingw-w64 here, so each name is an empty
archive: the link finds the library it asked for, and the symbols come from
where they are.

- `-latomic`: the `__atomic_*` functions of atomics too wide to be
  lock-free (a struct, `__int128` without cx16) are in compiler-rt's
  builtins, built with `COMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=OFF`.
- `-lssp`, `-lssp_nonshared`: clang's MinGW driver adds them for
  `-fstack-protector`; the functions are in mingw-w64's `libmingwex`.
- `-lstdc++` needs no stub: clang's driver replaces it with the C++ library
  it links, libc++ (unless `-nostdlib`, `-nodefaultlibs` or `-nostdlib++`).
- `windres`, the name CMake looks for to compile a MinGW project's `.rc`
  files, is `llvm-windres`.

So a C++ program, a CMake project or a Rust crate written for GCC links
unchanged. One limit: an empty `libgcc_s.a` gives Rust's standard library
no unwinder, which links with `-nodefaultlibs`; Rust builds name libunwind
themselves ([Rust and cargo](../integrations/cargo.md)).

## The exceptions

- **Sanitizer runtimes.** On macOS they are dylibs, which a program loads
  from the toolchain or from its own directory; an ASan build is for
  testing, not for shipping.
- **macOS's SDK.** Apple's SDK cannot be redistributed, so macOS targets
  build against Xcode's, found by `xcrun`: the one input from outside the
  toolchain. Fetching it from Apple, by version and digest, is
  [in research](vendor-sdks.md).
- **The bar for the future targets** is the same: musl targets would be
  fully static; MSVC targets link the VC runtime and the STL statically
  and UCRT dynamically, Microsoft's "hybrid CRT"
  ([roadmap](roadmap.md#targets)).

## Checked by

- tests/smoke.ts, on every host: the toolchain's own programs load no C++
  runtime and need glibc 2.17 at most; programs build for every target and
  run where the machine can run them; `-static`, `-latomic`, the GCC names
  and `windres` work.
- [examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml),
  on every host: `llvm-readobj --needed-libs` of the quick start's programs
  for every target, the libraries listed above and nothing else.
