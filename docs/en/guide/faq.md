# FAQ and troubleshooting

The things that surprise people, by symptom.

## Linking and running

### A `std::exception` from my shared library is not caught

On Linux and macOS, a standard exception thrown in one shared library and
caught in another is caught by `catch (...)`, not by
`catch (const std::exception&)`. Every shared object linked by xclang has
its own libc++, and so its own `type_info` for `std::exception`, which
libc++ compares by address there. Windows compares by name and catches it.
Link the code into one program, or keep C++ types and exceptions inside
each shared object behind a C interface
([one libc++ per shared object](../design/hermeticity.md#one-libc-per-shared-object)).

### Bazel tests crash at start-up with a double free

Bazel links `cc_library` dependencies of tests into shared objects by
default, each with its own libc++. xclang's module turns that off
(`supports_dynamic_linker`); if a target turned it back on, take it off
again, or make sure no C++ object crosses those shared objects
([Bazel](../integrations/bazel.md#what-the-toolchain-does)).

### Undefined references to `std::__cxx11::...` or `std::__1::...`

A C++ library built with GCC's libstdc++ (a distribution's Qt, Boost, ...)
or with MSVC's STL is being linked into a program built with xclang's
libc++: the two standard libraries are different ABIs. Build C++
dependencies with xclang for the same target (CMake, Bazel, vcpkg with
xclang's toolchain file chain-loaded). C libraries are not affected.

### "version `GLIBC_2.34' not found" on an older machine

A program from xclang links against glibc 2.17 and needs nothing newer,
unless something in the link was built against a newer glibc: a shared
library from the build machine (`-L/usr/lib/...`), or a build with
`--no-default-config`, which uses the machine's own glibc. Link only
libraries built with xclang for the target. `llvm-readobj --needed-libs`
and `llvm-objdump -T` show what a program asks for.

### `-static-pie` fails, or `-pg` does not link

glibc 2.17 has no `rcrt1.o`, so no `-static-pie`, and its `gcrt1.o` is not
position-independent, so `-pg` needs `-no-pie`
([compatibility](../reference/compatibility.md)).

### On Windows, `-o hello` wrote `hello.exe`

A MinGW link adds `.exe` to an output name without an extension. Name the
output with its extension when cross-compiling (`-o hello.exe`).

### Rust: undefined `_Unwind_*` symbols linking for Linux

Rust's standard library links with `-nodefaultlibs` and asks for
`-lgcc_s`, which is an empty archive in xclang's sysroots. Name libunwind:
`-Clink-arg=-l:libunwind.a` ([Rust and cargo](../integrations/cargo.md)).

### I want the system's headers and libstdc++, not xclang's

`--no-default-config` skips the target's config file and gives the bare
compiler, which uses the system's headers and libraries as upstream clang
does.

## Cross-compiling

### `'Windows.h' file not found` from Linux, but it builds on Windows

Windows file names ignore case; MinGW-w64's headers are lower case
(`windows.h`, `basetsd.h`). Include them in lower case, which works
everywhere ([Windows](../design/windows.md#case-sensitive-headers)).

### A macOS target fails on Linux or Windows

The macOS targets build against Xcode's SDK, so on macOS hosts only, today
([macOS](../design/macos.md)). Building for macOS from other hosts, with
the SDK fetched from Apple, is in research.

### Linking against the macOS 27 SDK fails: "malformed file", "arm64e.x1"

Xcode 27's SDK lists an architecture LLVM 23.1.2 does not know; 23.1.2.6
and later carry the fix ([patch 0009](../design/patches.md)).

### Test registrations disappear from Windows release builds

lld's `--gc-sections` drops static initializers of unreferenced COMDAT
sections for MinGW targets. The Bazel module leaves it off for Windows; in
another build, do not pass `-Wl,--gc-sections` for Windows targets
([Windows](../design/windows.md#gc-sections-and-static-initializers)).

## Sanitizers and debugging

### ASan reports a container-overflow that is not there

The program links the normal, uninstrumented `libc++.a`. Compile and link
with libc++'s ASan build: `-isystem <asan>/include` and
`-nostdlib++ <asan>/libc++.a`, for every library of the program; Bazel's
`--features=asan` does it ([sanitizers](../features/sanitizers.md)).

### gdb or lldb does not find the sources of a Bazel build

Paths in the debug information are relative to the execution root. Map `.`
to the workspace's `bazel-<workspace>` link
([Bazel](../integrations/bazel.md#debugging)).

### A macOS dSYM has no lines for code compiled with ThinLTO

A dSYM made after the link misses the LTO objects, which the linker has
deleted. Make it in the link: `xclang_debug_symbols` in CMake, the
`generate_dsym_file` feature in Bazel
([debugging](../features/debugging.md#why-a-dsym-comes-from-the-link)).

### A tool that reads `clang -###` fails

clang prints its compile job as `".../llvm" "clang" "-cc1" ...`, the
multi-call program with the tool's name first. Skip the name
([the toolchain's shape](../design/toolchain.md#one-program)).

## Build speed and caches

### Linking a tool on libclang takes minutes every time

libclang is ThinLTO bitcode, and its code is generated at the link. Turn on
the ThinLTO cache, `XCLANG_THINLTO_CACHE`
([the ThinLTO cache](../features/thinlto-cache.md)).

### The ThinLTO cache does nothing under Bazel on Linux

The sandbox lets a link write the directory only with
`--sandbox_writable_path=<dir>`, and a directory under `/tmp` is the
action's private `/tmp`, lost after the link. Use `/var/tmp/...` with
`--sandbox_writable_path` ([Bazel](../integrations/bazel.md#the-thinlto-cache)).

### ccache gives a wrong program after a module's interface changed

ccache 4.13 and older serve an importer's object from before the change;
4.14 recompiles it. Neither caches module interfaces
([C++20 modules](../features/modules.md#build-caches-and-modules)).

### `C++26 was disabled in precompiled file`, or another option mismatch with `import std`

The `std` module was built with other language options than the importer:
`-std`, exceptions, RTTI. Set them project-wide (CMake), in `--cxxopt`
(Bazel), or give the target a `std` of its own (`xclang_add_std`)
([CMake](../integrations/cmake.md#import-std)).

## Windows hosts

### Bazel fails with paths too long

Bazel's default output root is too deep; put `startup
--output_user_root=C:/b` in `%USERPROFILE%\.bazelrc`
([Bazel](../integrations/bazel.md#setup)).

### Killed builds left `llvm.exe` processes behind

Fixed in 23.1.2.4: the launchers create `llvm.exe` inside a kill-on-close
job ([Windows](../design/windows.md#the-launchers)).
