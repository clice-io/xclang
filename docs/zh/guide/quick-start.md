# 快速开始

本节将在同一台机器上安装 xclang，把一个 C++ 程序交叉编译到 Linux、Windows 和 macOS 目标平台，查看产物的运行时依赖，并为当前主机和 Windows on Arm 构建一个使用 `import std` 的 CMake 项目。

## 前置条件

- [pixi](https://pixi.sh) 与 git。
- bash（Windows 上可使用 Git Bash）。
- macOS 主机需安装 Xcode 或 Command Line Tools，macOS 目标平台编译时会使用其中的 SDK。
- 第 4 步需要 CMake 3.28 及以上与 Ninja 1.11 及以上（`pip install
  cmake ninja`）。

## 1. 使用 pixi 安装

克隆仓库并进入 `examples/quickstart` 目录：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
git clone --depth 1 https://github.com/clice-io/xclang
cd xclang/examples/quickstart
```

`pixi.toml` 配置了一个 pixi 工作区，从 [clice conda 频道](https://conda.clice.io)安装 `xclang`：

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

软件包会将包含所有内置目标平台的主机压缩包解压到 `$PREFIX/opt/xclang`（即*工具链目录*，命令行中记作 `$XCLANG`；见[压缩包目录结构](../reference/layout.md)）。`pixi run` 与 `pixi shell` 会把 `$PREFIX/opt/xclang/bin` 放在 `PATH` 最前面，而不会向 `$PREFIX/bin` 写入任何文件，因此不会影响 conda-forge 的编译器。同一频道还发布了 `llvm-option-inc`（`noarch`），会将选项表安装到 `$PREFIX/include/llvm-options-td`（[libclang](../features/libclang.md#the-option-tables)）。

## 2. 构建其他目标平台的程序

`hello.cpp` 会抛出并捕获一个异常，用来验证 C++ 标准库与栈展开库（unwinder）：

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

为当前主机，以及 glibc Linux 和 MinGW Windows 目标平台编译这个程序：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 hello.cpp -o hello
./hello
pixi run clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
pixi run clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

`./hello` 会输出 `hello from xclang`。在 Windows 主机上，由于输出文件名不带扩展名时 MinGW 链接会自动补上 `.exe`，第一条命令会生成 `hello.exe`。在 macOS 主机上，还可以接着编译 macOS 目标平台：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

无需安装 sysroot，也无需传入 `--sysroot` 或 `-L`。针对每个 `--target`，`clang` 都会读取 xclang 的 `bin/` 目录下对应目标平台的配置文件，从而找到内置的 sysroot 与运行时库。使用 musl 构建静态 Linux 程序、构建 MSVC 目标平台，以及在 Linux 和 Windows 主机上构建 macOS 程序的做法见[交叉编译](cross-compiling.md)。

## 3. 检查程序的运行时依赖

查看 Linux 与 Windows 产物在运行时加载的共享库：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --needed-libs hello-linux-x64 hello-windows-x64.exe
```

在任何主机上，输出结果都只有操作系统自带的库（此处有精简）：

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

macOS 产物只加载 `/usr/lib/libSystem.B.dylib`。所有产物都不依赖 `libstdc++.so.6`、`libc++.dll`、`libgcc_s_seh-1.dll` 或 `libwinpthread-1.dll`。每个可执行文件都可以作为单个文件在对应目标平台的任意机器上直接运行：Linux 上只需 [glibc 2.17](cross-compiling.md#linux) 及以上，Windows 上只需 [Windows 10](cross-compiling.md#windows) 及以上，macOS 上只需 [macOS 13](cross-compiling.md#macos) 及以上（[封闭性](../design/hermeticity.md)）。

## 4. 构建使用 `import std` 的 CMake 项目

`examples/cmake` 是一个导入标准库模块的 C++23 项目：

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

针对当前主机配置、构建并运行这个项目：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run cmake -G Ninja -S ../cmake -B build -DCMAKE_CXX_COMPILER=clang++
pixi run cmake --build build
./build/hello
```

程序会输出 `hello from xclang: 3 targets, the first linux`。`xclang::std` 会按当前构建的语言选项为本次构建编译 `libc++` 的 `std` 与 `std.compat` 模块，无需开启实验性的 CMake 开关（[C++20 模块](../features/modules.md)）。

接下来使用 xclang 的 CMake 工具链文件，将同一个项目交叉编译到 Windows on Arm：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
pixi run cmake -G Ninja -S ../cmake -B build-aarch64-w64-mingw32 \
    --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" -DXCLANG_TARGET=aarch64-w64-mingw32
pixi run cmake --build build-aarch64-w64-mingw32
```

`XCLANG_TARGET` 接受工具链支持的任意目标平台；下载好对应 SDK 后，也包括 MSVC 目标平台以及在 Linux 和 Windows 上构建的 macOS 目标平台（[CMake](../integrations/cmake.md)）。将 `build-aarch64-w64-mingw32/hello.exe` 拷贝到 Windows on Arm 机器上，无需安装任何额外组件即可直接运行。

## 其他安装方式

### 发布压缩包

每个 [GitHub 版本](https://github.com/clice-io/xclang/releases)都会为各主机平台发布一个工具链压缩包 `xclang-<version>-<host>.tar.xz`（约 100 MB；见[版本发布](../reference/releases.md)）。将其解压到任意位置即可直接运行 `xclang/bin/` 下的工具。在 Linux 上：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
v=$(sed -n "s/^[0-9a-f]*  xclang-\(.*\)-$h\.tar\.xz$/\1/p" SHA256SUMS)
curl -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
sha256sum -c --ignore-missing SHA256SUMS
tar -xf xclang-$v-$h.tar.xz
xclang/bin/clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

在 macOS 上，使用 `shasum -a 256 -c --ignore-missing SHA256SUMS` 校验摘要。在 Windows 上使用 PowerShell，其中 `tar` 是 `C:\Windows\System32\tar.exe`：

<!-- excerpt: .github/workflows/examples.yml -->
```powershell
$h = "x86_64-w64-mingw32"
curl.exe -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
$v = (Select-String -Path SHA256SUMS -Pattern "  xclang-(.+)-$h\.tar\.xz$").Matches[0].Groups[1].Value
curl.exe -LO https://github.com/clice-io/xclang/releases/download/$v/xclang-$v-$h.tar.xz
$sum = (Get-FileHash xclang-$v-$h.tar.xz -Algorithm SHA256).Hash.ToLower()
if (-not (Select-String -SimpleMatch -Quiet "$sum  xclang-$v-$h.tar.xz" SHA256SUMS)) { throw "sha256 mismatch" }
tar -xf xclang-$v-$h.tar.xz
xclang\bin\clang++ --target=aarch64-unknown-linux-gnu hello.cpp -o hello
```

如需锁定特定版本，将 `v` 设为对应的版本号并从 `releases/download/$v` 下载 `SHA256SUMS` 即可。Windows 压缩包不含符号链接，无需管理员权限或开发者模式即可解压（[启动器](../design/windows.md#the-launchers)）。在 Windows 上，`xclang sdk fetch` 下载的厂商 SDK 通过记录绝对路径的目录联接（junction）访问；移动工具链目录后，请运行 `xclang sdk use <name>`（并重新下载 macOS SDK；见 [`xclang` 命令](../reference/xclang-command.md#the-sdk-in-use)）。

### CMake FetchContent

CMake 项目可以在调用 `project()` 之前下载主机工具链，这样机器上只需安装 CMake、Ninja 和 Git 即可完成构建配置（[CMake](../integrations/cmake.md#without-xclang-installed)）：

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG latest)
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

`xclang.cmake` 会下载对应版本的主机压缩包，对照这个版本的 `SHA256SUMS` 校验后解压到用户缓存目录中，每个版本与主机平台组合只解压一次。

### Bazel

在 `.bazelrc` 中添加位于 [bazel.clice.io](https://bazel.clice.io) 的 clice registry，并在 `MODULE.bazel` 中声明 `xclang`（[Bazel](../integrations/bazel.md)）：

<!-- excerpt: examples/bazel/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

<!-- excerpt: examples/bazel/MODULE.bazel -->
```python
bazel_dep(name = "xclang", version = "23.1.5.1")
```

模块会下载主机压缩包并校验锁定的 `sha256`，然后将其注册为所有目标平台的 C++ 工具链。

## 验证安装

从 `PATH` 或工具链目录运行 `clang++ --version`，会输出编译器版本以及表示其所在 `bin/` 目录的 `InstalledDir`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ --version
```

`xclang --version` 会输出其自身版本、工具链目录以及所属版本号 `<llvm version>.<revision>`（[版本发布](../reference/releases.md)）。

## 下一步

- [交叉编译](cross-compiling.md)：所有目标平台、厂商 SDK，以及如何运行编译出的程序。
- [CMake](../integrations/cmake.md)、[Bazel](../integrations/bazel.md)、[Make 与 Meson](../integrations/clang.md)、[Cargo](../integrations/cargo.md)。
- [版本发布](../reference/releases.md)：版本号、分发渠道、发布文件与下载校验。
