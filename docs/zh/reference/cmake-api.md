# CMake API

本页列出 xclang 的 CMake 包定义的所有内容。具体用法见 [CMake](../integrations/cmake.md)。

CMake 包位于每个工具链目录（以及 conda 软件包）的 `lib/cmake/xclang` 下，同时也位于代码仓库各个版本标签的 `packages/cmake/` 下。它要求 CMake 3.28 及以上；构建 C++20 模块时还要求使用 Ninja 或 Ninja Multi-Config 生成器，且 Ninja 版本为 1.11 及以上。

## 文件

| 文件 | 说明 |
|---|---|
| `xclang-config.cmake` | 供 `find_package(xclang)` 加载：定义 `xclang::std`、`xclang_add_std()`、`xclang_debug_symbols()`、`XCLANG_ROOT` 以及 ThinLTO 缓存配置 |
| `xclang-config-version.cmake` | 记录版本号，供 `find_package(xclang 23.1)` 匹配版本（仅存在于工具链压缩包中） |
| `toolchain.cmake` | 将工具链目录设为当前构建的工具链，面向主机或 `XCLANG_TARGET` |
| `runtimes.cmake` | 由 `toolchain.cmake` 引入：负责从源码构建运行时库以及配置构建所用的 sanitizer |
| `runtimes-cxx.cmake`, `runtimes-compiler-rt.cmake` | xclang 自身构建 libc++ 与 compiler-rt 时使用的 CMake 缓存文件，供 `runtimes.cmake` 构建运行时库使用（仅存在于工具链压缩包中） |
| `xclang.cmake` | 仅位于 `packages/cmake/` 下：通过 FetchContent 检出后在 `project()` 之前引入，负责自动下载工具链 |

## `find_package(xclang)`

需在 `project()` 或 `enable_language(CXX)` 之后调用，且构建所用的 C++ 编译器必须是 xclang 的 `clang++`。它会通过 `PATH`（由 `$XCLANG/bin` 推导至 `$XCLANG/lib/cmake/xclang`）、`xclang_ROOT` 或 `CMAKE_PREFIX_PATH` 查找包。

| 名称 | 类型 | |
|---|---|---|
| `xclang::std` | CMake 目标 | 针对当前构建目标平台的 libc++ `std` 与 `std.compat` 模块静态库（启用 `-stdlib=platform` 或 `XCLANG_STDLIB=platform` 时则为平台标准库的模块，如 MSVC 目标平台上的微软 STL）；仅当被其他目标链接时才会实际编译（[语言选项](../features/modules.md#cmake)） |
| `xclang_add_std(<name>)` | 函数 | 创建另一个标准库模块目标；其上的 `PUBLIC` 编译选项会传递给所有 import 它的目标 |
| `xclang_debug_symbols(<program> [GSYM_ARGS <option>...])` | 函数 | 在每次链接 CMake 目标 `<program>` 后：调用单线程的 llvm-gsymutil 在其旁生成 `<program>.gsym`（每次运行产出逐字节相同的文件，`GSYM_ARGS` 追加在 `--num-threads=1` 之后），并将日志输出到 `<program>.gsym.log`；在 macOS 目标平台上会先生成 `<program>.dSYM`（[调试](../features/debugging.md#usage)）；在 MSVC 目标平台上不执行任何操作，由链接步骤直接写出 PDB |
| `XCLANG_ROOT` | 变量 | 工具链目录 |
| `XCLANG_THINLTO_CACHE` | 缓存变量 | 链接器 ThinLTO 缓存目录的绝对路径；初始值取自同名环境变量（[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)） |

`xclang::std` 要求 import 它的目标使用 C++23（若构建它时所在目录的 `CMAKE_CXX_STANDARD` 为 20 或更高，则要求对应的标准版本）。设置 `XCLANG_RUNTIMES=source` 时，它会基于从源码构建的运行时库变体的模块源码与头文件编译；这一选项必须配合工具链文件使用，否则 `find_package(xclang)` 会报错失败。

## `toolchain.cmake`

```text
cmake -G Ninja -B build --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake [-DXCLANG_TARGET=<target>]
```

| 变量 | |
|---|---|
| `XCLANG_TARGET` | 可选 `x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`、`x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl`、`x86_64-w64-mingw32`、`aarch64-w64-mingw32`、`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-pc-windows-msvc` 或 `aarch64-pc-windows-msvc`，默认为当前主机。MSVC 目标平台以及在 Linux 和 Windows 主机上构建的 macOS 目标平台会使用由工具链 `xclang` 命令下载的 SDK；未下载 SDK 的 Windows 主机在构建 MSVC 目标平台时则会使用本机安装的 Visual Studio。在同架构的 Linux 主机上构建 musl 目标平台不视为交叉编译，主机可直接运行其生成的静态程序（`try_run` 与测试）。构建目录会固定首次配置时的目标平台，后续若改为其他目标平台则会停止配置（请换用新构建目录或运行 `cmake --fresh`） |
| `XCLANG_ROOT` | 工具链目录，在工具链目录之外使用工具链文件时需指定；相对路径相对于构建目录解析 |
| `XCLANG_STDLIB` | 默认为 `libc++`：使用 xclang 的 libc++ 及内置 sysroot。设为 `platform` 时：使用平台的 C++ 标准库，向每次编译和链接传入 `-stdlib=platform`（[使用系统的 C++ 标准库](../integrations/cmake.md#use-the-system-s-c-library)）；Linux 目标平台不再设置指向工具链的 `CMAKE_SYSROOT`，musl 与 MinGW 目标平台则要求用户自行指定 sysroot；当平台标准库带有模块清单（如 GCC 15 的 libstdc++）时，`xclang::std` 使用平台标准库的模块，否则 `find_package(xclang)` 会报错失败。不可与 `XCLANG_RUNTIMES=source` 同时使用 |
| `XCLANG_RUNTIMES`, `XCLANG_SANITIZER`, ... | 从源码构建运行时库及构建所用的 sanitizer 选项（[见下文](#runtimes-from-source)） |

它会将 C、C++ 与汇编编译器以及各二进制工具设为工具链目录中的对应程序：`llvm-ar`、`llvm-ranlib`、`llvm-nm`、`llvm-objcopy`、`llvm-objdump`、`llvm-readelf`、`llvm-strip`、`llvm-addr2line` 与 `llvm-dlltool`；在 MinGW 目标平台上将 RC 编译器设为 `llvm-windres`；在 macOS 目标平台上设置 Objective-C 编译器（clang 与 clang++）以及 `llvm-libtool-darwin`、`llvm-lipo` 和 `llvm-install-name-tool`（Apple 自带的 `libtool` 无法读取高版本 LLVM 生成的 bitcode）。

当构建非当前主机的 Linux 或 Windows 目标平台时，它还会设置 `CMAKE_SYSTEM_NAME`、`CMAKE_SYSTEM_PROCESSOR`、`CMAKE_<LANG>_COMPILER_TARGET` 与 `CMAKE_SYSROOT`（指向目标平台的 sysroot），并将 `CMAKE_FIND_ROOT_PATH_MODE_{LIBRARY,INCLUDE,PACKAGE}` 设为 `ONLY`，使库文件、头文件和包仅在 sysroot 内搜索，而可执行程序仍在主机上查找。在 macOS 主机上构建另一个 macOS 架构则会设置 `CMAKE_OSX_ARCHITECTURES`，CMake 不将其视为交叉编译。编译器实际使用的 sysroot、C++ 标准库、运行时库和链接器均由目标平台的配置文件指定，而非由工具链文件直接传入。

在 Linux 或 macOS 主机上构建 MSVC 目标平台时，如果工具链的 `sdk/windows` 下没有对应目标平台的 SDK，配置会立即报错停止；在未下载 SDK 的 Windows 主机上，clang 会自动查找本机安装的 Visual Studio。它会将 RC 编译器设为 `llvm-rc`，由 CMake 对目标平台 clang 预处理后的输出运行。若未显式设置，`CMAKE_MSVC_RUNTIME_LIBRARY` 默认为 `MultiThreaded`；使用 `MultiThreadedDebug` 或 `MultiThreadedDebugDLL` 链接时会自动传入 `/nodefaultlib:ucrt.lib`。除在 Windows 主机上构建本机架构（CMake 不视为交叉构建）或未下载 SDK 的情况外，SDK 路径都会加入 `CMAKE_FIND_ROOT_PATH`。

在 Linux 或 Windows 主机上构建 macOS 目标平台时，`CMAKE_OSX_SYSROOT` 优先取已指定的值，其次取 `SDKROOT`，再其次取工具链的 `sdk/macos`（若此处没有 SDK 则停止配置）。它会将 `CMAKE_SYSTEM_NAME` 设为 `Darwin`，将 `CMAKE_SYSTEM_PROCESSOR` 与 `CMAKE_OSX_ARCHITECTURES` 设为 `arm64` 或 `x86_64`，为 C、C++、ASM 与 Objective-C 设置 `CMAKE_<LANG>_COMPILER_TARGET`，并将 SDK 加入 `CMAKE_FIND_ROOT_PATH`（搜索模式同上）。

### 从源码构建运行时库

由工具链文件引入的 `runtimes.cmake` 会读取以下变量（[从源码构建运行时库](../features/runtimes-from-source.md)）：

| 变量 | |
|---|---|
| `XCLANG_RUNTIMES` | 默认为 `prebuilt`：使用工具链预编译的运行时库。设为 `source` 时：在首次请求对应变体的配置阶段，使用工具链的 `libc++/src` 配合下方选项为目标平台编译 libc++（含 libc++abi）、libc++experimental 与 libunwind；当前构建中的所有编译和链接（包括 `try_compile`）都会改用它们替代预编译版本。不支持 MSVC 目标平台 |
| `XCLANG_SANITIZER` | 由 `address`、`memory`、`thread`、`undefined`、`leak` 组成的列表：向构建中的每次编译和链接添加 `-fsanitize=`，并选用匹配的运行时库。配合预编译运行时库使用时，`address` 会在支持的目标平台上启用 ASan libc++，而 `memory` 会停止配置；配合 `source` 使用时，运行时库会带对应的 sanitizer 编译（`LLVM_USE_SANITIZER`：同时指定 ASan 与 UBSan 时一并启用，否则按 MemorySanitizer、ThreadSanitizer、UBSan、LeakSanitizer 的优先级择一启用），其中 `memory` 还会一并编译 compiler-rt 的 MemorySanitizer 运行时库并链接进可执行文件（`memory` 仅支持 glibc Linux 目标平台）。如果目标平台没有所请求 sanitizer 的运行时库，配置会报错停止：Windows 目标平台支持 `undefined` 及 x64 下的 `address`，musl 目标平台仅支持 `undefined` |
| `XCLANG_LIBCXX_HARDENING` | 可选 `none`、`fast`、`extensive` 或 `debug`：设置 libc++ 的加固模式（`LIBCXX_HARDENING_MODE`），同时作用于编译出的库代码与头文件的默认配置 |
| `XCLANG_LIBCXX_ABI_VERSION` | `1` 或 `2`（对应 `LIBCXX_ABI_VERSION`） |
| `XCLANG_LIBCXX_ABI_NAMESPACE` | libc++ 的内联 ABI 命名空间，格式为 `__<name>`（对应 `LIBCXX_ABI_NAMESPACE`） |
| `XCLANG_LIBCXX_ABI_DEFINES` | libc++ 的 ABI 宏列表，例如 `_LIBCPP_ABI_BOUNDED_ITERATORS`（对应 `LIBCXX_ABI_DEFINES`） |
| `XCLANG_RUNTIMES_EXCEPTIONS` | 设为 `OFF` 或其他表示假的 CMake 布尔值时：在禁用异常的情况下构建 libc++ 与 libc++abi |
| `XCLANG_RUNTIMES_RTTI` | 设为 `OFF` 或其他表示假的 CMake 布尔值时：在禁用 RTTI 的情况下构建 libc++；需同时设置 `XCLANG_RUNTIMES_EXCEPTIONS=OFF` |
| `XCLANG_RUNTIMES_FLAGS` | 编译 libc++ 与 libc++abi 的额外编译选项，例如 `-flto=thin` |
| `XCLANG_RUNTIMES_CMAKE_ARGS` | 传给运行时库 CMake 构建（LLVM 的 `runtimes/`）的额外参数，每项格式为 `-D<variable>=<value>` |
| `XCLANG_RUNTIMES_DIR` | 构建运行时库变体的目录，每个变体存放在 `<target>-<digest>` 子目录下；默认为 `${CMAKE_BINARY_DIR}/xclang-runtimes`，相对路径相对于构建目录解析 |

除 `XCLANG_RUNTIMES` 与 `XCLANG_SANITIZER` 外，其余选项均需配合 `XCLANG_RUNTIMES=source` 使用。每个变体目录下包含其 CMake 构建树（`runtimes`，启用 MemorySanitizer 时还有 `compiler-rt`）、构建日志以及 `install` 安装目录：其中 `include/c++/v1` 包含 `__config_site` 等头文件，配合 `-nostdinc++` 排在目标平台配置文件的头文件之前；`lib` 包含库文件，链接时配合 `-nostdlib++`（除 macOS 及启用 sanitizer 的情况外，还会加上 `--unwindlib=none`）使用；`lib/libc++.modules.json` 与 `share/libc++/v1` 则提供 `xclang::std` 所需的模块文件。变体目录名包含由选项、目标平台和工具链计算出的摘要，因此同一变体在每个构建目录中只构建一次，修改选项后会在同级目录下构建新的变体。与上游 LLVM 构建一样，构建过程需要主机安装 Python 3。

## `xclang.cmake`

从按版本标签检出的 FetchContent 目录中，在 `project()` 之前引入（完整示例见 [CMake](../integrations/cmake.md#without-xclang-installed)）：

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

| 变量 | |
|---|---|
| `XCLANG_VERSION` | 要下载的版本号；未设置时取当前检出所对应的版本标签 |
| `XCLANG_TARGET` | 要构建的其他目标平台，用法与 `toolchain.cmake` 相同 |
| `XCLANG_ROOT` | 直接使用指定的已解压 xclang 工具链，不再下载 |
| `XCLANG_CACHE_DIR` | 解压工具链的缓存目录，按 `<version>/<host>` 存放（也可通过同名环境变量设置）；在 Linux 上默认为 `$XDG_CACHE_HOME/xclang` 或 `~/.cache/xclang`，在 macOS 上为 `~/Library/Caches/xclang`，在 Windows 上为 `%LOCALAPPDATA%\xclang` |
| `XCLANG_URL` | 下载 `SHA256SUMS` 与压缩包的发布镜像地址；设置后将以镜像站上的 `SHA256SUMS` 为准 |

它会验证服务器证书并下载对应版本的 `SHA256SUMS` 与主机压缩包 `xclang-<version>-<host>.tar.xz`，再对照校验行验证压缩包摘要。压缩包会先解压到临时目录，再原子移入缓存目录，避免多个构建树同时配置时发生冲突，随后自动设置 `CMAKE_TOOLCHAIN_FILE`。如果当前构建已经设置了工具链文件（例如 vcpkg 的工具链文件），它会报错停止；此时应改为通过 vcpkg 的 `VCPKG_CHAINLOAD_TOOLCHAIN_FILE` 链式加载 xclang 的工具链文件。构建目录会固定首次配置时的工具链文件：当版本号、`XCLANG_ROOT` 或 `XCLANG_CACHE_DIR` 发生变化时，它会在下载前报错停止，提示换用新构建目录或运行 `cmake --fresh`。

## libclang 的 CMake 包

libclang 压缩包内含 LLVM 与 clang 自身的 CMake 包（可通过 `find_package(Clang)` 查找），同时包含记录构建配置的 `lib/cmake/xclang/libclang.cmake`，提供 `XCLANG_LLVM_VERSION`、`XCLANG_LTO`、`XCLANG_PGO`、`XCLANG_PATCHES` 等变量（[libclang](../features/libclang.md)）。
