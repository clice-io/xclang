# 同类工具对比

本页列出承担同类任务的各款工具链、它们各自的做法，以及 xclang 与它们的双向差异（优缺点均据实列出）。文中事实截至 2026-10-06，均附有各项目文档链接。如有出入，欢迎提交 [issue](https://github.com/clice-io/xclang/issues) 指正。

## 一表总览 {#in-one-table}

| | 定位 | 开箱即用的目标平台 | sysroot 与 SDK | 程序中的 C++ 运行时库 | Linux 产物运行环境 | 构建系统集成 | 编译器是否开启 PGO |
|---|---|---|---|---|---|---|---|
| **xclang** | 预编译的 clang、lld 与八个目标平台的运行时库 | Linux x64/arm64（glibc、musl）、Windows x64/arm64（MinGW、MSVC）、macOS x64/arm64 | 内置；Apple 与微软 SDK 由用户从厂商下载，或使用本机 Xcode | 静态链接 libc++；可选平台的 C++ 标准库 | glibc 2.17+，或无依赖（musl 静态链接） | CMake 包、Bazel 模块、`xclang cargo`、conda | 是，所有主机均开启 PGO + ThinLTO |
| **zig cc** 0.17 | Zig 封装其内置 clang 的驱动 | 数十个：glibc、musl、MinGW、macOS、各 BSD、WASI | 内置 libc 源码与桩库（stub），首次使用时编译 | 静态链接 libc++ | 可按目标指定任意 glibc 版本；默认 2.31 | `zig build`；`CC="zig cc"` | 未说明 |
| **cargo-zigbuild** | 将 zig cc 作为 cargo 的链接器 | 其 README 列出的 Linux 与 macOS 目标 | 由 zig 提供；macOS SDK 由用户提供 | 由 zig 提供 | 按目标指定的 glibc 版本 | cargo | 同 zig |
| **cross-rs** | 在带 GCC 交叉工具链的 Docker 镜像中运行 cargo | Rust 大多数 Linux、Windows 及其他目标 | 每个目标一个镜像；Apple 与 MSVC 镜像需用户自行构建 | libstdc++ | 2.31；`:centos` 镜像中为 2.17 | cargo | 否；使用 GCC |
| **llvm-mingw** | clang、lld、mingw-w64 与 LLVM 运行时库 | Windows i686、x86_64、armv7、arm64 | 内置 | 默认动态链接 libc++ DLL，传入 `-static` 时静态链接 | 无 Linux 目标平台 | 任意，通过 `<target>-clang` 命令名调用 | 是，PGO + ThinLTO |
| **conda-forge 编译器** | GCC、clang、MSVC 环境激活包 | conda 支持的各平台（在配方中使用） | `sysroot_linux-*` 包 | 共享库，由 `libstdcxx`/`libcxx` 包通过 `run_exports` 提供 | glibc 2.17+，或显式开启 2.28 | conda-build、rattler-build | 未说明 |
| **LLVM 官方发布版** | 上游预编译二进制 | 仅当前主机 | 无 | 仅主机运行时库 | 主机的 glibc；工具链本身在 Ubuntu 22.04 上构建 | 无 | Linux、macOS：PGO + ThinLTO；Windows：PGO |
| **发行版 clang + GCC 交叉工具链** | 操作系统软件包 | 每个目标平台一组软件包 | 每个目标平台对应的发行版包 | 共享库形式的 libstdc++ | 当前发行版的 glibc | 任意 | 取决于发行版 |
| **Android NDK** | clang 与 bionic sysroot | Android ABI × API 级别 | 内置 | 静态或共享的 libc++ | Android | CMake、ndk-build | 是，含 BOLT |
| **wasi-sdk** | clang 与 wasi-libc | `wasm32-wasip1`、`wasip2` | 内置 | 静态链接 libc++ | WASI | CMake 工具链文件 | 未说明 |
| **toolchains_llvm**（Bazel） | 封装 LLVM 官方二进制的规则 | 当前主机；交叉编译需用户自备 sysroot | 用户自备 | 本机编译时静态链接 libc++，交叉编译时使用 sysroot 的 libstdc++ | 取决于 sysroot | Bazel | 同 LLVM |
| **hermetic_cc_toolchain**（Bazel） | 封装 zig cc 的规则 | Linux glibc 与 musl、windows-gnu、macOS「未充分测试」 | 由 zig 提供 | 静态链接 libc++ | 按目标指定 | Bazel | 同 zig |

## zig cc {#zig-cc}

[`zig cc`](https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html) 在设计理念上最为接近：一次下载，只传 `-target`，无需其他配置。它率先验证了无需单独安装 sysroot 即可用 clang 交叉编译的路线，但具体实现方式与 xclang 不同：

- **首次使用时编译运行时库。** Zig 随包附带 libc++、libc++abi、libunwind、compiler-rt 以及多个 C 标准库的源码，在首次编译某个目标平台时现场构建所需库并缓存（[概览](https://ziglang.org/learn/overview/)），得以在 55 MB 的下载体积中装入数十个目标平台。xclang 则直接提供八个目标平台的预编译运行时库：首次构建无需等待，且所有人拿到的文件逐字节相同。按需下载其他目标平台的预编译压缩包目前在[计划中](../design/roadmap.md#target-archives)。
- **目前支持的目标平台更多**：可按目标指定任意 glibc 版本（如 `x86_64-linux-gnu.2.17`），并支持各 BSD 与 WASI；它还能凭借内置的 Apple libc 头文件与 `libSystem` 桩库在任意主机上编译 macOS 目标（[0.17.0 发布说明](https://ziglang.org/download/0.17.0/release-notes.html)）。xclang 在每个压缩包中内置了 musl（[Linux 目标平台](../targets/linux.md)），并支持由用户下载 Apple 官方 SDK 后在任意主机上编译 macOS 目标（[macOS 目标平台](../targets/macos.md)）。更新版本的 glibc 与 BSD 支持目前在[考虑中](../design/roadmap.md#glibc-newer)。
- **内置的是 Zig 定制版 clang。** 0.17.0 基于 LLVM 22，并为规避 0.16.0 以来的回归问题禁用了循环向量化。xclang 则紧跟 LLVM 官方版本，使用开启 PGO 与 ThinLTO 构建的上游原版 clang。
- **运行时库。** zig 与 xclang 一样静态链接 libc++，在多个共享库各自包含 libc++ 时同样存在已知问题（[#24831](https://github.com/ziglang/zig/issues/24831)）。它不带 ASan 运行时库（[#11403](https://github.com/ziglang/zig/issues/11403)），且 `windows-msvc` 目标依赖本机安装的 Visual Studio。xclang 则为 glibc Linux 与 macOS 目标提供 ASan、TSan、LSan、UBSan 和 libFuzzer，支持从源码构建运行时库以使用 MemorySanitizer，为 MinGW 目标提供 UBSan（以及 x64 的 ASan），并且其 MSVC 目标可在任意主机上配合下载的 SDK 编译，支持 UBSan 以及 x64 的 ASan 与 libFuzzer（[sanitizer](../features/sanitizers.md)）。
- **构建系统集成。** zig cc 可直接作为 `CC` 替换使用；xclang 在此基础上还提供了支持 `import std` 的 CMake 包、Bazel 模块、`xclang cargo` 以及 libclang。

Zig 的 issue 追踪器已于 2025 年 11 月迁移至 Codeberg，上述 GitHub issue 链接反映的是迁移前的状态。

## cargo-zigbuild 与 cross-rs {#cargo-zigbuild-and-cross-rs}

[cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) 将 zig cc 配置为 cargo 的 C 编译器与链接器，其 README 列出了支持的 Linux 与 macOS 目标平台，并支持按目标指定 glibc 版本。

[cross-rs](https://github.com/cross-rs/cross) 在包含对应目标平台 GCC 交叉工具链的 Docker 或 Podman 镜像中运行 cargo，并通过 `cross test` 在 QEMU 下运行测试。其默认镜像使用 glibc 2.31，`:centos` 镜像使用 2.17；出于「许可证原因」，它不提供 Apple 目标平台的镜像。

xclang 配合 cargo 的方式与 cargo-zigbuild 使用 zig 类似，但底层是上游原版 clang 与 xclang 的运行时库：`xclang cargo` 会为各目标平台配置好 cargo 并通过 `xclang` 自身完成链接，正如 cargo-zigbuild 通过其自身程序代理链接一样（[Rust 与 Cargo](../integrations/cargo.md)）。与 cross-rs 不同，xclang 无需容器，在 Windows 和 macOS 主机上均可原生运行，但不在模拟器下运行测试。

## llvm-mingw {#llvm-mingw}

[llvm-mingw](https://github.com/mstorsjo/llvm-mingw) 是一套面向 Windows 目标平台的 clang、lld、mingw-w64 与 LLVM 运行时库，支持在 Linux、macOS 和 Windows 主机上运行。xclang 的 MinGW 目标平台思路相同，sysroot 同样基于 mingw-w64。

- llvm-mingw 支持更多 Windows 架构：i686、armv7，构建脚本中还支持 arm64ec；它提供面向旧版 Windows 的 msvcrt 变体、面向 x86 与 x64 的 ASan（xclang 仅限 x64）以及控制流防护（Control Flow Guard）。
- 除非传入 `-static`，否则它会将 libc++ 和 libunwind 作为 DLL 动态链接（[#333](https://github.com/mstorsjo/llvm-mingw/issues/333)）；xclang 则默认将它们静态链接进程序。
- 它的发布版本同样开启了 PGO 与 ThinLTO 构建。
- 它不包含 Linux 或 macOS 目标平台。

## conda-forge 的编译器 {#conda-forge-s-compilers}

conda-forge 的 `cxx-compiler` 在 Linux 上是 GCC、在 macOS 上是 clang、在 Windows 上是 MSVC，专为构建 conda 软件包设计。C++ 运行时库由 `libstdcxx` 或 `libcxx` 软件包以共享库形式提供，并通过 `run_exports` 自动加入每个产物的运行时依赖；Linux 基线通过 `sysroot_linux-*` 包设定为 glibc 2.17（[知识库](https://conda-forge.org/docs/maintainer/knowledge_base/)）。

这套机制适合由 conda 统一提供运行时库的环境，但一旦程序脱离 conda 环境就无法独立运行。xclang 虽然也提供 conda 包，但不是用来构建 conda-forge 软件包的编译器：它会将运行时库静态链接进每个程序，且不设置 `run_exports`。

## LLVM 官方发布二进制 {#llvm-s-release-binaries}

[LLVM 官方发布版](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.5)包含面向当前主机的 clang、lld 与运行时库，在 Linux 和 macOS 上开启 PGO 与 ThinLTO 构建（`clang/cmake/caches/Release.cmake`），在 Windows 上开启 PGO 但未开启 LTO。它们不附带其他目标平台的 sysroot，交叉编译需要另行准备 sysroot。单个压缩包体积在 0.9 到 2 GB 之间。

xclang 的压缩包约 100 MB，内置八个目标平台，且工具链自身可在 glibc 2.17 上运行。编译速度方面，xclang 在 Linux 与 macOS 上与上游相当，在 Windows 上更快（[PGO](../design/pgo.md)）。

## 发行版自带的 Clang 与 GCC 交叉工具链 {#distribution-clang-and-gcc-cross-toolchains}

在 Debian 上，`crossbuild-essential-arm64` 提供 `aarch64-linux-gnu-g++` 以及与当前发行版同版本的 arm64 glibc（[packages.debian.org](https://packages.debian.org/trixie/crossbuild-essential-arm64)）；`g++-mingw-w64` 提供 MinGW GCC，apt.llvm.org 则提供各个版本的 clang。它们是 Linux 机器上的默认选择，维护良好，但存在以下限制：

- 编译出的程序需要不低于当前发行版版本的 glibc，并依赖 `libstdc++.so.6`。
- MinGW GCC 编译出的程序除非传入 `-static` 链接，否则运行时需要 `libstdc++-6.dll` 和 `libgcc_s_seh-1.dll`。
- 每增加一个目标平台，都需要安装另一套软件包。
- 仅在 Linux 主机上可用。

## Android NDK 与 wasi-sdk：先例 {#android-ndk-and-wasi-sdk-the-precedents}

这两者都是「单个 clang 配内置 sysroot」的形态，xclang 将同样的结构带到了桌面与服务器目标平台。

- [NDK](https://developer.android.com/ndk/guides/other_build_systems) 通过 `--target=aarch64-linux-android21` 同时指定目标架构与 API 级别，且在 CMake 中默认静态链接 libc++。其 [C++ 库支持](https://developer.android.com/ndk/guides/cpp-support)页面写明了一条 xclang 静态运行时库同样遵循的规则：「只有当应用中最多只有一个共享库时，才可以使用静态版 C++ 运行时库。」Android 自身的 clang 开启了 PGO、LTO 与 BOLT 构建。
- [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) 是「预先配置好默认目标平台与 sysroot 的构建版本」，这正是 xclang 中每个目标平台的配置文件所做的事。

## Bazel 工具链 {#bazel-toolchains}

[toolchains_llvm](https://github.com/bazel-contrib/toolchains_llvm) 会下载当前主机的 LLVM 官方发布版；交叉编译时需要用户自备 sysroot，并链接这个 sysroot 中的 libstdc++。[hermetic_cc_toolchain](https://github.com/uber/hermetic_cc_toolchain) 基于 zig cc 构建并继承其目标平台，不含 macOS SDK，其 macOS 支持处于「未充分测试」状态。

xclang 的 [Bazel 模块](../integrations/bazel.md)自带 sysroot，并为每个主机与目标平台组合注册工具链。它的构建动作不含绝对路径，同时提供 `import std`、sanitizer 特性以及 libclang。
