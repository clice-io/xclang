# xclang

[English](README.md) · [文档](https://docs.clice.io/xclang)

像 rustup、cross-rs 和 cargo-zigbuild 让 Rust 交叉编译那样，用 clang 交叉编译：一个编译器面向所有目标平台。常用的目标平台随工具链附带；其余的（更多目标平台，以及不能再分发的厂商 SDK）在构建需要时再下载。运行库是预编译好的，以后也会支持按需从源码构建。有点像 `zig cc`，用的是原版 clang，而且不把所有东西都打包进来。

它的目标是接近当下密封（hermetic）的现代 C++ 构建的最佳实践：[Why xclang](https://docs.clice.io/xclang/guide/why-xclang) 从各个角度论证这一点，每一条都给出验证它的测试，以及还缺什么。

现在，一个目录里装着编译器、链接器、二进制工具，以及六个目标平台的 sysroot 和运行库，交叉编译只需要一个 `--target`：

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

不用 `--sysroot`，不用 `-L`，也不用装 SDK：clang 针对这个目标会读取 `bin/aarch64-w64-mingw32.cfg`，它把 clang 指向 `xclang/aarch64-w64-mingw32/`，链接的是专为这个目标编译的 libc++、libunwind 和 compiler-rt。

## 目标平台

每个主机平台（Linux、Windows、macOS 的 x64 和 arm64）的工具链都带着六个常用目标平台：使用 glibc 2.17 的 Linux x64 和 arm64，使用 MinGW-w64（UCRT）的 Windows x64 和 arm64，以及 macOS arm64 和 x64，后者用 Xcode 的 SDK，所以只能在 macOS 主机上构建。

MinGW 是目前的 Windows 目标平台；MSVC ABI 的目标平台（使用用户自己下载的 MSVC 和 Windows SDK）将得到同等的一等支持，目前在研究中，从任意主机用 Apple 的 SDK 构建 macOS 程序也在研究中。一个用来下载更多目标平台和厂商 SDK 的命令 `xclang`（`xclang target add`、`xclang sdk fetch`）已经在仓库里，并由 CI 测试，但还没有进入任何 release。[路线图](https://docs.clice.io/xclang/design/roadmap)列出了各个目标平台、它们的支持等级（tier）和进展。

## 适合谁

想要一套可以锁定版本、随项目分发、可复现的工具链，并且希望编出来的程序拷到哪都能跑的人：

- **密封（hermetic）。** 程序运行时只依赖其操作系统每个安装都有、且任何人都不能再分发的系统库：Linux 上是 glibc（2.17 及以上），macOS 上是 libSystem 和程序用到的系统框架，Windows 上是操作系统的 DLL，包括 UCRT（Windows 10 及以上）。其余的一切，包括 libc++、libc++abi、libunwind 和 builtins，都静态链接。构建时唯一来自外部的输入是锁定版本的厂商 SDK。sanitizer 运行库是例外（[hermeticity](https://docs.clice.io/xclang/design/hermeticity)）。
- **每个部分都能单独使用。** sysroot 和运行库都是普通目录，按 clang 驱动期望的方式排布。
- **快。** clang 和 lld 用 PGO 和 ThinLTO 构建，并且在每个主机平台上都静态链接 xclang 自己的 libc++。
- **小。** clang、lld 和大部分工具是同一个程序 `llvm`，每个包 95 到 128 MB。
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
xclang = "23.1.2.6.*"
```

环境激活时把 xclang 的 `bin/` 放到 `PATH` 最前面，不影响 conda-forge 的编译器。也可以从 [GitHub release](https://github.com/clice-io/xclang/releases) 下载压缩包，解压到任意位置使用。[快速开始](https://docs.clice.io/xclang/guide/quick-start)从这里开始，一路做到为每个目标平台编译程序，以及一个用 `import std` 的 CMake 项目。

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
bazel_dep(name = "xclang", version = "23.1.2.6")
```

23.1.2.6 起，换个 platform 就是另一个目标：

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //...
```

## 文档

文档在 [docs.clice.io/xclang](https://docs.clice.io/xclang)（源文件在 [docs/en](docs/en)），目前只有英文，中文之后补上：

- Guide：[What is xclang](https://docs.clice.io/xclang/guide/what-is-xclang)（以及什么时候不该用它）、[Why xclang](https://docs.clice.io/xclang/guide/why-xclang)（为什么说它接近密封 C++ 工具链的最佳实践，附证据和不足）、[Quick start](https://docs.clice.io/xclang/guide/quick-start)、[Installing](https://docs.clice.io/xclang/guide/install)、[Cross-compiling](https://docs.clice.io/xclang/guide/cross-compiling)、[Comparisons](https://docs.clice.io/xclang/guide/comparisons)（与 zig cc、llvm-mingw、conda-forge 等的对比）、[FAQ](https://docs.clice.io/xclang/guide/faq)
- Integrations：[CMake](https://docs.clice.io/xclang/integrations/cmake)、[Bazel](https://docs.clice.io/xclang/integrations/bazel)、[clang、Make 和 Meson](https://docs.clice.io/xclang/integrations/clang)、[Rust 和 cargo](https://docs.clice.io/xclang/integrations/cargo)、[CI](https://docs.clice.io/xclang/integrations/ci)
- Features：[C++20 模块](https://docs.clice.io/xclang/features/modules)、[sanitizer](https://docs.clice.io/xclang/features/sanitizers)、[调试](https://docs.clice.io/xclang/features/debugging)、[ThinLTO 缓存](https://docs.clice.io/xclang/features/thinlto-cache)、[libclang](https://docs.clice.io/xclang/features/libclang)
- Reference：[目标平台和支持等级](https://docs.clice.io/xclang/reference/targets)、[目录结构](https://docs.clice.io/xclang/reference/layout)、[兼容性](https://docs.clice.io/xclang/reference/compatibility)、[CMake API](https://docs.clice.io/xclang/reference/cmake-api)、[Bazel API](https://docs.clice.io/xclang/reference/bazel-api)、[版本和发布](https://docs.clice.io/xclang/reference/releases)
- Design：[hermeticity](https://docs.clice.io/xclang/design/hermeticity)、[PGO](https://docs.clice.io/xclang/design/pgo)、[release 是怎么构建的](https://docs.clice.io/xclang/design/release-build)、[补丁](https://docs.clice.io/xclang/design/patches)、[路线图](https://docs.clice.io/xclang/design/roadmap) 等
- [CHANGELOG](CHANGELOG.md)、[贡献](CONTRIBUTING.md)、[安全](SECURITY.md)

xclang 是为 [clice](https://github.com/clice-io/clice) 开发的，clice 的发布构建是它的第一个用户；[catter](https://github.com/clice-io/catter) 也用它构建。
