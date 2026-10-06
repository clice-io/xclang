# FAQ and Troubleshooting

The things that surprise people, by symptom. Each answer gives the fix
first, then the reason.

## Linking and Running

### A `std::exception` from my shared library is not caught

Link the code into one program, or keep C++ types and exceptions inside each
shared object, behind a C interface. On Linux and macOS, a standard
exception thrown in one shared library is caught in another only by
`catch (...)`. Every shared object linked by xclang has its own libc++, and
so its own `type_info` for `std::exception`, which libc++ compares by
address there. Windows compares by name, and catches it
([one libc++ per shared object](../design/hermeticity.md#one-libc-per-shared-object)).

### Bazel tests crash at start-up with a double free

Take `supports_dynamic_linker` off the Bazel target that turned it on, or
make sure no C++ object crosses those shared objects. With that feature,
Bazel links the libraries of a test into shared objects. Each has its own
libc++. xclang's module turns it off by default
([static by default](../design/bazel-module.md#static-by-default)).

### Undefined references to `std::__cxx11::...` or `std::__1::...`

Build the C++ dependencies with xclang, for the same target: with CMake,
Bazel, or vcpkg with xclang's toolchain file chain-loaded. A C++ library
built with GCC's libstdc++ (a distribution's Qt or Boost) or with MSVC's
STL has another ABI than xclang's libc++. C libraries are not affected.

### "version `GLIBC_2.34' not found" on an older machine

Link only libraries built with xclang for the target. A program from xclang
needs glibc 2.17 at most, unless something in the link was built against a
newer glibc. That is a shared library from the host (`-L/usr/lib/...`), or
a build with `--no-default-config`, which uses the glibc of the machine.
`llvm-readobj --needed-libs` and `llvm-objdump -T` show what a program asks
for.

### `-static-pie` fails, or `-pg` does not link

Use `-static`, and `-pg` with `-no-pie`. glibc 2.17 has no `rcrt1.o`, so no
`-static-pie`, and its `gcrt1.o` is not position-independent
([compatibility](../reference/compatibility.md#known-limitations)).

### On Windows, `-o hello` wrote `hello.exe`

Name the output with its extension, such as `-o hello.exe`, when
cross-compiling. A MinGW link adds `.exe` to an output name without one.

### Rust: undefined `_Unwind_*` symbols linking for Linux

Name libunwind: `-Clink-arg=-l:libunwind.a`. The standard library of Rust
links with `-nodefaultlibs` and asks for `-lgcc_s`, which is an empty
archive in xclang's sysroots
([Rust and Cargo](../integrations/cargo.md#settings-per-target)).

### I want the system's headers and libstdc++, not xclang's

Pass `--no-default-config`. It skips the config file of the target. The bare
compiler uses the system's headers and libraries, as upstream clang does
([config files](../design/toolchain.md#the-bare-compiler)).

## Cross-Compiling

### `'Windows.h' file not found` from Linux, but it builds on Windows

Include Windows headers in lower case, which works everywhere. Windows file
names ignore case, and the headers of MinGW-w64 are lower case (`windows.h`,
`basetsd.h`) ([Windows](../design/windows.md#case-sensitive-headers)).

### A macOS target fails on Linux or Windows

On Linux and Windows hosts, the macOS targets build against Apple's SDK,
which the `xclang` command fetches from Apple. `no such sysroot directory:
'.../sdk/macos'` means the SDK is not fetched yet:
`xclang sdk fetch macos --accept-license`
([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)). Releases
before 23.1.2.7 build macOS targets on macOS hosts only, with Xcode's SDK
([macOS](../design/macos.md#the-sdk-is-xcode-s)).

### Linking against the macOS 27 SDK fails: "malformed file", "arm64e.x1"

Use 23.1.2.6 or later. The SDK of Xcode 27 lists an architecture that LLVM
23.1.2 does not know, and later releases carry the fix
([patch 0009](../reference/patches.md)).

### Test registrations disappear from Windows release builds

Do not pass `-Wl,--gc-sections` for Windows targets. For MinGW targets, lld
drops the static initializers of unreferenced COMDAT sections. The Bazel
module leaves it off for Windows
([Windows](../design/windows.md#gc-sections-and-static-initializers)).

## Sanitizers and Debugging

### ASan reports a container-overflow that is not there

Compile and link every library of the program with the ASan libc++:
`-isystem $asan/include` and `-nostdlib++ $asan/libc++.a`. The program
links the normal, uninstrumented `libc++.a`. Bazel's `--features=asan` does
it ([sanitizers](../features/sanitizers.md#plain-clang)).

### gdb or lldb does not find the sources of a Bazel build

Map `.` to the `bazel-<workspace>` link of the workspace. The paths in the
debug information are relative to the execution root
([Bazel](../integrations/bazel.md#debug-in-gdb-lldb-and-vs-code)).

### A macOS dSYM has no lines for code compiled with ThinLTO

Make the dSYM in the link: `xclang_debug_symbols` in CMake, the
`generate_dsym_file` feature in Bazel. A dSYM made after the link misses the
LTO objects, which the linker has deleted
([debugging](../features/debugging.md#why-a-dsym-comes-from-the-link)).

### A tool that reads `clang -###` fails

Skip the tool name. clang prints its compile job as
`".../llvm" "clang" "-cc1" ...`: the one program, with the tool name first
([toolchain structure](../design/toolchain.md#what-prints)).

## Build Speed and Caches

### Linking a tool on libclang takes minutes every time

Turn on the ThinLTO cache with `XCLANG_THINLTO_CACHE`. libclang is ThinLTO
bitcode, and its code is generated at the link
([the ThinLTO cache](../features/thinlto-cache.md)).

### The ThinLTO cache does nothing under Bazel on Linux

Use a directory under `/var/tmp`, with `--sandbox_writable_path`. The
sandbox lets a link write the directory only with that option. A directory
under `/tmp` is in the private `/tmp` of the action, and lost after the link
([why one fixed path](../features/thinlto-cache.md#why-one-fixed-path)).

### ccache gives a wrong program after a module's interface changed

Use ccache 4.14 or later. ccache 4.13 and older serve the object of an
importer from before the change. Neither caches module interfaces
([build caches and modules](../features/modules.md#build-caches-and-modules)).

### `C++26 was disabled in precompiled file`, or another option mismatch with `import std`

Set the language options project-wide in CMake, or in `--cxxopt` in Bazel,
or give the CMake target a `std` of its own with `xclang_add_std`. The `std`
module was built with other language options than the importer: `-std`,
exceptions, RTTI
([CMake](../integrations/cmake.md#use-c-20-modules-and-import-std)).

## Windows Hosts

### Bazel fails with paths too long

Put `startup --output_user_root=C:/b` in `%USERPROFILE%\.bazelrc`. The
default output root of Bazel is too deep
([Bazel](../integrations/bazel.md#on-a-windows-host)).

### Killed builds left `llvm.exe` processes behind

Use 23.1.2.4 or later. Its launchers create `llvm.exe` inside a
kill-on-close job ([the launchers](../design/windows.md#the-launchers)).
