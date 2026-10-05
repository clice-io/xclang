# CMake

xclang's CMake package makes the toolchain a build's compiler, for the
host or another target, and gives the build libc++'s `std` and
`std.compat` modules as a library to link: `import std` without CMake's
experimental `CMAKE_EXPERIMENTAL_CXX_IMPORT_STD`.

It needs CMake 3.28 and Ninja 1.11 or later, the first that build C++20
modules, and the Ninja or Ninja Multi-Config generator: CMake builds modules
with no other generator for these targets.

The package is in every toolchain archive from 23.1.2.6 on, in
`lib/cmake/xclang` (and so in the conda package), and in this repository,
`packages/cmake/`, at every tag.

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
`llvm-ranlib`, ...) of a tree and the package's location at once:

```sh
cmake -G Ninja -B build --toolchain <xclang>/lib/cmake/xclang/toolchain.cmake
```

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

The tag holds `packages/cmake/` from 23.1.2.6 on. `GIT_TAG` may also name a
later commit, with `XCLANG_VERSION` the release whose toolchain it
downloads: an earlier one works too.

`xclang.cmake` downloads the release's `SHA256SUMS` and
`xclang-<version>-<host>.tar.xz`, checks the archive against its line
there, unpacks it into the user's cache, once per version and host, and
sets `CMAKE_TOOLCHAIN_FILE` to its toolchain file. The archive is as
trustworthy as the release's `SHA256SUMS`: both come from the GitHub
release, and releases are not yet immutable. Another build tree of the same
release and host finds the toolchain in the cache and downloads nothing but
the checkout.

| variable | |
|---|---|
| `XCLANG_VERSION` | the release to download; without it, the release tagging the fetched checkout |
| `XCLANG_TARGET` | another target to build for (below) |
| `XCLANG_ROOT` | an unpacked xclang to use instead of downloading one |
| `XCLANG_CACHE_DIR` | where toolchains are unpacked, `<version>/<host>` each (also an environment variable); by default `$XDG_CACHE_HOME/xclang` or `~/.cache/xclang`, `~/Library/Caches/xclang` on macOS, `%LOCALAPPDATA%\xclang` on Windows |
| `XCLANG_URL` | where `SHA256SUMS` and the archives are downloaded from, a mirror of the release; its `SHA256SUMS` is then the one trusted |

The variables are set before the `include`, or given with `-D`. A toolchain
is downloaded and unpacked aside and moved in place, so build trees
configured at once do not clash. `xclang.cmake` stops if the build has a
toolchain file of its own already (vcpkg's, say); vcpkg chain-loads an
installed xclang's (`VCPKG_CHAINLOAD_TOOLCHAIN_FILE`) instead.

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
  that target's directory only (`CMAKE_SYSROOT`, `CMAKE_FIND_ROOT_PATH_MODE_*`
  `ONLY`): a dependency built for the target is named by `<Package>_DIR`, or
  its prefix added to `CMAKE_FIND_ROOT_PATH`.
- `xclang::std` is built for the target too.

## import std

`xclang::std` is a static library of libc++'s `std` and `std.compat`
modules, one target for both, compiled from the sources the compiler's
module manifest names (`clang++ -print-library-module-manifest-path`) for
the build's target. It is built only when something links it.

clang refuses a module file built with other language options than its
importer's: `-std`, GNU extensions, `-fno-exceptions`, `-fno-rtti`, ...;
macros, include paths and optimization may differ. So:

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

## libclang

A tool on libclang finds it with `find_package(Clang)`; see
[libclang](libclang.md).

## The ThinLTO cache

libclang is ThinLTO bitcode, so the link of a tool on it generates the code
of every module the tool uses, which takes minutes. With
`XCLANG_THINLTO_CACHE`, an absolute directory, the linker keeps that code
there, per module, and a link after the first takes seconds, generating
only what a change touched; the cache does not change the program.
`find_package(xclang)` makes the directory at configure time and adds the
target's linker's flag to every link of the directory that called it and of
its subdirectories: `-Wl,--thinlto-cache-dir=<dir>` for Linux and Windows
targets, `-Wl,-cache_path_lto,<dir>` for macOS ones.

```sh
cmake -G Ninja -B build -DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
```

The environment variable `XCLANG_THINLTO_CACHE` gives the first configure
of every build tree its value. Build trees, and Bazel builds
([Bazel](bazel.md#the-thinlto-cache), whose paths these are), can share one
directory: an entry is named by a hash of everything that makes it, and
written whole or not at all. The linker prunes it by LLVM's default policy,
every 20 minutes at most dropping what no link has read for a week.

In CI the directory goes in an `actions/cache` entry keyed on the xclang
version, with the build's other caches: a restored cache is not pruned
(restoring sets every file's last access), and a new release, whose links
need none of the old entries, starts an empty one.

```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.6-${{ github.sha }}
    restore-keys: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.6-
```

## What the package holds

| file | |
|---|---|
| `xclang-config.cmake` | `find_package(xclang)`: `xclang::std`, `xclang_add_std()`, `XCLANG_ROOT`, the ThinLTO cache |
| `xclang-config-version.cmake` | the release (toolchain archives only): `find_package(xclang 23.1)` |
| `toolchain.cmake` | the tree as the build's toolchain, `XCLANG_TARGET` |
| `xclang.cmake` | in `packages/cmake/` only: the download before `project()` |

tests/cmake builds with the package as above on every host, with CMake
3.28 and Ninja 1.11 and with the newest ones (cmake.yml), and links
tests/libclang with the ThinLTO cache and again from it.
