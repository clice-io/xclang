# CMake

xclang's CMake package sets the toolchain as a build's compiler for the host or another target, and provides `xclang::std` for `import std` without CMake's experimental switches.

Requires: CMake 3.28 or later, Ninja 1.11 or later, and the Ninja or Ninja Multi-Config generator.

## Set Up a Project

Call `find_package(xclang REQUIRED CONFIG)` after `project()` and link `xclang::std` to use `import std`. The project is [examples/cmake](https://github.com/clice-io/xclang/tree/main/examples/cmake), which the [quick start](../guide/quick-start.md) also builds:

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

With xclang's `bin/` first in `PATH`, as `pixi shell` sets it, name the compiler and build:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++
cmake --build build
./build/hello
```

It prints `hello from xclang: 3 targets, the first linux`.

CMake does not pick `clang` by itself, so pass `-DCMAKE_CXX_COMPILER=clang++`, and `-DCMAKE_C_COMPILER=clang` for a project with C. `find_package(xclang)` finds the package through `PATH`. When xclang is not in `PATH`, pass the toolchain file from the toolchain directory (`$XCLANG` below). It sets the compilers, the binary tools and the package location at once:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake
```

## Build for Another Target

Pass `-DXCLANG_TARGET=<target>` with the toolchain file to cross-compile:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-aarch64-w64-mingw32 --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-w64-mingw32
cmake --build build-aarch64-w64-mingw32
```

- The ten supported targets and what each needs on the host are listed in [Cross-Compiling](../targets/cross-compiling.md#targets-and-hosts).
- On a macOS host, building for the other macOS architecture sets `CMAKE_OSX_ARCHITECTURES` rather than `CMAKE_SYSTEM_NAME`, so CMake does not treat the build as cross-compiling.
- On a Linux host of the same architecture, a [musl target](../targets/linux.md#musl-targets) (`x86_64-unknown-linux-musl` or `aarch64-unknown-linux-musl`) is not a cross build to CMake either, because the static programs it produces run on the host. `try_run` and `ctest` run there.
- When cross-compiling (`CMAKE_CROSSCOMPILING` is true), CMake searches only the target's sysroot for libraries, headers and packages. Point CMake to dependencies built for the target with `<Package>_DIR`, or add their prefix to `CMAKE_FIND_ROOT_PATH`.
- `xclang::std` is built for the target of the build.
- A build directory keeps the target of its first configure. Passing another `XCLANG_TARGET` later stops the configure; use a new build directory, or re-configure with `cmake --fresh`.

## Build for MSVC Targets

Set `XCLANG_TARGET` to `x86_64-pc-windows-msvc` or `aarch64-pc-windows-msvc` after fetching the Windows SDK with `$XCLANG/bin/xclang sdk fetch windows --accept-license` ([MSVC targets](../targets/windows.md#msvc-targets)). On a Windows host without a fetched SDK, `clang` uses an installed Visual Studio; on Linux and macOS hosts without the SDK, the toolchain file stops and prints the `xclang sdk fetch` command:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-msvc --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=x86_64-pc-windows-msvc
cmake --build build-msvc
```

- The compilers are `clang` and `clang++`, not `clang-cl`. `WIN32` is true, `MSVC` is false, and `CMAKE_CXX_SIMULATE_ID` is `MSVC`, so a project's `if(MSVC)` options written for `cl.exe` stay out ([MSVC targets](../targets/windows.md#msvc-targets)).
- `CMAKE_MSVC_RUNTIME_LIBRARY` defaults to `MultiThreaded` in every configuration, which links the [hybrid CRT](../targets/windows.md#the-hybrid-crt-and-c-runtime-flags). Other `CMAKE_MSVC_RUNTIME_LIBRARY` values work too.
- The default C++ library is `libc++`, and `xclang::std` builds its `std` and `std.compat` modules. `-DXCLANG_STDLIB=platform` switches to Microsoft's STL and builds `xclang::std` from the STL's module manifest ([the system's C++ library](#use-the-system-s-c-library)).
- Links in `Debug` and `RelWithDebInfo` pass `-g` and write a `.pdb`. A target that adds `-g` in another configuration must also add `-g` to `target_link_options` to write a PDB.

## Build for macOS from Linux or Windows

Set `XCLANG_TARGET` to `aarch64-apple-darwin` or `x86_64-apple-darwin` after fetching Apple's SDK with `$XCLANG/bin/xclang sdk fetch macos --accept-license` ([macOS on Linux and Windows hosts](../targets/macos.md#on-linux-and-windows-hosts)). Without the SDK, the toolchain file stops and prints the `xclang sdk fetch` command:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-macos --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-apple-darwin
cmake --build build-macos
```

- `APPLE` is true, `CMAKE_SYSTEM_NAME` is `Darwin`, and `CMAKE_OSX_ARCHITECTURES` is the target's architecture. `install_name_tool`, `lipo` and `libtool` are set to the toolchain's `llvm-install-name-tool`, `llvm-lipo` and `llvm-libtool-darwin`, so no CMake step requires `xcrun` or Xcode.
- `CMAKE_OSX_SYSROOT` is the SDK path: the value given, else `SDKROOT`, else the toolchain's `sdk/macos`. CMake passes it as `-isysroot` and searches only the SDK for libraries, headers and packages.
- `CMAKE_OSX_DEPLOYMENT_TARGET` sets the deployment target as on a macOS host; when unset, binaries target macOS 13.0.
- Each build directory targets one architecture, because each architecture has its own config file ([two architectures](../targets/macos.md#two-architectures)).
- Objective-C (`OBJC`, `OBJCXX`) compiles with the toolchain's `clang` and `clang++`.

## Without xclang Installed

Include `packages/cmake/xclang.cmake` via `FetchContent` before `project()` so CMake downloads the host toolchain itself on a machine with only CMake and Ninja. `latest` is a branch pointing at the newest release tag, or you can pin a specific release tag in `GIT_TAG`. The project is [examples/cmake-fetch](https://github.com/clice-io/xclang/tree/main/examples/cmake-fetch):

<!-- file: examples/cmake-fetch/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)

include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG latest)
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

`xclang.cmake` verifies the archive against the release's `SHA256SUMS` and unpacks it into the user cache once per release and host. `-DXCLANG_TARGET=<target>` cross-compiles here too:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-x86_64-w64-mingw32 -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

| variable | |
|---|---|
| `XCLANG_CACHE_DIR` | directory where toolchains are unpacked; also read from the environment |
| `XCLANG_ROOT` | an unpacked toolchain to use instead of downloading one |
| `XCLANG_URL` | base URL of a release mirror |
| `XCLANG_VERSION` | release version to download when `GIT_TAG` names a commit rather than a release tag |

See the [CMake API](../reference/cmake-api.md) for the full variable list.

## Use the System's C++ Library

Pass `-DXCLANG_STDLIB=platform` with the toolchain file to build against the [platform's C++ library](../targets/cross-compiling.md#the-platform-s-c-library) instead of xclang's `libc++`. The toolchain file adds `-stdlib=platform` to every compile and link:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-system --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_STDLIB=platform
```

- For Linux (`glibc`) targets, the sysroot is the host's `/` or `CMAKE_SYSROOT`. For musl and MinGW targets, `CMAKE_SYSROOT` is required and must point to a sysroot containing their `libstdc++` ([the platform's C++ library](../targets/cross-compiling.md#the-platform-s-c-library)).
- `xclang::std` is built from the platform library's module manifest, such as Microsoft's STL on MSVC targets or GCC 15's `libstdc++`. `find_package(xclang)` fails when the platform library has no module manifest.
- `XCLANG_STDLIB=platform` cannot be combined with `XCLANG_RUNTIMES=source`, and `XCLANG_SANITIZER=address` does not link an ASan-instrumented `libc++`.


## Features

- **C++20 modules and `import std`**: Link `xclang::std` for `import std`, declare project module interfaces with `FILE_SET CXX_MODULES`, and call `xclang_add_std` when a target needs its own language flags ([C++20 Modules](../features/modules.md#cmake)).
- **Sanitizers**: Pass `-DXCLANG_SANITIZER=address`, `undefined`, `thread`, `leak` or `memory` with the toolchain file to instrument the build and link the matching runtime ([Sanitizers](../features/sanitizers.md#cmake)).
- **Runtimes from source**: Pass `-DXCLANG_RUNTIMES=source` with the toolchain file to build `libc++`, `libc++abi` and `libunwind` at configure time with hardening modes, custom ABI options, `-fno-exceptions`, or MemorySanitizer ([Runtimes from Source](../features/runtimes-from-source.md#cmake)).
- **Debug symbols**: Call `xclang_debug_symbols(<program>)` to generate `<program>.gsym` after linking, and `<program>.dSYM` for macOS targets ([Debugging](../features/debugging.md#cmake)).
- **libclang and the ThinLTO cache**: Find an unpacked `libclang` archive with `find_package(Clang)`, and pass `-DXCLANG_THINLTO_CACHE=<dir>` to cache ThinLTO objects across links ([libclang](../features/libclang.md#cmake), [the ThinLTO cache](../features/libclang.md#the-thinlto-cache)).

## Troubleshooting

- **`C++26 was disabled in precompiled file`**: a CMake target uses a newer standard or different language flags than `xclang::std` was built with. Set language flags project-wide before `find_package(xclang)`, or create a separate `std` target with `xclang_add_std` ([C++20 Modules](../features/modules.md#cmake)).
- **A toolchain file is already set**: `xclang.cmake` stops if `CMAKE_TOOLCHAIN_FILE` is already set, such as by vcpkg. Chain-load xclang's toolchain file from vcpkg instead with `VCPKG_CHAINLOAD_TOOLCHAIN_FILE`.
- **Configured with another xclang**: a build directory keeps the toolchain of its first configure. When `latest` moves to a new release, or `XCLANG_VERSION`, `XCLANG_ROOT` or `XCLANG_CACHE_DIR` changes, `xclang.cmake` stops before downloading anything. Use a new build directory, or re-configure with `cmake --fresh`.
- **A library is not found for another target**: CMake searches only the target's sysroot when cross-compiling. Build the library for the target and point CMake to it with `<Package>_DIR` or `CMAKE_FIND_ROOT_PATH`.
- More symptoms are in [Troubleshooting](../guide/troubleshooting.md).

## Known Limitations

- C++20 modules build only with the Ninja and Ninja Multi-Config generators.
- ccache never caches a module interface, and before 4.14 it can serve a stale object for an importer ([build caches and modules](../features/modules.md#build-caches-and-modules)).
- [Relative paths in debug information](../design/roadmap.md#cmake-relative-paths), [fetched targets](../design/roadmap.md#fetched-targets-in-build-systems) beyond the ten built-in targets, and [runtimes from source for the MSVC targets](../design/roadmap.md#runtimes-msvc) are on the roadmap.

## See Also

- [CMake API](../reference/cmake-api.md): every variable, target and function.
- [CI](ci.md): keeping the downloaded toolchain and the ThinLTO cache between workflow runs.
