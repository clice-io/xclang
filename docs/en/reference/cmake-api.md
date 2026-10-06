# CMake API

Everything the CMake package of xclang defines. How to use it is in
[CMake](../integrations/cmake.md); this page is the list.

The package is `lib/cmake/xclang` of every toolchain directory, and so of
the conda package, and `packages/cmake/` of the repository at every tag.
It needs CMake 3.28 or later. For C++20 modules, it needs the Ninja or
Ninja Multi-Config generator, with Ninja 1.11 or later.

## Files

| file | what it is |
|---|---|
| `xclang-config.cmake` | `find_package(xclang)`: `xclang::std`, `xclang_add_std()`, `xclang_debug_symbols()`, `XCLANG_ROOT`, the ThinLTO cache |
| `xclang-config-version.cmake` | the release, for `find_package(xclang 23.1)` (toolchain archives only) |
| `toolchain.cmake` | the toolchain directory as the toolchain of a build, for the host or `XCLANG_TARGET` |
| `xclang.cmake` | in `packages/cmake/` only: included before `project()` from a FetchContent checkout, it downloads the toolchain |

## `find_package(xclang)`

It comes after `project()` or `enable_language(CXX)`, whose C++ compiler
must be xclang's `clang++`. It finds the package through `PATH`
(`$XCLANG/bin` gives `$XCLANG/lib/cmake/xclang`), `xclang_ROOT`, or
`CMAKE_PREFIX_PATH`.

| name | kind | |
|---|---|---|
| `xclang::std` | CMake target | a static library of the `std` and `std.compat` modules of libc++ (of Microsoft's STL for the MSVC targets), for the build's target; built only when something links it ([language options](../integrations/cmake.md#use-c-20-modules-and-import-std)) |
| `xclang_add_std(<name>)` | function | another such library; its `PUBLIC` options reach its importers |
| `xclang_debug_symbols(<program> [GSYM_ARGS <option>...])` | function | after each link of the CMake target `<program>`: `<program>.gsym` next to it, by llvm-gsymutil with one thread (the same file each run; `GSYM_ARGS` come after `--num-threads=1`), with its output in `<program>.gsym.log`; for a macOS target, `<program>.dSYM` first ([debugging](../features/debugging.md#usage)); nothing for an MSVC target, whose link writes a PDB |
| `XCLANG_ROOT` | variable | the toolchain directory |
| `XCLANG_THINLTO_CACHE` | cache variable | an absolute directory for the ThinLTO cache of the linker; its first value comes from the environment variable of the same name ([the ThinLTO cache](../features/thinlto-cache.md#usage)) |

`xclang::std` asks its importers for C++23, or for the `CMAKE_CXX_STANDARD`
it was built with if that is 20 or later.

## `toolchain.cmake`

```text
cmake -G Ninja -B build --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake [-DXCLANG_TARGET=<target>]
```

| variable | |
|---|---|
| `XCLANG_TARGET` | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc` or `aarch64-pc-windows-msvc`; the host's by default. The MSVC targets, and the macOS targets on Linux and Windows hosts, build with the SDK that the toolchain's `xclang` fetched |
| `XCLANG_ROOT` | the toolchain directory, when the file is used from outside one |

It sets the C, C++ and ASM compilers, and the binary tools, to those of the
toolchain directory: `llvm-ar`, `llvm-ranlib`, `llvm-nm`, `llvm-objcopy`,
`llvm-objdump`, `llvm-readelf`, `llvm-strip`, `llvm-addr2line`,
`llvm-dlltool`; for Windows targets `llvm-windres` as the RC compiler; for
macOS targets the Objective-C compilers (clang and clang++),
`llvm-libtool-darwin`, `llvm-lipo` and `llvm-install-name-tool` (Apple's
`libtool` cannot read the bitcode of a newer LLVM).

For a Linux or Windows target other than the host, it also sets
`CMAKE_SYSTEM_NAME`, `CMAKE_SYSTEM_PROCESSOR`,
`CMAKE_<LANG>_COMPILER_TARGET`, `CMAKE_SYSROOT` (the sysroot of the target)
and `CMAKE_FIND_ROOT_PATH_MODE_{LIBRARY,INCLUDE,PACKAGE}` to `ONLY`, so
libraries, headers and packages are looked for in the sysroot alone, and
programs on the host. The other macOS architecture is
`CMAKE_OSX_ARCHITECTURES`, which CMake does not treat as cross-compiling.
The sysroot, C++ library, runtimes and linker come from the config file of
the target, not from this file.

For an MSVC target on a Linux or macOS host, it stops unless the
toolchain's `sdk/windows` has the SDK for the target; on a Windows host
without one, clang finds Visual Studio. It sets `llvm-rc` as the RC compiler, which CMake runs
on the output of the target's clang. `CMAKE_MSVC_RUNTIME_LIBRARY` is
`MultiThreaded` unless set, and a link with `MultiThreadedDebug` or
`MultiThreadedDebugDLL` gets `/nodefaultlib:ucrt.lib`. The SDK is
`CMAKE_FIND_ROOT_PATH`, except on a Windows host for its own architecture,
which is no cross build to CMake, and on a Windows host without one.

For a macOS target on a Linux or Windows host, `CMAKE_OSX_SYSROOT` is the
one given, else `SDKROOT`, else the toolchain's `sdk/macos`, and it
stops if that has no SDK. It sets `CMAKE_SYSTEM_NAME` to `Darwin`,
`CMAKE_SYSTEM_PROCESSOR` and `CMAKE_OSX_ARCHITECTURES` to `arm64` or
`x86_64`, `CMAKE_<LANG>_COMPILER_TARGET` (C, C++, ASM, Objective-C), and
the SDK as `CMAKE_FIND_ROOT_PATH`, with the modes above.

## `xclang.cmake`

Included before `project()`, from a FetchContent checkout of the tag of a
release ([CMake](../integrations/cmake.md#without-xclang-installed) has
the snippet):

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

| variable | |
|---|---|
| `XCLANG_VERSION` | the release to download; without it, the release tagging the checkout |
| `XCLANG_TARGET` | another target to build for, as for `toolchain.cmake` |
| `XCLANG_ROOT` | an unpacked xclang to use instead of downloading one |
| `XCLANG_CACHE_DIR` | where toolchains are unpacked, `<version>/<host>` each (also an environment variable); by default `$XDG_CACHE_HOME/xclang` or `~/.cache/xclang`, `~/Library/Caches/xclang` on macOS, `%LOCALAPPDATA%\xclang` on Windows |
| `XCLANG_URL` | where `SHA256SUMS` and the archives are downloaded from, a mirror of the release; its `SHA256SUMS` is then the one trusted |

It downloads the `SHA256SUMS` of the release and the host archive,
`xclang-<version>-<host>.tar.xz`, and checks the archive against its line.
It unpacks the archive aside and moves it into the cache, so that build
trees configured at once do not clash. Then it sets
`CMAKE_TOOLCHAIN_FILE`. It stops if the build already has a toolchain file,
such as vcpkg's; vcpkg chain-loads xclang's instead
(`VCPKG_CHAINLOAD_TOOLCHAIN_FILE`).

## libclang's Package

The libclang archives carry the own CMake packages of LLVM and clang
(`find_package(Clang)`). They also carry `lib/cmake/xclang/libclang.cmake`,
which records the build: `XCLANG_LLVM_VERSION`, `XCLANG_LTO`, `XCLANG_PGO`,
`XCLANG_PATCHES` and the like ([libclang](../features/libclang.md)).
