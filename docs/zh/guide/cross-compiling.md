# 交叉编译

向 `clang` 或 `clang++` 传入 `--target=<triple>`，即可为其他目标平台编译并链接程序。每个主机压缩包都包含编译器、`lld`，以及所有内置目标平台的 sysroot、预编译运行时库和配置文件，因此交叉编译不需要外部 sysroot 或包装脚本。

## 构建其他目标平台的程序

在[快速开始](quick-start.md)目录（`examples/quickstart`）下，为 Windows on Arm 编译 `hello.cpp`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

## 目标平台与主机

同一个 `--target` 参数可用于构建 xclang 支持的十个目标平台：

<!-- BEGIN GENERATED: targets -->

| 目标平台 | 其他写法 | C 运行时库 | 运行环境 | 厂商 SDK |
| --- | --- | --- | --- | --- |
| `x86_64-unknown-linux-gnu` | `x86_64-pc-linux-gnu` | glibc 2.17 | glibc 2.17 及以上的 Linux |  |
| `aarch64-unknown-linux-gnu` | `aarch64-pc-linux-gnu`, `arm64-unknown-linux-gnu`, `arm64-pc-linux-gnu` | glibc 2.17 | glibc 2.17 及以上的 Linux |  |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu`, `x86_64-pc-windows-gnu` | mingw-w64 14.0.0，UCRT | Windows 10 及以上 |  |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu`, `aarch64-pc-windows-gnu`, `arm64-w64-windows-gnu`, `arm64-pc-windows-gnu` | mingw-w64 14.0.0，UCRT | Windows 10 及以上 |  |
| `aarch64-apple-darwin` | `aarch64-apple-macos`, `aarch64-apple-macosx`, `arm64-apple-darwin`, `arm64-apple-macos`, `arm64-apple-macosx` | SDK 的 libSystem | macOS 13.0 及以上 | Apple 的，在 Linux 与 Windows 主机上 |
| `x86_64-apple-darwin` | `x86_64-apple-macos`, `x86_64-apple-macosx` | SDK 的 libSystem | macOS 13.0 及以上 | Apple 的，在 Linux 与 Windows 主机上 |
| `x86_64-unknown-linux-musl` | `x86_64-pc-linux-musl` | musl 1.2.6，静态链接 | 任意 Linux |  |
| `aarch64-unknown-linux-musl` | `aarch64-pc-linux-musl`, `arm64-unknown-linux-musl`, `arm64-pc-linux-musl` | musl 1.2.6，静态链接 | 任意 Linux |  |
| `x86_64-pc-windows-msvc` | `x86_64-unknown-windows-msvc` | 微软的 CRT 与 UCRT | Windows 10 及以上 | 微软的 |
| `aarch64-pc-windows-msvc` | `aarch64-unknown-windows-msvc`, `arm64-pc-windows-msvc`, `arm64-unknown-windows-msvc` | 微软的 CRT 与 UCRT | Windows 10 及以上 | 微软的 |

<!-- END GENERATED -->

每个目标平台默认都会静态链接 xclang 的 `libc++` 与 `compiler-rt`，并使用 `lld` 作为链接器（`ld.lld`、`lld-link` 或 `ld64.lld`）。编译出的程序在运行时只依赖所属目标平台系列的操作系统库（[封闭性](../design/hermeticity.md)）。

上述十个目标平台均为 **Tier 1**：每次发布都会构建，并在原生的 GitHub 托管 runner 上直接运行测试，不使用模拟器（Tier 2 在模拟器或虚拟化环境下运行测试；Tier 3 仅编译并链接，不实际运行）。其他目标平台见[路线图](../design/roadmap.md#targets)。各目标平台的 sanitizer 支持情况见 [sanitizer](../features/sanitizers.md)。

主机（host）是运行工具链的机器。每个主机平台都有各自的压缩包（[版本发布](../reference/releases.md#assets)），且每个压缩包都包含上述所有目标平台：

| 主机 | 压缩包构建环境 | 测试环境 | 工具链对主机的要求 |
|---|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64 | `ubuntu-24.04` | glibc 2.17 及以上 |
| `aarch64-unknown-linux-gnu` | Linux x64，交叉编译 | `ubuntu-24.04-arm` | glibc 2.17 及以上 |
| `x86_64-w64-mingw32` | Linux x64，交叉编译（MinGW 程序） | `windows-2025` | Windows 10 及以上 |
| `aarch64-w64-mingw32` | Linux x64，交叉编译（MinGW 程序） | `windows-11-arm` | Windows 10 及以上 |
| `aarch64-apple-darwin` | macOS arm64 | `macos-15` | macOS 13 及以上；编译 macOS 目标平台需安装 Xcode 或 Command Line Tools |
| `x86_64-apple-darwin` | macOS arm64，交叉编译 | `macos-15-intel` | macOS 13 及以上；编译 macOS 目标平台需安装 Xcode 或 Command Line Tools |

## Clang 如何查找目标平台文件

针对每个 `--target`，`clang` 会读取 `bin/<triple>.cfg`（`clang-cl` 则读取 `bin/<triple>-clang-cl.cfg`），并为目标平台的其他写法保留了副本（[工具链结构](../design/toolchain.md)）。配置文件中的 `<CFGDIR>` 会展开为 `bin/`，从而将 `clang` 指向目标平台的 sysroot 或 SDK、`libc++` 头文件、`compiler-rt`、`libunwind` 和 `lld`（[压缩包目录结构](../reference/layout.md)）。

配置文件同样作用于本机编译，因此在 Linux 上运行 `clang++ hello.cpp` 时，编译使用的是内置的 glibc 2.17 sysroot，而非主机的 `/usr/include` 与 `/usr/lib`。面向 GCC 编写的构建脚本（`-latomic`、`-lgcc`、`-lgcc_s`、`-lgcc_eh`、`-lstdc++`）无需修改即可链接（[GCC 库名兼容](../design/hermeticity.md#gcc-library-names)）。传入 `--no-default-config` 可跳过目标平台配置文件，使 `clang` 按上游原版行为查找系统的头文件、运行时库和链接器。

## 厂商 SDK

有两类目标平台在编译时需要使用 xclang 无法二次分发的厂商 SDK：

- **[macOS 目标平台](#macos)**：在 macOS 主机上，`clang` 直接使用 Xcode 或 Command Line Tools 的 SDK。在 Linux 与 Windows 主机上，先运行一次 `xclang sdk fetch macos --accept-license` 从 Apple 下载 macOS SDK。
- **[Windows MSVC 目标平台](#msvc-targets)**：在任意主机上，先运行一次 `xclang sdk fetch windows --accept-license` 获取微软的 CRT、STL 与 Windows SDK。在未下载 SDK 的 Windows 主机上，`clang` 会使用本机安装的 Visual Studio。

`xclang sdk fetch` 会将各 SDK 解压到 `<toolchain>/sdk/` 下，并把 `<toolchain>/sdk/macos` 或 `<toolchain>/sdk/windows` 指向当前启用的 SDK；这样即使切换 SDK 版本，目标平台配置文件引用的路径也保持不变（[`xclang` 命令](../reference/xclang-command.md)）。在 Bazel 中，可在 `MODULE.bazel` 里声明接受许可证，由仓库规则将 SDK 解压为外部仓库（[Bazel](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)）。

Apple 的 SDK 协议与微软的 Visual Studio 许可证只允许使用，不允许二次分发。未传入 `--accept-license` 时，`xclang sdk fetch` 会打印厂商的许可条款；传入后会依据 `xclang/sdk-versions.json` 中锁定的安装包 URL、文件大小、`sha256` 摘要和 SDK 内容摘要，直接从 Apple 与微软的服务器下载与 GitHub runner 镜像（`macos-latest`、`windows-2025`、`windows-2022`）一致的版本。Apple 的条款仅允许在 Apple 硬件上使用 macOS SDK；是否依据这些条款在 Linux 或 Windows 上用它构建 macOS 程序，由用户自行决定。

## 平台的 C++ 标准库

如果程序需要跨接口向使用平台的 C++ 标准库编译的库（例如 Linux 发行版自带的 Qt、Boost，或用 MSVC 编译的 Windows 库）传递 C++ 类型，就必须使用同一个 C++ 标准库。此时需向所有编译和链接命令（包括 C 源文件）传入 `-stdlib=platform`（或 `-stdlib=libstdc++`；在 `clang-cl` 中为 `/clang:-stdlib=platform`）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 -stdlib=platform hello.cpp -o hello
clang++ -O2 -stdlib=platform --target=x86_64-pc-windows-msvc hello.cpp -o hello.exe
```

这个参数会选用 `bin/<triple>-system.cfg`（或 `<triple>-clang-cl-system.cfg`，由[补丁 0018](../reference/patches.md) 支持），保留 `lld`、部署目标版本与 C 运行时库设置，同时去掉 xclang 的 `libc++` 和内置 sysroot：

| 目标平台 | C++ 标准库 | sysroot 或 SDK | 运行时加载项 |
|---|---|---|---|
| Linux（glibc） | GCC 的共享库版 `libstdc++` | 主机环境、发行版的交叉编译包（`g++-aarch64-linux-gnu`）或 `--sysroot` | 系统的 `libstdc++.so.6`、`libgcc_s.so.1`，以及构建环境的 glibc（而非 2.17） |
| Linux（musl） | sysroot 中的 `libstdc++` | `--sysroot`（例如 Alpine 根目录） | 由所用的 sysroot 决定 |
| Windows（MinGW） | sysroot 中的 `libstdc++` | `--sysroot`（例如 MSYS2 的 `ucrt64`，或链接了发行版 `mingw-w64` 的目录） | 由所用的 sysroot 决定 |
| Windows（MSVC） | 微软的 STL | 下载的 Windows SDK，或 Windows 本机的 Visual Studio | 无新增依赖：STL 配合混合 CRT 静态链接 |
| macOS | SDK 中的 `libc++` | Xcode 的 SDK，或通过 `xclang sdk fetch macos` 下载的 SDK | 操作系统的 `/usr/lib/libc++.1.dylib` |

在 Debian 或 Ubuntu 上使用 MinGW 时，请将 `--sysroot` 指向一个包含两个符号链接的目录：把 `x86_64-w64-mingw32` 指向 `/usr/x86_64-w64-mingw32`，把 `lib/gcc` 指向 `/usr/lib/gcc`（若直接传入 `--sysroot=/usr`，则会引入 Linux 主机自身的 `/usr/include` 与 `/usr/lib`）。

## Linux

### glibc 2.17 基线、`-static-pie` 与 `-pg`

`x86_64-unknown-linux-gnu` 与 `aarch64-unknown-linux-gnu` 基于 `<toolchain>/<triple>/` 下内置的 glibc 2.17 sysroot 编译并链接，2.17 即生成产物运行时所需的最低 glibc 版本（[为什么选择 glibc 2.17](../design/hermeticity.md#why-glibc-2-17)；更高版本的 glibc 目标平台目前在[考虑中](../design/roadmap.md#glibc-newer)）。

- **不支持 `-static-pie`**：glibc 2.17 没有 `rcrt1.o`。如需静态链接 glibc 程序请使用 `-static`，或改用支持 `-static-pie` 的 [musl 目标平台](#musl-targets)。
- **`-pg` 需要配合 `-no-pie`**：glibc 2.17 的 `gcrt1.o` 未编译为位置无关代码（PIC）。
- **不含 `quadmath.h`**：`libquadmath` 是 GCC 的库；不过 `__float128` 运算本身可通过 `clang` 与 `compiler-rt` 正常使用。
- **`-nodefaultlibs` 与 `libunwind`**：由于 sysroot 中的 `libgcc_s.a` 是空静态库，像 `rustc` 编译 `*-unknown-linux-gnu` 那样使用 `-nodefaultlibs` 链接时不会提供栈展开库（unwinder）。构建 Rust 项目请使用 `xclang cargo`，或手动传入 `-Clink-arg=-l:libunwind.a`（[Rust 与 Cargo](../integrations/cargo.md)）。

### musl 目标平台

`x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl` 会将 musl 1.2.6（含上游安全补丁、供 C 回调使用的栈展开表以及 Linux 6.18 UAPI 头文件）及所有运行时库静态链接进可执行文件：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=x86_64-unknown-linux-musl hello.cpp -o hello-static-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-musl hello.cpp -o hello-static-arm64
pixi run llvm-readelf --program-headers hello-static-x64
```

生成的二进制文件不含 `INTERP` 程序头与动态段（dynamic section），直接向 Linux 内核发起系统调用，可在同架构的任意 Linux 上运行。

- **默认 `-static`，可按需启用 `-static-pie`**：配置文件默认传入 `-static` 并生成 `ET_EXEC` 二进制文件，从而不会拒绝 CMake 或 `rustc` 传入的 `-no-pie`。在命令行传入 `-static-pie` 即可使用 `rcrt1.o` 构建支持 ASLR 的位置无关静态二进制文件。
- **不支持共享库**：sysroot 使用 `--disable-shared` 构建，不包含 `libc.so`。内置 sysroot 不支持动态链接 musl、调用 `dlopen` 或构建 `-shared` 共享库（如需构建动态链接的 musl 程序，请配合 `--sysroot` 使用 [`-stdlib=platform`](#the-platform-s-c-library)）。

musl 与 glibc 在运行时行为上的差异如下（性能数据测自 4 核 GitHub Linux x64 runner）：

- **多线程下的 `malloc`**：musl 的内存分配器使用一把多线程争用的锁。单线程执行 400 万次 16 至 528 字节的 `malloc` 与 `free` 耗时 0.21 s（glibc 为 0.07 s），4 个线程同时执行则耗时 4.8 s（glibc 为 0.12 s）。若程序在多线程下频繁分配内存，建议链接自定义的内存分配器。
- **区域设置（locale）**：musl 不包含区域设置数据，始终按 `C` locale 格式化：在 `en_US.UTF-8` 下，`printf("%'.1f", 1234567.5)` 会输出 `1234567.5`（glibc 则输出 `1,234,567.5`），`libc++` 的 `std::locale` 表现相同。
- **名称解析**：musl 直接读取 `/etc/hosts` 与 `/etc/resolv.conf` 并发起 DNS 查询，不使用 NSS（`nsswitch.conf` 模块），因此无法解析 mDNS 的 `.local` 域名以及 LDAP 或 SSSD 的用户和组。

## Windows

MinGW 与 MSVC 目标平台均使用 Windows 10 及更高版本自带的 UCRT（[Windows 设计](../design/windows.md)）。

### MinGW 目标平台

`x86_64-w64-mingw32` 与 `aarch64-w64-mingw32` 随每个工具链压缩包内置，并使用 `ld.lld` 静态链接 `libc++`、`libc++abi`、`libunwind`、`winpthreads` 和 `compiler-rt`。

- **`.exe` 输出文件名**：在所有主机上，当输出文件名不带扩展名时，MinGW 链接都会自动补上 `.exe`（`-o hello` 会生成 `hello.exe`）。
- **头文件与 `--gc-sections`**：MinGW-w64 的头文件名均为小写（`windows.h`、`basetsd.h`、`winsock2.h`）；请使用小写的 `#include` 名称以确保在区分大小写的文件系统上正常编译，并在依赖未引用的 COMDAT 初始化器注册测试时避免传入 `-Wl,--gc-sections`（[`gc-sections` 与静态初始化器](../design/windows.md#gc-sections-and-static-initializers)）。
- **Rust 的 `-gnullvm` 目标平台**：请使用 `x86_64-pc-windows-gnullvm` 与 `aarch64-pc-windows-gnullvm`，而非 `*-pc-windows-gnu`。`-gnullvm` 目标平台会链接 `libunwind` 与 UCRT，与 xclang 的 MinGW sysroot 保持一致（[Rust 与 Cargo](../integrations/cargo.md)）。

### MSVC 目标平台

`x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc` 面向 MSVC ABI 构建；链接由 MSVC 编译的库、重度使用 COM 的代码或 Windows 厂商 SDK 时均需要 MSVC ABI。先运行一次命令获取微软的 CRT、STL 与 Windows SDK，即可在任意主机上使用 `clang++` 或 `clang-cl` 构建：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch windows --accept-license
clang++ -O2 --target=x86_64-pc-windows-msvc hello.cpp -o hello-msvc-x64.exe
clang-cl /O2 /EHsc hello.cpp /Fehello-cl.exe
clang-cl /O2 /EHsc --target=aarch64-pc-windows-msvc hello.cpp /Fehello-cl-arm64.exe
```

- **选择 SDK 版本**：`xclang sdk fetch windows` 默认下载 `windows-latest` 预设（`windows-2025-vs2026`：MSVC 14.51 与 Windows SDK 10.0.26100）。传入 `--preset windows-2022` 可选择 MSVC 14.44，也可手动传入 `--msvc-version`、`--sdk-version` 与 `--arch x86_64,aarch64,x86`。运行 `xclang sdk use <name>` 可切换当前启用的 SDK（[`xclang` 命令](../reference/xclang-command.md)）。在未下载 SDK（或传入了 `--no-default-config`）的 Windows 主机上，`clang` 会使用本机安装的 Visual Studio；在未下载 SDK 的 Linux 与 macOS 主机上，编译包含 CRT 头文件的文件会立即报错停止（`-ffreestanding` 则无需 SDK 即可工作）。
- **`clang-cl`**：直接运行 `clang-cl` 时会读取 `<host-triple>-clang-cl.cfg`，无需传入 `--target` 即可构建当前主机架构的 MSVC 目标平台。在 macOS 上，`clang-cl` 会将形如 `/Users/me/hello.cpp` 的输入路径当作 `/U` 选项解析：请把输入文件放在 `--` 之后，或使用 `/Tp` 显式指定。在 [CMake](../integrations/cmake.md) 与 [Bazel](../integrations/bazel.md) 中，xclang 使用 GNU 风格的 `clang++` 驱动而非 `clang-cl`。
- **C 运行时库选择**：默认情况下，二进制文件会静态链接 `libc++`（或微软的 STL）以及 VC 运行时库（`libvcruntime.lib`、`libcmt.lib`），并将 UCRT 动态链接到 `ucrtbase.dll`（即混合 CRT；见 [Windows 设计](../design/windows.md#the-hybrid-crt)）。如需选择其他 C 运行时库：

  | C 运行时库 | `clang`、`clang++` | `clang-cl` |
  |---|---|---|
  | 混合 CRT（默认） | （默认） | `/MT`（默认） |
  | DLL 运行时（`vcruntime140.dll`，使用 STL 时还包括 `msvcp140.dll`） | `-fms-runtime-lib=dll` | `/MD` |
  | 全部静态链接（含 UCRT） | `-Wl,/nodefaultlib:ucrt.lib -llibucrt` | `/link /nodefaultlib:ucrt.lib libucrt.lib` |
  | 静态调试版 CRT | `-fms-runtime-lib=static_dbg -Wl,/nodefaultlib:ucrt.lib` | `/MTd /link /nodefaultlib:ucrt.lib` |

  `/MDd` 会加载仅由 Visual Studio 安装提供的 `ucrtbased.dll`。
- **C++ 标准版本**：与 `cl.exe` 一样，`clang` 在 MSVC 目标平台上默认采用 C++14 标准。微软的 STL 在 C++14 模式下也暴露了 `std::is_integral_v` 等部分 C++17 标准库模板，而 `libc++` 仅从 C++17 起提供它们；如果代码依赖这些模板，请传入 `-std=c++17`（`/std:c++17`）或更高标准。

## macOS

macOS 目标平台 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` 基于 Apple 的 macOS SDK 编译，并使用 `ld64.lld` 静态链接 xclang 的 `libc++` 与 `libc++abi`（[macOS 设计](../design/macos.md)）。

### 在 macOS 主机上

在 macOS 主机上，`clang` 直接使用本机 Xcode 或 Command Line Tools 的 SDK，无需通过 `xclang` 下载任何文件：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

### 在 Linux 与 Windows 主机上

在 Linux 与 Windows 主机上，先运行一次 `xclang sdk fetch macos --accept-license` 获取 Apple 的 macOS SDK，即可通过 `--target` 为任一 macOS 架构构建程序：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch macos --accept-license
clang++ -O2 --target=arm64-apple-macos hello.cpp -o hello-macos-arm64
```

| 主机 | 使用的 SDK |
|---|---|
| macOS | 最后一个 `-isysroot`，否则为 `SDKROOT`，再否则为 Xcode 的 SDK（`xcselect`） |
| Linux、Windows | 命令行上最后一个 `-isysroot`，否则为 `<toolchain>/sdk/macos` |

在 Linux 与 Windows 主机上，目标平台配置文件的开头是 `-isysroot <CFGDIR>/../sdk/macos`。由于只有未传入 `-isysroot` 参数时 `clang` 才会读取 `SDKROOT`，且 `--sysroot` 仅作用于链接步骤，如需指定其他 SDK，请在命令行传入 `-isysroot <dir>`（Cargo、`rustc` 以及 xclang 的 [CMake](../integrations/cmake.md) 包会将 `SDKROOT` 转换为 `-isysroot` 传入）。

### 预设与版本

- **预设（Preset）**：`xclang sdk fetch macos` 默认使用 `macos-latest` 预设（`macOS-26-arm64`，SDK 26.5）。传入 `--preset macos-15`（或 `macOS-26`、`macOS-15-arm64`）可匹配对应的 GitHub Actions runner 镜像。
- **锁定版本**：传入 `--version <ver>`（如 `--version 15` 或 `--version 15.5`）会选取 `xclang/sdk-versions.json` 中锁定的最新匹配 SDK；运行 `xclang sdk use <name>` 可在已下载的版本之间切换 `<toolchain>/sdk/macos`（[`xclang` 命令](../reference/xclang-command.md)）。
- **`--version latest`**：直接查询 Apple 的实时软件更新目录，获取命令运行当下最新可用的 SDK；它没有锁定摘要，也不具备可复现性。
- **下架的安装包**：当 Apple 从 CDN 下架某个 Command Line Tools 安装包并替换为重新签名的安装包时，`xclang sdk fetch` 会回退查询 Apple 的更新目录，并通过解压后 SDK 的内容摘要校验其完整性（[macOS 设计](../design/macos.md#packages-apple-withdraws-and-content-digests)）。

### `-stdlib=platform` 与部署目标版本

目标平台配置文件默认设置 `-mmacos-version-min=13.0`；可在命令行传入更高版本的 `-mmacos-version-min=<ver>` 覆盖它。使用 xclang 默认的静态 `libc++` 时，可用的标准库特性只取决于 xclang 版本，而不受目标 macOS 版本限制。启用 `-stdlib=platform`（链接操作系统的 `/usr/lib/libc++.1.dylib`）后，较新的 C++ 标准库符号需要匹配的部署目标版本：例如对浮点数调用 `std::format` 需要 `-mmacos-version-min=13.3` 及以上。

### `ld64.lld` 与 `-fuse-ld=ld`

在所有主机上，macOS 目标平台均使用 `ld64.lld` 链接。`ld64.lld` 会对 `arm64` 二进制文件作临时签名（ad-hoc signing），无需调用 `codesign` 即可在 Apple silicon 上直接运行；`llvm-install-name-tool` 在修改二进制文件后也会重新签名。使用 Developer ID 证书签名及公证（notarization）需要 Apple 官方工具，编译 `.nib`、`.xib` 或资源目录（asset catalog）则需要 macOS 上的 `actool` 与 `ibtool`。

在 macOS 主机上，如需改用 Apple 的 `ld` 链接非 LTO 目标文件，可传入 `-fuse-ld=ld`。由于 xclang 不随附 `libLTO.dylib`，LTO 构建始终使用 `ld64.lld` 链接。

### 两种架构

每个主机压缩包都同时包含 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`，可通过 `llvm-lipo` 将两种架构的程序合并为通用二进制文件（universal binary）。在 macOS 主机上使用 CMake 时，构建另一个 macOS 架构会设置 `CMAKE_OSX_ARCHITECTURES`，不视为交叉编译（[CMake](../integrations/cmake.md)）。

## 运行构建出的程序

使用 `llvm-readobj` 查看交叉编译产物的格式与架构：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --file-headers hello-windows-arm64.exe
```

输出的头部信息中包含 `Format: COFF-ARM64` 与 `Arch: aarch64`。将产物拷贝到对应目标平台的机器上即可直接运行，无需安装任何运行时软件包。部分主机还能直接运行同一操作系统下其他架构的程序：

- `arm64` macOS 可通过 Rosetta 运行 `x86_64` macOS 程序。
- Windows on Arm 可通过模拟运行 `x86_64` Windows 程序。

在一台 runner 上构建并在目标平台的 runner 上运行测试的做法见 [CI](../integrations/ci.md#build-on-one-runner-run-on-another)。

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
