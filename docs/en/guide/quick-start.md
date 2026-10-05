# Quick Start

From one machine, you build a program for every target, then a CMake
project with `import std`, for the host and for another target.

## Prerequisites

- [pixi](https://pixi.sh) and git.
- bash. On Windows, that is Git Bash.
- On macOS, Xcode or the Command Line Tools. The macOS targets build
  against their SDK.
- For step 4, CMake 3.28 or later and Ninja 1.11 or later.
  `pip install cmake ninja` gives both.

## 1. Install

The files are in the `examples/` directory of the repository:

<!-- not run: CI checks out the repository instead -->
```sh
git clone --depth 1 https://github.com/clice-io/xclang
cd xclang/examples/quickstart
```

`pixi.toml` is a pixi workspace with xclang from the
[clice conda channel](https://conda.clice.io):

<!-- file: examples/quickstart/pixi.toml -->
```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "23.1.2.6.*"
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi install
```

`pixi run` and `pixi shell` put xclang's `bin/` first in `PATH`. Other
ways to get xclang are in [installation](install.md).

## 2. Build a Program for Every Target

`hello.cpp` throws and catches an exception, which needs the C++ runtime:

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

Build it for this machine, and for each Linux and Windows target:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 hello.cpp -o hello
./hello
pixi run clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
pixi run clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

`./hello` prints `hello from xclang`. On a macOS host, build the macOS
targets too:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

No sysroot to install, no `--sysroot`, no `-L`. For each `--target`, clang
reads the config file of that target in xclang's `bin/`, which names its
sysroot and runtimes ([cross-compiling](cross-compiling.md)). On a Windows
host, the first command writes `hello.exe`, because a MinGW link adds
`.exe` to a name without one.

## 3. Check What the Programs Need

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --needed-libs hello-linux-x64 hello-windows-x64.exe
```

On every host, this prints the libraries each program loads. The output is
trimmed here:

```
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

A macOS program needs `/usr/lib/libSystem.B.dylib` alone. That is the whole
list: glibc 2.17 or later on Linux, Windows 10 or later with its UCRT, macOS
13 or later. There is no `libstdc++.so.6`, `libc++.dll`,
`libgcc_s_seh-1.dll` or `libwinpthread-1.dll`. Each program runs on any
machine of its target as a single file
([hermeticity](../design/hermeticity.md)).

## 4. Build a CMake Project with `import std`

The project is in `examples/cmake`:

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

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run cmake -G Ninja -S ../cmake -B build -DCMAKE_CXX_COMPILER=clang++
pixi run cmake --build build
./build/hello
```

It prints `hello from xclang: 3 targets, the first linux`. `xclang::std` is
the `std` and `std.compat` modules of libc++, built for this build with its
options, without an experimental CMake switch
([C++20 modules](../features/modules.md)).

Build the same project for Windows on Arm. `XCLANG` is the toolchain
directory that pixi installed:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
pixi run cmake -G Ninja -S ../cmake -B build-aarch64-w64-mingw32 \
    --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" -DXCLANG_TARGET=aarch64-w64-mingw32
pixi run cmake --build build-aarch64-w64-mingw32
```

`XCLANG_TARGET` takes any of the six targets; the macOS ones build on
macOS hosts. Copy `build-aarch64-w64-mingw32/hello.exe` to a Windows on
Arm machine, and it runs there with nothing installed.

## Next

- [Cross-Compiling](cross-compiling.md): the targets, and running what you
  built.
- [CMake](../integrations/cmake.md), [Bazel](../integrations/bazel.md),
  [Make and Meson](../integrations/clang.md),
  [Cargo](../integrations/cargo.md).
- [Why xclang?](why-xclang.md): what the toolchain does for a build.
