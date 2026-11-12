# 什么是 xclang？

xclang 是一套用于交叉编译的 clang 工具链，思路就像 Rust 里的 rustup、cross-rs 和 cargo-zigbuild：一个编译器面向所有目标平台。单个目录里包含编译器、链接器、二进制工具，以及八个目标平台的 *sysroot*（C 标准库的头文件与库文件）和预编译运行时库。交叉编译只需传一个 `--target` 参数：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

## 版本包含的内容

- **clang、lld 与 LLVM 二进制工具**：基于上游 LLVM 加上少量正在合入上游的[补丁](../reference/patches.md)构建，打包为单个多合一可执行文件（`llvm`），并针对六个主机平台静态链接 xclang 自身的 libc++（[工具链结构](../design/toolchain.md)）。
- **每个压缩包内置八个目标平台**：[Linux](../targets/linux.md) x64 与 arm64（glibc 2.17，以及用于静态程序的 musl 1.2.6）、[Windows](../targets/windows.md) x64 与 arm64（使用 UCRT 的 MinGW-w64）、[macOS](../targets/macos.md) arm64 与 x64。每个目标平台都带有预编译好的 sysroot、libc++、libc++abi、libunwind 和 compiler-rt，以及将 clang 指向这些目录的配置文件（[交叉编译](../targets/cross-compiling.md)）。
- **MSVC 目标平台**：Windows x64 与 arm64，使用微软的 CRT 和 xclang 的 libc++（或微软的 STL），可在任意主机上编译，配合 `xclang` 命令从微软获取的 SDK 或 Windows 本机安装的 Visual Studio 使用（[Windows 目标平台](../targets/windows.md)）。
- **`xclang` 命令**：用于获取不允许二次分发的 Apple 与微软 SDK；`xclang cargo` 则无需编写任何 cargo 配置即可为 xclang 的目标平台构建 Rust 代码（[`xclang` 命令](../reference/xclang-command.md)、[Rust 与 Cargo](../integrations/cargo.md)）。
- **CMake 包与 Bazel 模块**：可用于主机或任意目标平台，并随构建过程按需编译 `import std`（[CMake](../integrations/cmake.md)、[Bazel](../integrations/bazel.md)）。
- **运行时库源码**：供 CMake 包与 Bazel 模块在启用 MemorySanitizer 或调整 libc++ 加固（hardening）及 ABI 选项时按需编译，支持除 MSVC 以外的所有目标平台（[从源码构建运行时库](../features/runtimes-from-source.md)）。
- **libclang**：构建这个版本所用的 clang 与 LLVM 静态库及头文件，供基于 clang 开发的工具使用（[libclang](../features/libclang.md)）。

尚未发布的其他目标平台与功能见[路线图](../design/roadmap.md)。

## 它对构建的作用

当 C++ 构建的产物只取决于声明的输入时，这样的构建就是*封闭的*（hermetic）：在任何机器、任何目录下，同样的源码和工具链都会产出同样的程序。这正是 xclang 的设计目标。

- **可复现。** 已发布的版本不会覆盖替换，重新构建会发布为下一个修订号。Bazel 模块与 CMake 下载都会校验每个压缩包的 `sha256`。在 Bazel 构建中，除 Xcode 的 macOS SDK 外，命令行与调试信息都不含绝对路径，在另一个代码检出目录中构建也能产出逐字节相同的结果（[Bazel 模块](../design/bazel-module.md)）。
- **产物可移植。** 编译出的程序在运行时只依赖目标操作系统必定自带的系统库：[Linux](../targets/linux.md) 上是 glibc 2.17 及以上（使用 musl 时则无任何依赖），[Windows 10](../targets/windows.md) 及以上，或 [macOS 13](../targets/macos.md) 及以上。libc++ 与其他运行时库均已静态链接进程序，而且面向 GCC 编写的构建脚本（`-latomic`、`-lgcc_s`、`-lstdc++`）无需修改即可链接（[封闭性](../design/hermeticity.md)）。
- **一个编译器面向所有目标平台。** clang 本身支持编译所有 LLVM 目标平台，而 xclang 随附了各目标平台的库文件。切换目标平台只需传入 `--target=<triple>`，升级一次编译器即可同时更新所有目标平台（[交叉编译](../targets/cross-compiling.md)）。
- **准确的构建缓存。** 直接使用宿主机上的编译器时，升级编译器后构建缓存仍可能返回旧版本编译出的目标文件。在 Bazel 中，构建动作读取的每个工具链文件都是显式声明的输入，升级版本后会准确重编受影响的目标，模块文件也会作为 import 它的文件的输入参与缓存计算（[Bazel 模块](../design/bazel-module.md)、[C++20 模块](../features/modules.md)）。
- **C++20 模块。** 模块文件只能被采用相同语言选项编译的源码 import，因此无法预编译分发 `std` 模块。xclang 会按当前构建的编译选项现场编译 libc++ 的 `std` 与 `std.compat` 模块：在 CMake 中无需开启实验性开关即可使用 `xclang::std`，在 Bazel 中则是 `@xclang//bazel:std`（[C++20 模块](../features/modules.md)）。
- **速度快。** 每个主机上的 clang 与 lld 均开启 PGO 和 ThinLTO 构建，训练负载涵盖真实 C/C++ 代码编译、预编译头、C++20 模块与代码补全（[PGO](../design/pgo.md)）。libclang 以 ThinLTO bitcode 形式分发，配合 ThinLTO 缓存可将基于它构建的工具的重新链接时间缩短到几秒（[libclang](../features/libclang.md)）。
- **正确性检查与调试工具。** xclang 随附各 sanitizer 的运行时库以及带 ASan 插桩的 libc++，避免容器溢出的误报（[sanitizer](../features/sanitizers.md)），并支持为 MemorySanitizer 从源码编译运行时库（[从源码构建运行时库](../features/runtimes-from-source.md)）。调试符号可与程序分离：除 MSVC 目标生成 PDB 外，所有目标均可生成每次构建完全一致的 GSYM 文件，macOS 目标还可生成 dSYM（[调试](../features/debugging.md)）。
- **供应链可追溯。** 每个压缩包都记录在 `SHA256SUMS` 中，基于 LLVM 官方源码包与公开记录的[补丁](../reference/patches.md)构建，在两台机器上各打包一次并逐字节比对，同时随包附带各组件的许可证与 SPDX 文档（[安装](install.md)、[压缩包目录结构](../reference/layout.md)）。厂商 SDK 绝不打包进压缩包，而是由用户直接从厂商下载，并锁定版本与 `sha256`（[`xclang` 命令](../reference/xclang-command.md)）。
- **一套工具链通用于各种构建方式。** 同一个工具链目录既可用于[直接调用 clang、Make 与 Meson](../integrations/clang.md)，也可用于 [CMake](../integrations/cmake.md)、[Bazel](../integrations/bazel.md) 和 [cargo](../integrations/cargo.md)，无论它来自 pixi、压缩包、FetchContent 还是 Bazel registry（[安装](install.md)）。

## 适用场景

- **向用户机器分发程序的项目**：命令行工具、语言服务器和构建工具，无需用户安装运行库安装包或 Homebrew，单文件即可运行。
- **为多个目标平台构建的 CI**：在单一 runner 操作系统上用同一个编译器版本构建所有目标平台（[CI](../integrations/ci.md)）。
- **在开发机与 CI 上锁定同一套工具链的团队**：统一用于 CMake、Bazel 和直接命令行调用。
- **使用 `import std` 的 C++20 模块项目**：支持 CMake 与 Bazel。
- **基于 clang 的工具**：链接开启 PGO 构建的 libclang。

xclang 是为 [clice](https://github.com/clice-io/clice) 开发的，clice 的发布构建是它的第一个用户。[catter](https://github.com/clice-io/catter) 同样使用它构建。xclang 的 CI 在 Linux 上将 [kotatsu](https://github.com/clice-io/kotatsu) 的测试交叉编译到 Windows，并在 Windows 上运行。[同类工具对比](comparisons.md)横向对比了 xclang 与承担类似任务的各工具链。

## 它不是什么

- **其他工具链编译的 C++ 库需要配套的 C++ 标准库。** xclang 默认使用 libc++ 并静态链接进每个程序，而用 GCC 的 libstdc++ 或微软的 STL 编译出的 C++ 库具有不同的 ABI。请用 xclang 为目标平台重新编译 C++ 依赖库，或者传入 `-stdlib=platform` 改用平台的 C++ 标准库（此时产物不再自包含，详见[直接使用 clang](../integrations/clang.md)）。C 语言库不受影响。
- **每个共享库各自持有一份 libc++。** 每个共享库都链接了独立的 libc++，因此不应跨共享库边界传递 C++ 对象；在 Linux 与 macOS 上，一个共享库抛出的标准异常在另一个共享库中只能被 `catch (...)` 捕获（[封闭性](../design/hermeticity.md)）。
- **不含 OpenMP 运行时库。**
- **不含 `clang-format`、`clang-tidy` 或 `clangd` 可执行文件。** xclang 是一套编译器工具链。
- **不用于构建 conda-forge 软件包。** 构建 conda-forge 包请使用 conda-forge 自己的编译器，它们会按 `run_exports` 机制动态链接共享运行时库包；xclang 不这么做。

## 下一步

- [快速开始](quick-start.md)：为各个目标平台构建程序，再构建一个使用 `import std` 的 CMake 项目。
- [安装](install.md)：pixi、压缩包、FetchContent 与 Bazel。
- [同类工具对比](comparisons.md)：xclang 与 `zig cc`、`llvm-mingw`、conda-forge 等工具的对比。
