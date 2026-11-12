# 交叉编译

向 `clang` 或 `clang++` 传入 `--target=<triple>`，即可为其他目标平台编译并链接程序。每个主机压缩包都包含编译器、`lld`，以及所有目标平台的 sysroot、预编译运行时库和配置文件，因此交叉编译不需要外部 sysroot 或包装脚本。

## 构建其他目标平台的程序

在[快速开始](../guide/quick-start.md)目录（`examples/quickstart`）下，为 Windows on Arm 编译 `hello.cpp`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

## 目标平台与主机

同一个 `--target` 参数可用于构建 xclang 支持的十个目标平台：

| 目标平台 | 其他写法 | C 标准库 | 运行环境 | 构建主机 | tier |
|---|---|---|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-pc-linux-gnu`、`x86_64-linux-gnu` | glibc 2.17 | [Linux](linux.md) x64，glibc 2.17 及以上 | 所有主机 | 1 |
| `aarch64-unknown-linux-gnu` | `aarch64-pc-linux-gnu`、`aarch64-linux-gnu`、`arm64-linux-gnu`、`arm64-unknown-linux-gnu`、`arm64-pc-linux-gnu` | glibc 2.17 | [Linux](linux.md) arm64，glibc 2.17 及以上 | 所有主机 | 1 |
| `x86_64-unknown-linux-musl` | `x86_64-pc-linux-musl`、`x86_64-linux-musl` | musl 1.2.6，静态链接 | 任意 [Linux](linux.md) x64 | 所有主机 | 1 |
| `aarch64-unknown-linux-musl` | `aarch64-pc-linux-musl`、`aarch64-linux-musl`、`arm64-linux-musl`、`arm64-unknown-linux-musl`、`arm64-pc-linux-musl` | musl 1.2.6，静态链接 | 任意 [Linux](linux.md) arm64 | 所有主机 | 1 |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu`、`x86_64-pc-windows-gnu` | 使用 UCRT 的 mingw-w64 | [Windows](windows.md) x64，10 及以上 | 所有主机 | 1 |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu`、`aarch64-pc-windows-gnu`、`arm64-w64-mingw32`、`arm64-w64-windows-gnu`、`arm64-pc-windows-gnu` | 使用 UCRT 的 mingw-w64 | [Windows](windows.md) arm64，10 及以上 | 所有主机 | 1 |
| `x86_64-pc-windows-msvc` | `x86_64-unknown-windows-msvc`、`x86_64-windows-msvc` | 微软 CRT（混合 CRT） | [Windows](windows.md) x64，10 及以上 | 已下载 [SDK](#vendor-sdks) 的所有主机；Windows 主机也可使用本机 Visual Studio | 1 |
| `aarch64-pc-windows-msvc` | `aarch64-unknown-windows-msvc`、`arm64-pc-windows-msvc`、`arm64-unknown-windows-msvc`、`arm64-windows-msvc` | 微软 CRT（混合 CRT） | [Windows](windows.md) arm64，10 及以上 | 已下载 [SDK](#vendor-sdks) 的所有主机；Windows 主机也可使用本机 Visual Studio | 1 |
| `aarch64-apple-darwin` | `arm64-apple-darwin`、`arm64-apple-macos`、`aarch64-apple-macos`、`aarch64-apple-macosx`、`arm64-apple-macosx` | SDK 中的 `libSystem` | [macOS](macos.md) arm64，13.0 及以上 | macOS 主机；以及已下载 [SDK](#vendor-sdks) 的 Linux 与 Windows 主机 | 1 |
| `x86_64-apple-darwin` | `x86_64-apple-macos`、`x86_64-apple-macosx` | SDK 中的 `libSystem` | [macOS](macos.md) x64，13.0 及以上 | macOS 主机；以及已下载 [SDK](#vendor-sdks) 的 Linux 与 Windows 主机 | 1 |

每个目标平台默认都会静态链接 xclang 的 `libc++` 与 `compiler-rt`，并使用 `lld` 作为链接器（`ld.lld`、`lld-link` 或 `ld64.lld`）。各平台的细节、sanitizer 支持与已知限制见 [Linux](linux.md)、[Windows](windows.md) 和 [macOS](macos.md) 页面。按需下载更多目标平台（[供 `xclang target add` 使用的目标平台压缩包](../design/roadmap.md#target-archives)），以及[更多 Linux 架构](../design/roadmap.md#linux-architectures)、[riscv64 与 armv7 上的 musl](../design/roadmap.md#musl-architectures)、[WebAssembly](../design/roadmap.md#wasm) 和 [Android](../design/roadmap.md#android) 目标平台均在[路线图](../design/roadmap.md#targets)中跟进。

主机（host）是运行工具链的机器。每个主机平台都有各自的压缩包（[安装](../guide/install.md#archives)），且每个压缩包都包含上述所有目标平台：

| 主机 | 压缩包构建环境 | 测试环境 |
|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64 | `ubuntu-24.04` |
| `aarch64-unknown-linux-gnu` | Linux x64，交叉编译 | `ubuntu-24.04-arm` |
| `x86_64-w64-mingw32` | Linux x64，交叉编译（工具链本身是 MinGW 程序） | `windows-2025` |
| `aarch64-w64-mingw32` | Linux x64，交叉编译（工具链本身是 MinGW 程序） | `windows-11-arm` |
| `aarch64-apple-darwin` | macOS arm64 | `macos-15` |
| `x86_64-apple-darwin` | macOS arm64，交叉编译 | `macos-15-intel` |

## 工具链对主机的要求

| 主机 | 工具链所需环境 |
|---|---|
| Linux x64、arm64 | glibc 2.17 及以上，无其他依赖（`clang` 与 `lld` 已静态链接 `libc++`） |
| macOS arm64、x64 | macOS 13 及以上；编译 macOS 目标平台时还需安装 Xcode 或 Command Line Tools（提供 SDK） |
| Windows x64、arm64 | Windows 10 及以上（操作系统自带 UCRT） |

## Clang 如何查找目标平台文件

`clang` 可生成 LLVM 支持的所有架构的代码，`lld` 则可链接 ELF、COFF 与 Mach-O。所有目标平台共用同一个多合一编译器与链接器程序，xclang 在其旁附带了各目标平台的 sysroot、运行时库与配置文件（[工具链结构](../design/toolchain.md)）。

针对每个 `--target`，`clang` 会从自身的 `bin/` 目录读取 `<triple>.cfg`（`clang-cl` 则读取 `<triple>-clang-cl.cfg`）。配置文件按 `clang` 规范化后的 triple 命名，并为上表中的其他写法保留了副本。传入 `--target=aarch64-w64-mingw32` 时，`clang` 会读取 `bin/aarch64-w64-windows-gnu.cfg`，去掉注释后的内容如下：

```text
--sysroot=<CFGDIR>/../aarch64-w64-mingw32
-stdlib++-isystem <CFGDIR>/../libc++/include/aarch64-w64-windows-gnu/c++/v1
-stdlib++-isystem <CFGDIR>/../libc++/include/c++/v1
-idirafter <CFGDIR>/../mingw-w64/include
-rtlib=compiler-rt
-unwindlib=libunwind
-stdlib=libc++
-fuse-ld=lld
```

`<CFGDIR>` 会展开为 `bin/`，从而将 `clang` 指向目标平台的 sysroot 目录、对应的 `__config_site`、共用的 `libc++` 与 `mingw-w64` 头文件，以及 `compiler-rt`、`libunwind`、`libc++` 和 `lld`（[压缩包目录结构](../reference/layout.md)）。整个过程不涉及包装脚本、环境变量或外部状态，同一条命令在任何机器上都会执行相同的编译和链接动作。

配置文件同样作用于本机编译。在 Linux 上运行 `clang++ hello.cpp` 时，编译使用的是内置的 glibc 2.17 sysroot，而非主机的 `/usr/include` 与 `/usr/lib`，因此在新版 Linux 发行版上构建出的程序也能在旧版发行版上运行。

传入 `--no-default-config` 可跳过目标平台配置文件，使 `clang` 按上游原版行为查找系统的头文件、运行时库和链接器。

每个目标平台都遵循[封闭性](../design/hermeticity.md)原则：编译出的程序在运行时只依赖目标操作系统必定自带的系统库，其余依赖全部静态链接。

## 平台的 C++ 标准库

如果程序需要跨接口向使用平台的 C++ 标准库编译的库（例如 Linux 发行版自带的 Qt、Boost，或用 MSVC 编译的 Windows 库）传递 C++ 类型，就必须使用同一个 C++ 标准库。此时需向所有编译和链接命令（包括 C 源文件）传入 `-stdlib=platform`（或 `-stdlib=libstdc++`；在 `clang-cl` 中为 `/clang:-stdlib=platform`）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 -stdlib=platform hello.cpp -o hello
clang++ -O2 -stdlib=platform --target=x86_64-pc-windows-msvc hello.cpp -o hello.exe
```

这个参数会选用目标平台的第二份配置文件 `bin/<triple>-system.cfg`（或 `<triple>-clang-cl-system.cfg`，由[补丁 0018](../reference/patches.md) 支持）。这份配置文件保留了 `lld`、部署目标版本与 C 运行时库设置，去掉了 xclang 的 `libc++` 和内置 sysroot，编译出的程序在运行时将依赖目标机器上的平台 C++ 运行时库：

| 目标平台 | C++ 标准库 | sysroot 或 SDK | 运行时加载项 |
|---|---|---|---|
| [Linux（glibc）](linux.md#the-platform-s-c-library) | GCC 的共享库版 `libstdc++` | 主机环境、发行版的交叉编译包（`g++-aarch64-linux-gnu`）或 `--sysroot` | 系统的 `libstdc++.so.6`、`libgcc_s.so.1`，以及构建环境的 glibc（而非 2.17） |
| [Linux（musl）](linux.md#the-platform-s-c-library) | sysroot 中的 `libstdc++` | `--sysroot`（例如 Alpine 根目录） | 由所用的 sysroot 决定 |
| [Windows（MinGW）](windows.md#mingw-targets) | sysroot 中的 `libstdc++` | `--sysroot`（例如 MSYS2 的 `ucrt64`，或链接了发行版 `mingw-w64` 的目录） | 由所用的 sysroot 决定 |
| [Windows（MSVC）](windows.md#libc-and-microsoft-s-stl) | 微软的 STL | 下载的 Windows SDK，或 Windows 本机的 Visual Studio | 无新增依赖：STL 配合混合 CRT 静态链接 |
| [macOS](macos.md#xclang-s-libc-and-stdlib-platform) | SDK 中的 `libc++` | Xcode 的 SDK，或通过 `xclang sdk fetch macos` 下载的 SDK | 操作系统的 `/usr/lib/libc++.1.dylib` |

## 厂商 SDK

有两类目标平台在编译时需要使用 xclang 无法二次分发的厂商 SDK：

- **[macOS 目标平台](macos.md)**：在 macOS 主机上，`clang` 直接使用 Xcode 或 Command Line Tools 的 SDK。在 Linux 与 Windows 主机上，先运行一次 `xclang sdk fetch macos --accept-license` 从 Apple 下载 macOS SDK（[在 Linux 与 Windows 主机上构建 macOS 目标](macos.md#on-linux-and-windows-hosts)）。
- **[Windows MSVC 目标平台](windows.md#msvc-targets)**：在任意主机上，先运行一次 `xclang sdk fetch windows --accept-license` 获取微软的 CRT、STL 与 Windows SDK。在未下载 SDK 的 Windows 主机上，`clang` 会使用本机安装的 Visual Studio。

每个工具链压缩包都包含 `xclang` 命令（[`xclang` 命令](../reference/xclang-command.md)）。`xclang sdk fetch` 会将各 SDK 解压到 `<toolchain>/sdk/` 下，并把 `<toolchain>/sdk/macos` 或 `<toolchain>/sdk/windows` 指向当前启用的 SDK；这样即使切换 SDK 版本，目标平台配置文件引用的路径也保持不变。在 Bazel 中，可在 `MODULE.bazel` 里声明接受许可证，由仓库规则将 SDK 解压为外部仓库（[Bazel](../integrations/bazel.md)、[Bazel 模块](../design/bazel-module.md)）。

### 为什么厂商 SDK 需要按需下载而非随包附带

Apple 的 SDK 协议与微软的 Visual Studio 许可证只允许使用，不允许二次分发。无论是在工具链中打包这些 SDK，还是在容器镜像中内置它们，都属于二次分发。

因此，`xclang sdk fetch` 会直接从 Apple 和微软的服务器下载文件，由每位用户在厂商条款下直接从厂商处获取 SDK，同时保证 xclang 自身的发布压缩包可以自由分发：

- 未传入 `--accept-license` 时，`xclang sdk fetch` 会打印厂商的许可条款并退出。
- Apple 的条款仅允许在 Apple 硬件上使用其 SDK。是否依据这些条款在 Linux 或 Windows 上使用它来构建 macOS 程序，由用户自行决定。
- 安装包 URL、文件大小与 `sha256` 摘要（以及 Apple 安装包内部 SDK 的内容摘要）均锁定在编译进 `xclang` 的 `xclang/sdk-versions.json` 中。其中的预设与 GitHub 的 runner 镜像（`macos-latest`、`windows-2025`、`windows-2022` 等）一一对应，使交叉编译使用的 SDK 版本与对应 runner 镜像上的工作流保持一致。

## 测试分级（Tier）

每个目标平台都有一个 tier 等级，标明它在每次发布时的测试方式：

- **Tier 1**：每次发布都会构建，测试程序直接在目标平台原生的 GitHub 托管 runner 上运行（不使用模拟器），一旦测试失败即中止发布。上表中的十个目标平台均为 Tier 1。
- **Tier 2**：每次发布都会构建，测试在模拟器或虚拟化环境（QEMU、虚拟机、Android 模拟器或 Apple 模拟器）下运行。
- **Tier 3**：仅为目标平台编译并链接测试程序，不实际运行。

## 运行构建出的程序

使用 `llvm-readobj` 查看交叉编译产物的格式与架构：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --file-headers hello-windows-arm64.exe
```

输出的头部信息中包含 `Format: COFF-ARM64` 与 `Arch: aarch64`。

将产物拷贝到对应目标平台的机器上即可直接运行，无需安装任何运行时软件包。glibc [Linux](linux.md) 产物可在任意搭载 glibc 2.17 及以上的发行版上运行，musl 产物可在同架构的任意 Linux 上运行，[Windows](windows.md) 产物可在 Windows 10 及以上运行，[macOS](macos.md) 产物可在 macOS 13.0 及以上运行（已按 Apple silicon 的要求由 `ld64.lld` 完成临时签名）。

部分主机还能直接运行同一操作系统下其他架构的程序：

- `arm64` macOS 可通过 Rosetta 运行 `x86_64` macOS 程序。
- Windows on Arm 可通过模拟运行 `x86_64` Windows 程序。

在一台 runner 上构建并在目标平台的 runner 上运行测试的做法见 [CI](../integrations/ci.md)。

## 在构建系统中使用

- [CMake](../integrations/cmake.md)：传入工具链文件并指定 `-DXCLANG_TARGET=<target>`。
- [Bazel](../integrations/bazel.md)：传入 `--platforms=@xclang//platforms:<target>`。
- [直接使用 clang、Make 与 Meson](../integrations/clang.md)：向编译器传入 `--target=<target>`，或将其写入 Meson 交叉编译文件（cross file）。
- [Rust 与 Cargo](../integrations/cargo.md)：运行 `xclang cargo build --target <rust-target>`。

## 构建工具的最低版本要求

| 工具 | 最低版本或目标平台 | 原因 |
|---|---|---|
| CMake | 3.28 及以上 | 首个无需实验性开关即可构建 C++20 模块的版本；`find_package(xclang)` 会拒绝更早的版本（[CMake](../integrations/cmake.md)） |
| Ninja | 1.11 及以上 | CMake 构建 C++20 模块所需；目前只有 Ninja 生成器支持为这些目标平台构建模块 |
| Bazel | 9，搭配 `rules_cc` 0.2.25 及以上 | 工具链基于 `rules_cc` 0.2.28 的 unix 配置构建（[Bazel 模块](../design/bazel-module.md)）；使用 C++20 模块需传入 `--experimental_cpp_modules` |
| Rust | MinGW 使用 `*-pc-windows-gnullvm`（而非 `*-windows-gnu`）；配合 Windows SDK 时使用 `*-pc-windows-msvc` | `*-windows-gnullvm` 的标准库链接 `libunwind` 与 UCRT，与 xclang 的 MinGW sysroot 一致（[Rust 与 Cargo](../integrations/cargo.md)） |
