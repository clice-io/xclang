# Quick Start

From one machine, you will cross-compile a C++ program for Linux, Windows
and macOS targets, inspect its runtime dependencies, and build a CMake
project that uses `import std` for the host and for Windows on Arm.

## Prerequisites

- [pixi](https://pixi.sh) and git.
- bash (Git Bash on Windows).
- On macOS, Xcode or the Command Line Tools, whose SDK the macOS targets
  build against.
- For step 4, CMake 3.28 or later and Ninja 1.11 or later (`pip install
  cmake ninja`).

## 1. Install

Clone the repository and enter `examples/quickstart`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
git clone --depth 1 https://github.com/clice-io/xclang
cd xclang/examples/quickstart
```

`pixi.toml` configures a pixi workspace with xclang from the
[clice conda channel](https://conda.clice.io):

<!-- file: examples/quickstart/pixi.toml -->
```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "*"
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi install
```

`pixi run` and `pixi shell` put xclang's `bin/` first in `PATH`. Other ways
to get xclang are in [installation](install.md).

## 2. Build a Program for Other Targets

`hello.cpp` throws and catches an exception, which exercises the C++
standard library and unwinder:

<!-- file: examples/quickstart/hello.cpp -->
```cpp
#include <iostream>
#include <stdexcept>
#include <string>

int main() {
    try {
        throw std::runtime_error("hello from xclang");
    } catch (const std::exception& e) {
        std::cout << e.what() << '\n';
    }
}
```

Build it for the host, and for the glibc Linux and MinGW Windows targets:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 hello.cpp -o hello
./hello
pixi run clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
pixi run clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

`./hello` prints `hello from xclang`. On a Windows host, the first command
writes `hello.exe` because a MinGW link appends `.exe` when the output name
has no extension. On a macOS host, build the macOS targets too:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

You do not need to install a sysroot or pass `--sysroot` or `-L`. For each
`--target`, clang reads that target's config file in xclang's `bin/`, which
points it to the bundled sysroot and runtimes. Building static Linux
programs with musl, building for MSVC targets, and building for macOS from
Linux and Windows hosts are covered in
[cross-compiling](../targets/cross-compiling.md).

## 3. Check What the Programs Need

Inspect the shared libraries that the Linux and Windows binaries load at
run time:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --needed-libs hello-linux-x64 hello-windows-x64.exe
```

On every host, this prints only the OS's own libraries (trimmed here):

```text
File: hello-linux-x64
NeededLibraries [
  ld-linux-x86-64.so.2
  libc.so.6
  libdl.so.2
  libm.so.6
  libpthread.so.0
]
File: hello-windows-x64.exe
NeededLibraries [
  KERNEL32.dll
  api-ms-win-crt-convert-l1-1-0.dll
  api-ms-win-crt-environment-l1-1-0.dll
  ...
  api-ms-win-crt-time-l1-1-0.dll
]
```

A macOS binary loads only `/usr/lib/libSystem.B.dylib`. None of the
binaries depends on `libstdc++.so.6`, `libc++.dll`, `libgcc_s_seh-1.dll` or
`libwinpthread-1.dll`. Each binary runs as a single file on any machine of
its target: [glibc 2.17](../targets/linux.md) or later on Linux,
[Windows 10](../targets/windows.md) or later, or
[macOS 13](../targets/macos.md) or later
([hermeticity](../design/hermeticity.md)).

## 4. Build a CMake Project with `import std`

`examples/cmake` is a C++23 project that imports the standard library
module:

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

Configure, build and run it for the host:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run cmake -G Ninja -S ../cmake -B build -DCMAKE_CXX_COMPILER=clang++
pixi run cmake --build build
./build/hello
```

It prints `hello from xclang: 3 targets, the first linux`. `xclang::std`
compiles the `std` and `std.compat` modules of libc++ for this build with
its language options, without an experimental CMake switch
([C++20 modules](../features/modules.md)).

Now cross-compile the same project for Windows on Arm using xclang's CMake
toolchain file:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
pixi run cmake -G Ninja -S ../cmake -B build-aarch64-w64-mingw32 \
    --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" -DXCLANG_TARGET=aarch64-w64-mingw32
pixi run cmake --build build-aarch64-w64-mingw32
```

`XCLANG_TARGET` accepts any target of the toolchain, including the MSVC
targets and macOS targets from Linux and Windows once their SDK is fetched
([CMake](../integrations/cmake.md)). Copy
`build-aarch64-w64-mingw32/hello.exe` to a Windows on Arm machine, and it
runs there with nothing installed.

## Next

- [Cross-Compiling](../targets/cross-compiling.md): all targets, vendor
  SDKs, and running what you built.
- [CMake](../integrations/cmake.md), [Bazel](../integrations/bazel.md),
  [Make and Meson](../integrations/clang.md),
  [Cargo](../integrations/cargo.md).
- [What is xclang?](what-is-xclang.md): what the toolchain includes and
  what it does for a build.
