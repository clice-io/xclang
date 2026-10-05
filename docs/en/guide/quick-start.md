# Quick start

From one machine, programs for every target, then a CMake project with
`import std`, for the host and for another target. Every command here is
run as written, in bash, on a machine of each of the six hosts by
[examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml)
([the run for 23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37354730630));
on Windows that is Git Bash.

You need [pixi](https://pixi.sh) and git; on macOS, Xcode or the Command
Line Tools, whose SDK the macOS targets build against.

## 1. Install

The files are in the repository's `examples/`:

```sh
git clone --depth 1 https://github.com/clice-io/xclang
cd xclang/examples/quickstart
```

A pixi workspace with xclang from the [clice conda channel](https://conda.clice.io):

<!-- file: examples/quickstart/pixi.toml -->
```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "23.1.2.6.*"
```

```sh
pixi install
```

`pixi run` (and `pixi shell`) puts xclang's `bin/` first in `PATH`. Other
ways to get xclang, without pixi, are in [installing](install.md).

## 2. A program for every target

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

```sh
pixi run clang++ -O2 hello.cpp -o hello
./hello
pixi run clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
pixi run clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

and on a macOS host also

```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

No sysroot to install, no `--sysroot` or `-L`: for each `--target`, clang
reads that target's config file in xclang's `bin/`, which names the
target's sysroot, libc++, libunwind, compiler-rt and lld, all in the
toolchain ([cross-compiling](cross-compiling.md)). On a Windows host the
first command writes `hello.exe`: a MinGW link adds `.exe` to a name
without an extension.

## 3. What they need to run

```sh
pixi run llvm-readobj --needed-libs hello-linux-x64 hello-windows-x64.exe
```

prints, on every host:

```
File: hello-linux-x64
Format: elf64-x86-64
Arch: x86_64
AddressSize: 64bit
LoadName: <Not found>
NeededLibraries [
  ld-linux-x86-64.so.2
  libc.so.6
  libdl.so.2
  libm.so.6
  libpthread.so.0
]

File: hello-windows-x64.exe
Format: COFF-x86-64
Arch: x86_64
AddressSize: 64bit
NeededLibraries [
  KERNEL32.dll
  api-ms-win-crt-convert-l1-1-0.dll
  api-ms-win-crt-environment-l1-1-0.dll
  api-ms-win-crt-heap-l1-1-0.dll
  api-ms-win-crt-locale-l1-1-0.dll
  api-ms-win-crt-math-l1-1-0.dll
  api-ms-win-crt-multibyte-l1-1-0.dll
  api-ms-win-crt-private-l1-1-0.dll
  api-ms-win-crt-runtime-l1-1-0.dll
  api-ms-win-crt-stdio-l1-1-0.dll
  api-ms-win-crt-string-l1-1-0.dll
  api-ms-win-crt-time-l1-1-0.dll
]
```

and a macOS program needs `/usr/lib/libSystem.B.dylib` alone. That is the
whole list: glibc (2.17 or later) on Linux, the OS and its UCRT on Windows
10 and later, libSystem on macOS 13 and later. No `libstdc++.so.6`,
`libc++.dll`, `libgcc_s_seh-1.dll` or `libwinpthread-1.dll`: libc++,
libunwind and the rest are in the programs, so each runs on any machine of
its target as a single file ([hermeticity](../design/hermeticity.md)).

## 4. A CMake project with import std

CMake 3.28 or later and Ninja 1.11 or later (`pip install cmake ninja`
gives both). The project is `examples/cmake`:

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

```sh
pixi run cmake -G Ninja -S ../cmake -B build -DCMAKE_CXX_COMPILER=clang++
pixi run cmake --build build
./build/hello
```

`xclang::std` is libc++'s `std` and `std.compat` modules, built for this
build with its language options: `import std` with no experimental CMake
switch ([C++20 modules](../features/modules.md)).

The same project for Windows on Arm, from Linux or macOS:

```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
pixi run cmake -G Ninja -S ../cmake -B build-aarch64-w64-mingw32 \
    --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" -DXCLANG_TARGET=aarch64-w64-mingw32
pixi run cmake --build build-aarch64-w64-mingw32
```

`XCLANG_TARGET` is any of the six targets, macOS ones on macOS hosts; on
the Windows hosts examples.yml builds `aarch64-unknown-linux-gnu` the same
way.

## Next

- [Why xclang](why-xclang.md): what the toolchain does for a build, and the
  evidence.
- [CMake](../integrations/cmake.md), with a toolchain downloaded by
  FetchContent and nothing installed; [Bazel](../integrations/bazel.md);
  [Meson and Make](../integrations/clang.md); [cargo](../integrations/cargo.md).
- [Cross-compiling](cross-compiling.md): targets, config files, tiers.
