# CMake

xclang 的 CMake 包可将工具链设为主机或其他目标平台的构建编译器，并提供 `xclang::std`，无需开启 CMake 的实验性开关即可使用 `import std`。

要求：CMake 3.28 及以上、Ninja 1.11 及以上，并使用 Ninja 或 Ninja Multi-Config 生成器。

## 配置项目

调用 `find_package(xclang REQUIRED CONFIG)`（放在 `project()` 之后）并链接 `xclang::std` 即可使用 `import std`。示例项目位于 [examples/cmake](https://github.com/clice-io/xclang/tree/main/examples/cmake)，[快速开始](../guide/quick-start.md)中也构建了它：

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

当 xclang 的 `bin/` 排在 `PATH` 最前面时（`pixi shell` 会自动这样设置），指定编译器并执行构建：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++
cmake --build build
./build/hello
```

程序会输出 `hello from xclang: 3 targets, the first linux`。

CMake 不会自动选用 `clang`，因此请传入 `-DCMAKE_CXX_COMPILER=clang++`（包含 C 代码的项目还需传入 `-DCMAKE_C_COMPILER=clang`）。`find_package(xclang)` 会通过 `PATH` 查找包。当 xclang 不在 `PATH` 中时，请从工具链目录（下文的 `$XCLANG`）传入工具链文件，它会一次性设好编译器、二进制工具与包路径：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake
```

## 构建其他目标平台

配合工具链文件传入 `-DXCLANG_TARGET=<target>` 即可交叉编译：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-aarch64-w64-mingw32 --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-w64-mingw32
cmake --build build-aarch64-w64-mingw32
```

- 受支持的十个目标平台及其对主机的要求列在[交叉编译](../guide/cross-compiling.md#targets-and-hosts)中。
- 在 macOS 主机上，构建另一个 macOS 架构会设置 `CMAKE_OSX_ARCHITECTURES` 而非 `CMAKE_SYSTEM_NAME`，因此 CMake 不会将这次构建视为交叉编译。
- 在同架构的 Linux 主机上，由于 [musl 目标平台](../guide/cross-compiling.md#musl-targets)（`x86_64-unknown-linux-musl` 或 `aarch64-unknown-linux-musl`）生成的静态程序可直接在主机上运行，CMake 也不会将其视为交叉构建，`try_run` 与 `ctest` 均可直接执行。
- 交叉编译时（`CMAKE_CROSSCOMPILING` 为真），CMake 只会在目标平台的 sysroot 中搜索库、头文件与包。请使用 `<Package>_DIR` 将 CMake 指向为目标平台构建的依赖项，或将其安装前缀加入 `CMAKE_FIND_ROOT_PATH`。
- `xclang::std` 会针对当前构建的目标平台编译。
- 构建目录会固定首次配置时的目标平台。后续若传入不同的 `XCLANG_TARGET`，配置会报错停止；请换用新的构建目录，或使用 `cmake --fresh` 重新配置。

## 构建 MSVC 目标平台

将 `XCLANG_TARGET` 设为 `x86_64-pc-windows-msvc` 或 `aarch64-pc-windows-msvc` 前，请先运行 `$XCLANG/bin/xclang sdk fetch windows --accept-license` 获取 Windows SDK（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)）。在未下载 SDK 的 Windows 主机上，`clang` 会使用本机安装的 Visual Studio；在未下载 SDK 的 Linux 与 macOS 主机上，工具链文件会报错停止并打印 `xclang sdk fetch` 命令：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-msvc --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=x86_64-pc-windows-msvc
cmake --build build-msvc
```

- 编译器为 `clang` 与 `clang++`，而非 `clang-cl`。此时 `WIN32` 为真、`MSVC` 为假、`CMAKE_CXX_SIMULATE_ID` 为 `MSVC`，因此项目中在 `if(MSVC)` 下面向 `cl.exe` 编写的选项不会生效（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)）。
- 所有配置下 `CMAKE_MSVC_RUNTIME_LIBRARY` 默认均为 `MultiThreaded`，会链接[混合 CRT](../guide/cross-compiling.md#msvc-targets)。其他 `CMAKE_MSVC_RUNTIME_LIBRARY` 取值也同样可用。
- 默认 C++ 标准库为 `libc++`，`xclang::std` 会编译其 `std` 与 `std.compat` 模块。传入 `-DXCLANG_STDLIB=platform` 会切换到微软的 STL，并根据 STL 的模块清单构建 `xclang::std`（[使用系统的 C++ 标准库](#use-the-system-s-c-library)）。
- `Debug` 与 `RelWithDebInfo` 配置下的链接会传入 `-g` 并写出 `.pdb`。如果某个目标在其他配置下添加了 `-g`，还必须将 `-g` 加入 `target_link_options` 才会写出 PDB。

## 在 Linux 或 Windows 上构建 macOS 目标平台

将 `XCLANG_TARGET` 设为 `aarch64-apple-darwin` 或 `x86_64-apple-darwin` 前，请先运行 `$XCLANG/bin/xclang sdk fetch macos --accept-license` 获取 Apple 的 SDK（[Linux 与 Windows 主机上的 macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)）。若未下载 SDK，工具链文件会报错停止并打印 `xclang sdk fetch` 命令：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-macos --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-apple-darwin
cmake --build build-macos
```

- `APPLE` 为真，`CMAKE_SYSTEM_NAME` 为 `Darwin`，`CMAKE_OSX_ARCHITECTURES` 为目标平台的架构。`install_name_tool`、`lipo` 与 `libtool` 会分别设为工具链中的 `llvm-install-name-tool`、`llvm-lipo` 与 `llvm-libtool-darwin`，因此任何 CMake 步骤都不需要 `xcrun` 或 Xcode。
- `CMAKE_OSX_SYSROOT` 是 SDK 路径：优先使用显式指定的值，其次是 `SDKROOT`，再其次是工具链的 `sdk/macos`。CMake 会将其作为 `-isysroot` 传入，并只在 SDK 中搜索库、头文件与包。
- `CMAKE_OSX_DEPLOYMENT_TARGET` 与在 macOS 主机上一样用于设置部署目标版本；未设置时，生成的二进制文件面向 macOS 13.0。
- 由于每种架构都有各自的配置文件，每个构建目录只面向一种架构（[两种架构](../guide/cross-compiling.md#two-architectures)）。
- Objective-C（`OBJC`、`OBJCXX`）使用工具链的 `clang` 与 `clang++` 编译。

## 免预装 xclang 构建

将 `packages/cmake/xclang.cmake` 通过 `FetchContent` 在 `project()` 之前引入，CMake 就会在仅安装了 CMake 和 Ninja 的机器上自动下载主机工具链。`latest` 分支指向最新版本标签，也可以在 `GIT_TAG` 中锁定特定版本标签。示例项目位于 [examples/cmake-fetch](https://github.com/clice-io/xclang/tree/main/examples/cmake-fetch)：

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

`xclang.cmake` 会对照对应版本的 `SHA256SUMS` 校验压缩包，并将其解压到用户缓存中（每个版本与主机组合只解压一次）。此处同样可以传入 `-DXCLANG_TARGET=<target>` 交叉编译：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-x86_64-w64-mingw32 -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

| 变量 | |
|---|---|
| `XCLANG_CACHE_DIR` | 解压工具链的目录；也会从环境变量读取 |
| `XCLANG_ROOT` | 直接使用指定的已解压工具链，不再下载 |
| `XCLANG_URL` | 发布镜像的基础 URL |
| `XCLANG_VERSION` | 当 `GIT_TAG` 指定的是提交而非版本标签时，要下载的发布版本号 |

完整变量列表见 [CMake API](../reference/cmake-api.md)。

构建目录会固定首次配置时所用的工具链：当 `latest` 推进到新版本，或 `XCLANG_VERSION`、`XCLANG_ROOT`、`XCLANG_CACHE_DIR` 发生变化时，`xclang.cmake` 会在下载前报错停止。请换用新的构建目录，或使用 `cmake --fresh` 重新配置。如果构建已经指定了工具链文件（例如 vcpkg 的工具链文件），`xclang.cmake` 也会报错停止；此时请改用 `VCPKG_CHAINLOAD_TOOLCHAIN_FILE` 从 vcpkg 链式加载 xclang 的工具链文件。

## 使用系统的 C++ 标准库

配合工具链文件传入 `-DXCLANG_STDLIB=platform`，即可基于[平台的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)而非 xclang 的 `libc++` 构建。工具链文件会向每次编译和链接添加 `-stdlib=platform`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-system --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_STDLIB=platform
```

- 在 Linux（`glibc`）目标平台上，sysroot 为主机的 `/` 或 `CMAKE_SYSROOT`。在 musl 与 MinGW 目标平台上，必须设置 `CMAKE_SYSROOT` 并指向包含对应 `libstdc++` 的 sysroot（[平台的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)）。
- `xclang::std` 会根据平台标准库的模块清单（如 MSVC 目标平台上的微软 STL 或 GCC 15 的 `libstdc++`）构建。如果平台标准库没有模块清单，`find_package(xclang)` 会报错失败。
- `XCLANG_STDLIB=platform` 不能与 `XCLANG_RUNTIMES=source` 同时使用，且 `XCLANG_SANITIZER=address` 不会链接经 ASan 插桩的 `libc++`。

## 功能

- **C++20 模块与 `import std`**：链接 `xclang::std` 以使用 `import std`，用 `FILE_SET CXX_MODULES` 声明项目的模块接口，并在某个目标需要独立语言参数时调用 `xclang_add_std`（[C++20 模块](../features/modules.md#cmake)）。
- **Sanitizer**：配合工具链文件传入 `-DXCLANG_SANITIZER=address`、`undefined`、`thread`、`leak` 或 `memory`，即可对构建插桩并链接匹配的运行时库（[Sanitizer](../features/sanitizers.md#cmake)）。
- **从源码构建运行时库**：配合工具链文件传入 `-DXCLANG_RUNTIMES=source`，即可在配置阶段构建 `libc++`、`libc++abi` 与 `libunwind`，并启用加固模式、自定义 ABI 选项、`-fno-exceptions` 或 MemorySanitizer（[从源码构建运行时库](../features/runtimes-from-source.md#cmake)）。
- **调试符号**：调用 `xclang_debug_symbols(<program>)` 可在链接后生成 `<program>.gsym`，并在 macOS 目标平台上同时生成 `<program>.dSYM`（[调试](../features/debugging.md#cmake)）。
- **libclang 与 ThinLTO 缓存**：对解压后的 `libclang` 压缩包调用 `find_package(Clang)`，并传入 `-DXCLANG_THINLTO_CACHE=<dir>` 在多次链接之间缓存 ThinLTO 目标文件（[libclang](../features/libclang.md#cmake)、[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)）。
