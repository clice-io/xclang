# Using clang

## Cross-compiling

Every toolchain carries every target's sysroot and runtimes, so
cross-compiling is a `--target` flag and nothing else:

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
xclang/bin/clang++ --target=aarch64-unknown-linux-gnu main.cpp -o main
```

No `--sysroot`, no `-L`, no SDK to install: `bin/aarch64-w64-mingw32.cfg`,
which clang reads for that target, points it at `xclang/aarch64-w64-mingw32/`,
and it links the libc++, libunwind and compiler-rt built for that exact
target. The targets are `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`,
`aarch64-apple-darwin` and `x86_64-apple-darwin`
([hosts and targets](layout.md)); clang's other spellings of them
(`x86_64-pc-linux-gnu`, `aarch64-pc-windows-gnu`, `arm64-apple-macos`, ...)
reach the same config files. macOS targets need Xcode's SDK, found by
`xcrun` or given with `-isysroot`, so they build on macOS only.

## Config files

The config files apply to native builds too, so a plain `clang++ main.cpp`
on Linux compiles against glibc 2.17 and links everything but glibc
statically. What each target's file says:

| target | config file |
|---|---|
| Linux | `--sysroot` of the target's directory, compiler-rt, libunwind and libc++ (`-static-libstdc++ -static-libgcc`), lld |
| Windows | `--sysroot` of the target's directory, compiler-rt, libunwind and libc++ (static libraries only), lld |
| macOS | xclang's libc++ headers and `libc++.a` ahead of the SDK's `libc++.tbd`, deployment target 13.0, ld64.lld |

`--no-default-config` gives the bare compiler, for building against the
system's own headers and libraries. The sysroots and runtimes are plain
directories laid out the way clang's drivers expect, so any clang pointed
at them with `--sysroot` / `-resource-dir` cross-compiles too.

macOS targets link with ld64.lld, on macOS too. `-fuse-ld=ld` selects the
system's `ld`, which does LTO with xclang's `libLTO.dylib`, as Apple's own
toolchain does.

## GCC's names

Build scripts written for GCC keep working: `-latomic`, `-lgcc`,
`-lgcc_eh`, `-lgcc_s` (and on Windows `-lssp`, which `-fstack-protector`
asks for) find empty archives, the functions being in compiler-rt,
libunwind and mingw-w64; `-lstdc++` means libc++. `-static` links fully
static Linux programs. `windres`, the name CMake looks for to compile a
MinGW project's `.rc` files, is `llvm-windres`.

## compiler-rt and sanitizers

compiler-rt carries the builtins (with the `__atomic_*` functions of
atomics too wide to be lock-free), the profile runtime, and for Linux and
macOS targets AddressSanitizer, ThreadSanitizer, LeakSanitizer, UBSan and
libFuzzer. zlib and zstd are linked in statically: `-gz=zlib`, `-gz=zstd`
and compressed profiles work on every host.

Those targets also carry libc++'s ASan build, `<asan>`: `lib/asan` of the
target directory (`usr/lib/asan` on Linux). An ASan build compiles and
links with it, all of it, libraries too:

```
compile   -fsanitize=address -isystem <asan>/include
link      -fsanitize=address -nostdlib++ <asan>/libc++.a
```

Its `__config_site` turns on the container checks of `std::string`, and
its `libc++.a` is instrumented like the code that calls it: a program
mixing either with the other build gets false container-overflow reports.
The other sanitizers need nothing of the kind.

libc++ is built with hardening mode `none`. The mode is a per-translation-unit
macro, so a debug build opts in with `-D_LIBCPP_HARDENING_MODE=...`.

## import std

libc++'s `std` and `std.compat` modules are sources in each target
directory, which clang names: `-print-library-module-manifest-path` prints
`libc++.modules.json`, and the sources are next to it in
`../share/libc++/v1`. Built by hand:

```sh
share=$(dirname "$(clang++ -print-library-module-manifest-path)")/../share/libc++/v1
clang++ -std=c++23 -Wno-reserved-module-identifier -isystem "$share" \
    --precompile "$share/std.cppm" -o std.pcm
clang++ -std=c++23 -fmodule-file=std=std.pcm main.cpp std.pcm -o main
```

clang refuses a module file built with other language options (`-std`, GNU
extensions, `-fno-exceptions`, `-fno-rtti`, ...) than its importer's;
macros, include paths and optimization may differ. [CMake](cmake.md) and
[Bazel](bazel.md) build the modules for a build by themselves.
