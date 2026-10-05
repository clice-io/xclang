# CMake

xclang's CMake package makes the toolchain a build's compiler, for the host
or another target, and gives the build libc++'s `std` and `std.compat`
modules as a library to link: `import std` without CMake's experimental
`CMAKE_EXPERIMENTAL_CXX_IMPORT_STD`.

It needs CMake 3.28 and Ninja 1.11 or later, the first that build C++20
modules, and the Ninja or Ninja Multi-Config generator: CMake builds modules
with no other generator for these targets. The package is in every
toolchain archive from 23.1.2.6 on, in `lib/cmake/xclang` (and so in the
conda package), and in this repository, `packages/cmake/`, at every tag.
Every variable and function is listed in the [CMake API](../reference/cmake-api.md).

## With xclang installed

pixi puts xclang's `bin/` first in `PATH`; for an unpacked archive, do the
same or use the toolchain file below. CMake does not pick clang by itself:

```sh
cmake -G Ninja -B build -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
```

```cmake
cmake_minimum_required(VERSION 3.28)
project(app LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)

add_executable(app main.cpp)
target_link_libraries(app PRIVATE xclang::std)
```

`find_package(xclang)` finds the package through `PATH` (`<xclang>/bin`
gives `<xclang>/lib/cmake/xclang`), or `-Dxclang_ROOT=<xclang>`. It comes
after `project()`, whose C++ compiler must be xclang's.

The toolchain file sets the compilers and binary tools (`llvm-ar`,
`llvm-ranlib`, ...) of a tree and the package's location at once, without
`PATH`:

```sh
cmake -G Ninja -B build --toolchain <xclang>/lib/cmake/xclang/toolchain.cmake
```

A ready project is in
[examples/cmake](https://github.com/clice-io/xclang/tree/main/examples/cmake):
the [quick start](../guide/quick-start.md) builds it.

## Without xclang installed

Before `project()`, FetchContent fetches this repository at the release's
tag, and `packages/cmake/xclang.cmake` downloads that release's toolchain
for the host and makes it the build's:

```cmake
cmake_minimum_required(VERSION 3.28)

set(XCLANG_VERSION 23.1.2.6)
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG ${XCLANG_VERSION})
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)

project(app LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)

add_executable(app main.cpp)
target_link_libraries(app PRIVATE xclang::std)
```

```sh
cmake -G Ninja -B build
```

The tag holds `packages/cmake/` from 23.1.2.6 on. `GIT_TAG` may also name a
later commit, with `XCLANG_VERSION` the release whose toolchain it
downloads: an earlier one works too.

`xclang.cmake` downloads the release's `SHA256SUMS` and
`xclang-<version>-<host>.tar.xz`, checks the archive against its line
there, unpacks it into the user's cache, once per version and host, and
sets `CMAKE_TOOLCHAIN_FILE` to its toolchain file. Another build tree of the
same release and host finds the toolchain in the cache and downloads
nothing but the checkout. The archive is as trustworthy as the release's
`SHA256SUMS`: both come from the GitHub release, and releases are not yet
immutable ([releases](../reference/releases.md#checking-a-download)).

`XCLANG_CACHE_DIR` moves the cache, `XCLANG_ROOT` uses an unpacked xclang
instead of downloading one, `XCLANG_URL` names a mirror. `xclang.cmake`
stops if the build has a toolchain file of its own already (vcpkg's, say);
vcpkg chain-loads an installed xclang's (`VCPKG_CHAINLOAD_TOOLCHAIN_FILE`)
instead.

## Other targets

`XCLANG_TARGET` builds for another target of the tree, with either way of
getting it:

```sh
cmake -G Ninja -B build-arm64 --toolchain <xclang>/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-w64-mingw32
```

- Linux and Windows targets build on every host. macOS targets build on
  macOS only (Xcode's SDK); the other macOS architecture is
  `CMAKE_OSX_ARCHITECTURES` to CMake, not cross-compiling, and x86_64
  programs run on arm64 macOS through Rosetta.
- CMake looks for the libraries, headers and packages of another target in
  that target's directory only (`CMAKE_SYSROOT`,
  `CMAKE_FIND_ROOT_PATH_MODE_*` `ONLY`): a dependency built for the target
  is named by `<Package>_DIR`, or its prefix added to `CMAKE_FIND_ROOT_PATH`.
  A library found on the build machine would be the wrong architecture or
  OS, and the link would fail late or, worse, succeed against the wrong
  headers.
- `xclang::std` is built for the target too.
- Tests built for another target run on a machine of that target, not on
  the build machine.

## import std

`xclang::std` is a static library of libc++'s `std` and `std.compat`
modules, one target for both, compiled from the sources the compiler's
module manifest names (`clang++ -print-library-module-manifest-path`) for
the build's target. It is built only when something links it.

clang refuses a module file built with other language options than its
importer's: `-std`, GNU extensions, `-fno-exceptions`, `-fno-rtti`, ...;
macros, include paths and optimization may differ
([C++20 modules](../features/modules.md) says why). So:

- `xclang::std` is built with the settings of the directory that called
  `find_package(xclang)`, as they are at the end of its `CMakeLists.txt`:
  `CMAKE_CXX_STANDARD`, `CMAKE_CXX_EXTENSIONS`, `CMAKE_CXX_FLAGS`,
  `add_compile_options()`. Importers that take theirs from the same place
  match it; set them project-wide, not per target.
- It asks its importers for its standard, C++23 or the `CMAKE_CXX_STANDARD`
  it was built with if that is 20 or later. A target asking for a newer one
  (`cxx_std_26`) gets `C++26 was disabled in precompiled file`.
- A target with other language options links a std of its own, whose
  `PUBLIC` options reach its importers:

  ```cmake
  xclang_add_std(std_noexcept)
  target_compile_options(std_noexcept PUBLIC -fno-exceptions)
  target_link_libraries(kernel PRIVATE std_noexcept)
  ```

A program's own modules are CMake's `FILE_SET CXX_MODULES`, scanned by
clang-scan-deps; `cmake_minimum_required(VERSION 3.28)` or later turns on
the scanning of C++20 targets (CMP0155).

```cmake
add_library(geometry STATIC)
target_sources(geometry PUBLIC FILE_SET CXX_MODULES FILES geometry.cppm geometry-shapes.cppm)
target_link_libraries(geometry PUBLIC xclang::std)
```

ccache never caches a module interface, and before 4.14 it serves an
importer's stale object after the interface changed; see
[C++20 modules](../features/modules.md#build-caches-and-modules) before
putting it in front of the compiler.

## Debug symbols

`xclang_debug_symbols(<target>)` makes a program's debug symbols for its
release after each of its links, with the toolchain's own tools:

```cmake
add_executable(tool main.cpp)
target_compile_options(tool PRIVATE -gline-tables-only)
xclang_debug_symbols(tool)
```

- `tool.gsym` next to the program: functions, inlining and lines by
  address, about a tenth of the DWARF's size; `llvm-gsymutil tool.gsym
  --address=<address>` looks one up. llvm-gsymutil's warnings go to
  `tool.gsym.log`; `GSYM_ARGS --merged-functions` keeps every name of the
  functions identical code folding merged.
- `tool.dSYM` for a macOS target, made first, and the GSYM's source:
  dsymutil reads the objects the debug map points into, and the link keeps
  ThinLTO's for it in `<build dir>/tool.lto`.

What GSYM and dSYM are for, and why they come from the link, is in
[debugging](../features/debugging.md).

## libclang

A tool on libclang finds it with `find_package(Clang)`; see
[libclang](../features/libclang.md#cmake).

## The ThinLTO cache

libclang is ThinLTO bitcode, so the link of a tool on it generates the code
of every module the tool uses, which takes minutes. With
`XCLANG_THINLTO_CACHE`, an absolute directory, a link after the first takes
seconds:

```sh
cmake -G Ninja -B build -DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
```

`find_package(xclang)` makes the directory at configure time and adds the
target's linker's flag to every link of the directory that called it and of
its subdirectories: `-Wl,--thinlto-cache-dir=<dir>` for Linux and Windows
targets, `-Wl,-cache_path_lto,<dir>` for macOS ones. The environment
variable `XCLANG_THINLTO_CACHE` gives the first configure of every build
tree its value. How the cache works, its pruning and why its path is fixed
are in [the ThinLTO cache](../features/thinlto-cache.md); keeping it in CI
is in [CI](ci.md).

## Tested by

tests/cmake builds with the package as above on every host, with CMake 3.28
and Ninja 1.11 and with the newest ones (cmake.yml): found by `PATH`, through
the toolchain file for every other target the host can build, and
downloaded by FetchContent from the release's tag. It links tests/libclang
with the ThinLTO cache and again from it, and builds examples/cmake.
