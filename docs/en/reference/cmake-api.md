# CMake API

Everything xclang's CMake package defines. How to use it is
[CMake](../integrations/cmake.md); this page is the list.

The package is `lib/cmake/xclang` of every toolchain archive from 23.1.2.6
on (and so of the conda package), and `packages/cmake/` of the repository
at every tag from 23.1.2.6 on. It needs CMake 3.28 or later and, for C++20
modules, the Ninja or Ninja Multi-Config generator with Ninja 1.11 or later.

## Files

| file | what it is |
|---|---|
| `xclang-config.cmake` | `find_package(xclang)`: `xclang::std`, `xclang_add_std()`, `xclang_debug_symbols()`, `XCLANG_ROOT`, the ThinLTO cache |
| `xclang-config-version.cmake` | the release, for `find_package(xclang 23.1)` (toolchain archives only) |
| `toolchain.cmake` | the tree as a build's toolchain, for the host or `XCLANG_TARGET` |
| `xclang.cmake` | in `packages/cmake/` only: included before `project()` from a FetchContent checkout, downloads the toolchain |

## find_package(xclang)

Comes after `project()` (or `enable_language(CXX)`), whose C++ compiler must
be xclang's `clang++`. It finds the package through `PATH`
(`<xclang>/bin` gives `<xclang>/lib/cmake/xclang`), `xclang_ROOT`, or
`CMAKE_PREFIX_PATH`.

| name | kind | |
|---|---|---|
| `xclang::std` | target | static library of libc++'s `std` and `std.compat` modules, built for the build's target with the language options of the directory that called `find_package(xclang)`, as they are at the end of its `CMakeLists.txt`; built only when something links it |
| `xclang_add_std(<name>)` | function | another such library; options given to it with `PUBLIC` reach its importers |
| `xclang_debug_symbols(<target> [GSYM_ARGS <option>...])` | function | after each link of `<target>`: `<target>.gsym` next to the program (llvm-gsymutil's output in `<target>.gsym.log`), and for a macOS target `<target>.dSYM` first |
| `XCLANG_ROOT` | variable | the toolchain's directory |
| `XCLANG_THINLTO_CACHE` | cache variable | an absolute directory for the linker's ThinLTO cache; set, it is made at configure time and every link of the calling directory and its subdirectories gets the target's linker's flag. Its first value comes from the environment variable of the same name |

`xclang::std` asks its importers for C++23, or for the `CMAKE_CXX_STANDARD`
it was built with if that is 20 or later.

## toolchain.cmake

```sh
cmake -G Ninja -B build --toolchain <xclang>/lib/cmake/xclang/toolchain.cmake [-DXCLANG_TARGET=<triple>]
```

| variable | |
|---|---|
| `XCLANG_TARGET` | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`, `aarch64-apple-darwin` or `x86_64-apple-darwin`; the host's by default. macOS targets build on macOS only |
| `XCLANG_ROOT` | the tree, when the file is used from outside one |

It sets the C, C++ and ASM compilers and the binary tools to the tree's:
`llvm-ar`, `llvm-ranlib`, `llvm-nm`, `llvm-objcopy`, `llvm-objdump`,
`llvm-readelf`, `llvm-strip`, `llvm-addr2line`, `llvm-dlltool`; for
Windows targets `llvm-windres` as the RC compiler; for macOS targets
`llvm-libtool-darwin`, `llvm-lipo` and `llvm-install-name-tool` (Apple's
`libtool` cannot read the bitcode of a newer LLVM).

For a Linux or Windows target other than the host it also sets
`CMAKE_SYSTEM_NAME`, `CMAKE_SYSTEM_PROCESSOR`, `CMAKE_<LANG>_COMPILER_TARGET`,
`CMAKE_SYSROOT` (the target's directory) and
`CMAKE_FIND_ROOT_PATH_MODE_{LIBRARY,INCLUDE,PACKAGE}` to `ONLY`, so
libraries, headers and packages are looked for in that directory alone
(programs on the build machine). The other macOS architecture is
`CMAKE_OSX_ARCHITECTURES`, which CMake does not treat as cross-compiling.
Sysroot, C++ library, runtimes and linker come from the target's config
file, not from this file.

## xclang.cmake

Included before `project()`, from a checkout of a release's tag:

```cmake
set(XCLANG_VERSION 23.1.2.6)
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG ${XCLANG_VERSION})
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

| variable | |
|---|---|
| `XCLANG_VERSION` | the release to download; without it, the release tagging the checkout |
| `XCLANG_TARGET` | another target to build for (`toolchain.cmake`) |
| `XCLANG_ROOT` | an unpacked xclang to use instead of downloading one |
| `XCLANG_CACHE_DIR` | where toolchains are unpacked, `<version>/<host>` each (also an environment variable); by default `$XDG_CACHE_HOME/xclang` or `~/.cache/xclang`, `~/Library/Caches/xclang` on macOS, `%LOCALAPPDATA%\xclang` on Windows |
| `XCLANG_URL` | where `SHA256SUMS` and the archives are downloaded from, a mirror of the release; its `SHA256SUMS` is then the one trusted |

It downloads the release's `SHA256SUMS` and the host's
`xclang-<version>-<host>.tar.xz`, checks the archive against its line,
unpacks it aside and moves it into the cache (so build trees configured at
once do not clash), and sets `CMAKE_TOOLCHAIN_FILE`. It stops if the build
already has a toolchain file (vcpkg's, say): vcpkg chain-loads xclang's
instead (`VCPKG_CHAINLOAD_TOOLCHAIN_FILE`).

## libclang's package

The libclang archives carry LLVM's and clang's own CMake packages
(`find_package(Clang)`), and `lib/cmake/xclang/libclang.cmake`, which
records the build: `XCLANG_LLVM_VERSION`, `XCLANG_LTO`, `XCLANG_PGO`,
`XCLANG_PATCHES` and the like. See [libclang](../features/libclang.md).
