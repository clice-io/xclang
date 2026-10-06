# CMake

xclang's CMake package makes the toolchain the compiler of a build, for
the host or another target. It gives the build `import std`, without
CMake's experimental switches.

Requires: CMake 3.28 or later, Ninja 1.11 or later, and the Ninja or Ninja
Multi-Config generator.

## Set Up a Project

The project is
[examples/cmake](https://github.com/clice-io/xclang/tree/main/examples/cmake),
which the [quick start](../guide/quick-start.md) also builds:

<!-- file: examples/cmake/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(hello LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(xclang REQUIRED CONFIG)

add_executable(hello main.cpp)
target_link_libraries(hello PRIVATE xclang::std)
```

<!-- file: examples/cmake/main.cpp -->
```cpp
import std;

int main() {
    std::vector<std::string> targets{"windows", "linux", "macos"};
    std::ranges::sort(targets);
    try {
        throw std::runtime_error(std::format("{} targets, the first {}", targets.size(), targets[0]));
    } catch (const std::exception& e) {
        std::println("hello from xclang: {}", e.what());
    }
}
```

With xclang's `bin/` first in `PATH`, as `pixi shell` has it, name the
compiler and build:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++
cmake --build build
./build/hello
```

It prints `hello from xclang: 3 targets, the first linux`.

CMake does not pick clang by itself, so the compiler has to be named; a
project with C names `-DCMAKE_C_COMPILER=clang` too.
`find_package(xclang)` comes after `project()`, and finds the package
through `PATH`. Without `PATH`, use the toolchain file of the toolchain
directory, `$XCLANG` below. It sets the compilers, the binary tools and the
location of the package at once:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake
```

## Build for Another Target

`XCLANG_TARGET` names the target, with the toolchain file:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-aarch64-w64-mingw32 --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-w64-mingw32
cmake --build build-aarch64-w64-mingw32
```

- Linux and Windows targets build on every host. Released, macOS targets
  build on macOS hosts only ([why](../design/macos.md#the-sdk-is-xcode-s));
  from Linux and Windows hosts they are
  [unreleased](#build-for-macos-from-linux-or-windows). On a macOS host,
  the other macOS architecture is `CMAKE_OSX_ARCHITECTURES` to CMake, not
  cross-compiling.
- CMake looks for the libraries, headers and packages of another target
  in its sysroot only. Name a dependency built for the target with
  `<Package>_DIR`, or add its prefix to `CMAKE_FIND_ROOT_PATH`. A library
  found on the host has the wrong architecture or OS. The link then fails
  late or, worse, succeeds against the wrong headers.
- `xclang::std` is built for the target too.
- Tests built for another target run on a machine of that target, not on
  the host.

## Build for MSVC Targets

::: warning Unreleased
The [MSVC targets](../design/roadmap.md#msvc) are in no release.
:::

`x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` build with the
Windows SDK that the toolchain's `xclang` fetched
([MSVC targets](clang.md#msvc-targets)). Without it, the toolchain file
stops and says how to fetch it:

<!-- not run: unreleased; msvc.yml builds tests/cmake this way, through tests/msvc.ts -->
```sh
$XCLANG/bin/xclang sdk fetch windows --accept-license
cmake -G Ninja -B build-msvc --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=x86_64-pc-windows-msvc
cmake --build build-msvc
```

- The compilers are clang and clang++, not clang-cl. `WIN32` is true,
  `MSVC` false, and `CMAKE_CXX_SIMULATE_ID` is `MSVC`, so a project's
  `if(MSVC)` options, written for cl's command line, stay out
  ([why](../design/windows.md#msvc-targets)).
- The C runtime is the hybrid CRT in every configuration:
  `CMAKE_MSVC_RUNTIME_LIBRARY` is `MultiThreaded` unless set. Other values
  work too; CMake's own default would load the VC runtime's DLLs.
- `xclang::std` is the `std` and `std.compat` of Microsoft's STL.
- A link writes a PDB when it has `-g`: Debug and RelWithDebInfo do; a
  target given `-g` in another configuration needs it in
  `target_link_options` too.

## Build for macOS from Linux or Windows

::: warning Unreleased
[macOS targets from Linux and Windows hosts](../design/roadmap.md#macos-any-host)
are in no release.
:::

`aarch64-apple-darwin` and `x86_64-apple-darwin` build on Linux and Windows
hosts with Apple's SDK that the toolchain's `xclang` fetched
([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)). Without
it, the toolchain file stops and says how to fetch it:

<!-- not run: unreleased; macos.yml builds tests/cmake this way, through tests/macos.ts -->
```sh
$XCLANG/bin/xclang sdk fetch macos --accept-license
cmake -G Ninja -B build-macos --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-apple-darwin
cmake --build build-macos
```

- `APPLE` is true, `CMAKE_SYSTEM_NAME` is `Darwin`, and
  `CMAKE_OSX_ARCHITECTURES` is the target's architecture. No CMake step
  needs `xcrun` or Xcode: `install_name_tool`, `lipo` and `libtool` are
  the toolchain's `llvm-install-name-tool`, `llvm-lipo` and
  `llvm-libtool-darwin`, and `xclang_debug_symbols` makes the dSYM with
  its `dsymutil`.
- `CMAKE_OSX_SYSROOT` is the SDK, as on a macOS host: the one given, else
  `SDKROOT`, else the toolchain's `sdk/macos`. CMake passes it as
  `-isysroot`, and looks for libraries, headers and packages in it only.
- `CMAKE_OSX_DEPLOYMENT_TARGET` works as on a macOS host; without it,
  programs run on macOS 13.0 and later.
- One build is one architecture, since each has its config file. A
  universal program is two builds and `llvm-lipo -create`.
- Objective-C (`OBJC`, `OBJCXX`) compiles with the toolchain's clang.
- Tests run on a Mac, not on the host.

## Without xclang Installed

A project can download the toolchain itself, before `project()`, so it
configures on a machine with nothing but CMake and Ninja. FetchContent
fetches this repository at the tag of the release, and
`packages/cmake/xclang.cmake` downloads the host toolchain of that release:

<!-- file: examples/cmake-fetch/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)

set(XCLANG_VERSION 23.1.2.6)
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG ${XCLANG_VERSION})
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)

project(hello LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(xclang REQUIRED CONFIG)

add_executable(hello main.cpp)
target_link_libraries(hello PRIVATE xclang::std)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build
cmake --build build
./build/hello
```

`xclang.cmake` checks the archive against the `SHA256SUMS` of the release,
and unpacks it into the cache of the user, once per release and host.
Another build tree of the same release and host downloads nothing but the
checkout. `-DXCLANG_TARGET=<target>` builds for another target here too:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-x86_64-w64-mingw32 -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

| variable | |
|---|---|
| `XCLANG_CACHE_DIR` | where toolchains are unpacked; also an environment variable |
| `XCLANG_ROOT` | an unpacked toolchain to use instead of downloading one |
| `XCLANG_URL` | a mirror of the release |

The rest is in the [CMake API](../reference/cmake-api.md#xclang-cmake).
`GIT_TAG` may also name a later commit, with `XCLANG_VERSION` the release
whose toolchain it downloads; an earlier release works too.

## Use C++20 Modules and `import std`

`xclang::std` is a static library of the `std` and `std.compat` modules of
libc++, compiled from the sources that the module manifest of the compiler
names, for the target of the build. Link it, and `import std` works.
The C++ modules of the program are a `FILE_SET CXX_MODULES`, scanned by
clang-scan-deps. `cmake_minimum_required(VERSION 3.28)` turns on the
scanning of C++20 targets (CMP0155):

<!-- excerpt: examples/modules/CMakeLists.txt -->
```cmake
add_library(math STATIC)
target_sources(math PUBLIC FILE_SET CXX_MODULES FILES math.cppm math-ops.cppm)
target_link_libraries(math PUBLIC xclang::std)
```

[C++20 modules](../features/modules.md#cmake) has the whole project.

clang refuses a module file built with other language options than its
importer's ([matching options](../features/modules.md#behavior)). So:

- `xclang::std` is built with the settings of the directory that called
  `find_package(xclang)`, as they are at the end of its `CMakeLists.txt`:
  `CMAKE_CXX_STANDARD`, `CMAKE_CXX_EXTENSIONS`, `CMAKE_CXX_FLAGS` and
  `add_compile_options()`. Set them project-wide, not per CMake target.
- It asks its importers for its standard: C++23, or the
  `CMAKE_CXX_STANDARD` it was built with if that is 20 or later.
- A CMake target with other language options links a `std` of its own,
  whose `PUBLIC` options reach its importers. It links `std_noexcept`
  instead of `xclang::std`:

  <!-- excerpt: tests/cmake/noexcept/CMakeLists.txt -->
  ```cmake
  xclang_add_std(std_noexcept)
  target_compile_options(std_noexcept PUBLIC -fno-exceptions)
  ```

Before putting ccache in front of the compiler, read
[build caches and modules](../features/modules.md#build-caches-and-modules).

## Ship Debug Symbols

`xclang_debug_symbols(<program>)` makes the debug symbols of a program
after each of its links: `<program>.gsym` next to it, and for a macOS
target `<program>.dSYM` too.

<!-- excerpt: examples/debug-symbols/CMakeLists.txt -->
```cmake
add_executable(tool tool.cpp)
target_compile_options(tool PRIVATE -g)
xclang_debug_symbols(tool)
```

`GSYM_ARGS --merged-functions` keeps every name of the functions that
identical code folding merged. For a macOS target, the link keeps the
objects of ThinLTO in `<build dir>/tool.lto`, which dsymutil reads.
[Debugging](../features/debugging.md#cmake) has the whole example.

## Link libclang

A tool on libclang finds it with `find_package(Clang)`, with
`CMAKE_PREFIX_PATH` naming the unpacked libclang archive
([libclang](../features/libclang.md#cmake)).

## Speed Up libclang Links

Name a directory for the ThinLTO cache when configuring,
`-DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto`, and a link after the
first takes seconds ([libclang](../features/libclang.md#cmake) has a whole
tool built this way). `find_package(xclang)` makes the directory at
configure time. It adds the
cache flag to every link of the directory that called it, and of its
subdirectories ([the ThinLTO cache](../features/thinlto-cache.md)).

## Troubleshooting

- **`C++26 was disabled in precompiled file`**: a CMake target asks for a
  newer standard, or other language options, than `xclang::std` was built
  with. Set them project-wide, or use `xclang_add_std`.
- **A toolchain file is already set**: `xclang.cmake` stops if the build
  has one, such as vcpkg's. Chain-load xclang's from vcpkg instead, with
  `VCPKG_CHAINLOAD_TOOLCHAIN_FILE`.
- **A library is not found for another target**: CMake searches the
  sysroot only. Build the library for the target, and name it with
  `<Package>_DIR`.
- More symptoms are in the [FAQ](../guide/faq.md).

## Not Yet Supported

| | status |
|---|---|
| [MSVC-ABI targets](../design/roadmap.md#msvc) for `XCLANG_TARGET` | Unreleased |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) for `XCLANG_TARGET` | Unreleased |
| [Relative paths in debug information](../design/roadmap.md#cmake-relative-paths), as Bazel builds have | Planned |
| [Fetched targets](../design/roadmap.md#fetched-targets-in-build-systems) beyond the six | Planned |

## Known Limitations

- C++20 modules build only with the Ninja and Ninja Multi-Config
  generators.
- ccache never caches a module interface, and before 4.14 it serves the
  stale object of an importer
  ([build caches and modules](../features/modules.md#build-caches-and-modules)).

## See Also

- [CMake API](../reference/cmake-api.md): every variable and function.
- [CI](ci.md): the downloaded toolchain and the ThinLTO cache kept between
  runs.
