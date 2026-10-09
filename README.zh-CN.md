# xclang

[English](README.md) · [文档（英文）](https://docs.clice.io/xclang)

> 文档目前只有英文版，中文版[计划中](https://docs.clice.io/xclang/design/roadmap#zh-docs)。

像 rustup、cross-rs 和 cargo-zigbuild 让 Rust 交叉编译那样，用 clang 交叉编译：一个编译器面向所有目标平台。现在每个工具链都预编译好了八个目标平台，交叉编译到它们只需要一个 `--target`。它的 `xclang` 命令下载不能再分发的厂商 SDK（微软的和 Apple 的），供 MSVC 目标平台、以及在 Linux 和 Windows 主机上构建 macOS 程序使用。xclang 的方向是：更多目标平台，在构建需要时再下载；运行库也能按需从源码构建。这些都还没有进入任何 release，每一项的状态见[路线图](https://docs.clice.io/xclang/design/roadmap)。

它的目标是接近当下密封（hermetic）的现代 C++ 构建的最佳实践：[Why xclang?](https://docs.clice.io/xclang/guide/why-xclang) 从各个角度论证这一点。

一个目录里装着编译器、链接器、二进制工具，以及这八个目标平台的 sysroot 和运行库：

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

不用 `--sysroot`，不用 `-L`，也不用装 SDK：clang 针对这个目标会读取 `bin/aarch64-w64-mingw32.cfg`，它把 clang 指向 `xclang/aarch64-w64-mingw32/`，链接的是专为这个目标编译的 libc++、libunwind 和 compiler-rt。

## 目标平台

每个主机平台（Linux、Windows、macOS 的 x64 和 arm64）的工具链都带着六个常用目标平台：使用 glibc 2.17 的 Linux x64 和 arm64，使用 MinGW-w64（UCRT）的 Windows x64 和 arm64，以及 macOS arm64 和 x64，在 macOS 主机上用 Xcode 的 SDK。从 23.1.2.10 起还带着 **musl 目标平台**，Linux x64 和 arm64：静态链接的程序，运行时不从系统里拿任何东西（[musl targets](https://docs.clice.io/xclang/reference/targets#musl-targets)）。

用户用工具链自带的 `xclang` 命令（`xclang sdk fetch`）下载 SDK 后，从 23.1.2.7 起还支持：

- **MSVC ABI 的目标平台**：使用微软 CRT 和 Windows SDK 的 Windows x64 和 arm64，C++ 库是 libc++（从 23.1.2.10 起），也可以换成微软的 STL，可在任何主机上构建（[MSVC targets](https://docs.clice.io/xclang/integrations/clang#msvc-targets)）。
- **从 Linux 和 Windows 构建 macOS 程序**，使用 Apple 的 SDK（[macOS](https://docs.clice.io/xclang/design/macos#the-sdk-on-linux-and-windows-hosts)）。

还不支持的，各自在路线图里的状态：

- **其它 Linux 架构**（也包括 musl 的）、WebAssembly、Android、FreeBSD 和裸机：[考虑中](https://docs.clice.io/xclang/design/roadmap#targets)。
- **目标平台包**，供 `xclang target add` 下载上述之外的目标平台：[计划中](https://docs.clice.io/xclang/design/roadmap#target-archives)。

## 适合谁

想要一套可以锁定版本、随项目分发、可复现的工具链，并且希望编出来的程序拷到哪都能跑的人：

- **密封（hermetic）。** 程序运行时只依赖其操作系统每个安装都有、且任何人都不能再分发的系统库：Linux 上是 glibc（2.17 及以上），macOS 上是 libSystem 和程序用到的系统框架，Windows 上是操作系统的 DLL，包括 UCRT（Windows 10 及以上）。其余的一切，包括 libc++、libc++abi、libunwind 和 builtins，都静态链接。构建时来自工具链之外的输入只有厂商 SDK：macOS 主机上本机 Xcode 的 SDK，以及用户用 `xclang` 命令下载的 SDK。sanitizer 运行库是例外（[hermeticity](https://docs.clice.io/xclang/design/hermeticity)）。
- **每个部分都能单独使用。** sysroot 和运行库都是普通目录，按 clang 驱动期望的方式排布。
- **快。** clang 和 lld 用 PGO 和 ThinLTO 构建，并且在每个主机平台上都静态链接 xclang 自己的 libc++。
- **小。** clang、lld 和大部分工具是同一个程序 `llvm`，每个包 89 到 97 MB。
- **也给基于 clang 的工具用**：每个 release 都带着构建它所用的 libclang 和选项表。

它不是用来构建 conda-forge 包的编译器：conda-forge 的 `clang`/`gcc` 动态链接打包好的运行库，并接入 `run_exports`；xclang 有意两样都不做。

## 安装

从 [clice 的 conda 频道](https://conda.clice.io) 用 pixi 安装：

```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "*"
```

`"*"` 即最新的 release，`pixi.lock` 会一直锁定它，直到 `pixi update`。环境激活时把 xclang 的 `bin/` 放到 `PATH` 最前面，不影响 conda-forge 的编译器。也可以从 [GitHub release](https://github.com/clice-io/xclang/releases) 下载压缩包，解压到任意位置使用。[快速开始](https://docs.clice.io/xclang/guide/quick-start)从这里开始，一路做到为每个目标平台编译程序，以及一个用 `import std` 的 CMake 项目。

## 使用

```sh
clang++ main.cpp -o main                                # 本机
clang++ --target=x86_64-w64-mingw32 main.cpp -o main.exe  # 其它目标平台
```

CMake，`import std` 来自工具链自带的 libc++（23.1.2.6 起）：

```cmake
cmake_minimum_required(VERSION 3.28)
project(app LANGUAGES CXX)
find_package(xclang REQUIRED CONFIG)
add_executable(app main.cpp)
target_link_libraries(app PRIVATE xclang::std)
```

Bazel，来自 clice 的模块仓库 [bazel.clice.io](https://bazel.clice.io)：

```starlark
bazel_dep(name = "xclang", version = "23.1.2.8")  # 或更新的版本
```

23.1.2.6 起，换个 platform 就是另一个目标：

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //...
```

## 文档

文档在 [docs.clice.io/xclang](https://docs.clice.io/xclang)（源文件在 [docs/en](docs/en)），目前只有英文版：

- Guide：[What is xclang?](https://docs.clice.io/xclang/guide/what-is-xclang)、[Quick Start](https://docs.clice.io/xclang/guide/quick-start)、[Installation](https://docs.clice.io/xclang/guide/install)、[Cross-Compiling](https://docs.clice.io/xclang/guide/cross-compiling)、[Why xclang?](https://docs.clice.io/xclang/guide/why-xclang)、[Comparisons](https://docs.clice.io/xclang/guide/comparisons)（与 zig cc、llvm-mingw、conda-forge 等的对比）、[FAQ](https://docs.clice.io/xclang/guide/faq)
- Integrations：[CMake](https://docs.clice.io/xclang/integrations/cmake)、[Bazel](https://docs.clice.io/xclang/integrations/bazel)、[Make and Meson](https://docs.clice.io/xclang/integrations/clang)、[Cargo](https://docs.clice.io/xclang/integrations/cargo)、[CI](https://docs.clice.io/xclang/integrations/ci)
- Features：[Modules](https://docs.clice.io/xclang/features/modules)、[Sanitizers](https://docs.clice.io/xclang/features/sanitizers)、[Debugging](https://docs.clice.io/xclang/features/debugging)、[libclang](https://docs.clice.io/xclang/features/libclang)、[ThinLTO Cache](https://docs.clice.io/xclang/features/thinlto-cache)
- Reference：[Targets](https://docs.clice.io/xclang/reference/targets)、[Compatibility](https://docs.clice.io/xclang/reference/compatibility)、[Archive Layout](https://docs.clice.io/xclang/reference/layout)、[CMake API](https://docs.clice.io/xclang/reference/cmake-api)、[Bazel API](https://docs.clice.io/xclang/reference/bazel-api)、[Releases](https://docs.clice.io/xclang/reference/releases)、[LLVM Patches](https://docs.clice.io/xclang/reference/patches)、[xclang Command](https://docs.clice.io/xclang/reference/xclang-command)
- Design：[Hermeticity](https://docs.clice.io/xclang/design/hermeticity)、[PGO](https://docs.clice.io/xclang/design/pgo)、[Roadmap](https://docs.clice.io/xclang/design/roadmap) 等
- Development：[Contributing](https://docs.clice.io/xclang/dev/contributing)、[Build Pipeline](https://docs.clice.io/xclang/dev/release-build)、[Testing](https://docs.clice.io/xclang/dev/testing)、[Releasing](https://docs.clice.io/xclang/dev/releasing)
- [CHANGELOG](CHANGELOG.md)、[贡献](CONTRIBUTING.md)、[安全](SECURITY.md)

xclang 是为 [clice](https://github.com/clice-io/clice) 开发的，clice 的发布构建是它的第一个用户；[catter](https://github.com/clice-io/catter) 也用它构建。
