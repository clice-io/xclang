# Troubleshooting

Common build and runtime symptoms with xclang, their causes, and how to fix
them.

## Linking and Running

### A `std::exception` from my shared library is not caught

Every shared object linked by xclang carries its own private copy of
libc++, and on Linux and macOS libc++ compares `type_info` by address, so a
standard exception thrown in one shared library matches only `catch (...)`
in another (Windows compares by name and catches it). Link the code into
one program, or keep C++ types and exceptions inside each shared object
behind a C interface ([hermeticity](../design/hermeticity.md)).

### Bazel tests crash at start-up with a double free

When the `supports_dynamic_linker` feature is enabled on a Bazel target,
Bazel links each library of a test into a separate shared object
with its own copy of libc++. Remove `supports_dynamic_linker` from the
target (xclang's module turns it off by default), or keep C++ objects from
crossing those shared objects
([the Bazel module](../design/bazel-module.md)).

### Undefined references to `std::__cxx11::...` or `std::__1::...`

A C++ library built with GCC's libstdc++ or MSVC's STL has a different ABI
than xclang's libc++ (C libraries are not affected). Build C++ dependencies
with xclang for the same target, or pass `-stdlib=platform` to compile and
link with the platform's C++ library: GCC's libstdc++ on Linux, the SDK's
`libc++.1.dylib` on macOS, or Microsoft's STL for MSVC targets
([plain clang](../integrations/clang.md)).

### `version 'GLIBC_2.34' not found` on an older machine

A program linked by xclang requires at most glibc 2.17 unless the link
included a library built against a newer glibc, such as a host shared
library (`-L/usr/lib/...`) or a build using `-stdlib=platform` or
`--no-default-config`. Link only libraries built with xclang for the
target, and inspect what a binary requires with
`llvm-readobj --needed-libs` and `llvm-objdump -T`
([Linux targets](../targets/linux.md)).

### `-static-pie` fails, or `-pg` does not link

The glibc 2.17 sysroot has no `rcrt1.o` for `-static-pie`, and its
`gcrt1.o` for `-pg` is not position-independent. Use `-static` with the
glibc targets (or use a musl target, which supports `-static-pie`), and
pass `-no-pie` when linking with `-pg`
([Linux targets](../targets/linux.md)).

### On Windows, `-o hello` wrote `hello.exe`

A MinGW link appends `.exe` when the output filename has no extension.
Include the extension in `-o hello.exe` so build scripts see the same
output filename on every host ([Windows targets](../targets/windows.md)).

### Rust: undefined `_Unwind_*` symbols linking for Linux

Rust's standard library links with `-nodefaultlibs` and requests
`-lgcc_s`, which is an empty archive in xclang's sysroots. Build with
`xclang cargo`, which substitutes `libunwind` automatically, or pass
`-Clink-arg=-l:libunwind.a` when configuring cargo by hand
([Rust and Cargo](../integrations/cargo.md)).

### A header in `/usr/include` is not found on Linux

xclang's target config file points clang at its bundled glibc 2.17 sysroot
and libc++ rather than the host system's `/usr/include` and libstdc++. Pass
`-stdlib=platform` to every compile and link to use the system's headers,
glibc and libstdc++ with lld ([plain clang](../integrations/clang.md)), or
pass `--no-default-config` for a bare upstream clang
([toolchain structure](../design/toolchain.md)).

## Cross-Compiling

### `'Windows.h' file not found` from Linux, but it builds on Windows

Windows file systems ignore case, whereas the headers in MinGW-w64 are
lowercase (`windows.h`, `basetsd.h`) on a case-sensitive Linux file system.
Include Windows headers in lowercase, which compiles on every host
([Windows targets](../targets/windows.md)).

### `no such sysroot directory: '.../sdk/macos'` on Linux or Windows

On Linux and Windows hosts, macOS targets build against Apple's SDK at
`sdk/macos`, which cannot be redistributed in the toolchain archive. Fetch
the SDK once from Apple with `xclang sdk fetch macos --accept-license`
([macOS targets](../targets/macos.md)). For the MSVC targets off Windows, a
missing Windows SDK stops at `'stdio.h' file not found` until you run
`xclang sdk fetch windows --accept-license`
([Windows targets](../targets/windows.md)).

### Test registrations disappear from Windows release builds

For MinGW targets, lld's `--gc-sections` drops the static initializers of
unreferenced COMDAT sections, including test-case registrations. Do not
pass `-Wl,--gc-sections` for Windows targets; the Bazel module leaves
`gc_sections` off for Windows by default
([Windows targets](../targets/windows.md)).

## Sanitizers and Debugging

### ASan reports a `container-overflow` that is not there

Linking an ASan program against the uninstrumented `libc++.a` leaves
container operations inside libc++ uninstrumented, which causes false
`container-overflow` reports. Compile and link every library of the program
with the ASan libc++ (`-isystem $asan/include` and
`-nostdlib++ $asan/libc++.a`), or use Bazel's `--features=asan` or the
CMake toolchain file's `-DXCLANG_SANITIZER=address`
([sanitizers](../features/sanitizers.md)).

### gdb or lldb does not find the sources of a Bazel build

The Bazel module compiles with debug paths relative to the execution root
(`-ffile-compilation-dir=.`) so builds are reproducible across directories.
Map `.` to the `bazel-<workspace>` symlink of the workspace in your
debugger ([Bazel](../integrations/bazel.md)).

### A macOS dSYM has no lines for code compiled with ThinLTO

`dsymutil` reads DWARF from the object files, and with ThinLTO the linker
deletes the temporary LTO backend objects at the end of the link. Generate
the dSYM during the link itself with `xclang_debug_symbols` in CMake or the
`generate_dsym_file` feature in Bazel
([debugging](../features/debugging.md)).

### A tool that reads `clang -###` fails

clang and the other LLVM tools are packaged as one multicall program
(`llvm`), so `clang -###` prints its `-cc1` job as
`".../llvm" "clang" "-cc1" ...` with the tool name first. Skip the tool
name argument after the executable path when parsing `clang -###`
([toolchain structure](../design/toolchain.md)).

## Build Speed and Caches

### Linking a tool on libclang takes minutes every time

libclang ships as ThinLTO bitcode, so the linker compiles the clang and
LLVM libraries to machine code on every link. Set `XCLANG_THINLTO_CACHE` to
an absolute directory so the linker caches unchanged ThinLTO backend
objects between links ([libclang](../features/libclang.md)).

### The ThinLTO cache does nothing under Bazel on Linux

Bazel's Linux sandbox lets an action write only where it is allowed to, and
gives each action a private `/tmp`, discarded after the link. Place the cache
directory under `/var/tmp` and pass `--sandbox_writable_path=<dir>` in
`.bazelrc` so link actions can read and write the shared cache
([libclang](../features/libclang.md)).

### ccache gives a wrong program after a module's interface changed

ccache 4.13 and older do not include imported module files in an importer's
cache key, so they serve a stale object file from before the interface
change. Upgrade to ccache 4.14 or later; no version caches the module
interfaces themselves ([C++20 modules](../features/modules.md)).

### `C++26 was disabled in precompiled file`, or another option mismatch with `import std`

A precompiled module file can only be imported by translation units
compiled with the same language options (`-std`, exceptions, RTTI), and the
`std` module was built with different options than the importer. Set
language options project-wide in CMake or with `--cxxopt` in Bazel, or
create a `std` module target with matching options using `xclang_add_std`
in CMake ([C++20 modules](../features/modules.md),
[CMake](../integrations/cmake.md)).

## Windows Hosts

### Bazel fails with paths too long

Bazel's default output root under the user profile directory produces deep
file paths that exceed Windows path limits. Add
`startup --output_user_root=C:/b` to `%USERPROFILE%\.bazelrc`
([Bazel](../integrations/bazel.md)).
