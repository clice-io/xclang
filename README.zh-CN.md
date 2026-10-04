# xclang

[English](README.md)

一个自包含的 clang 工具链。一个目录里装着编译器、链接器、二进制工具，以及它支持的每个目标平台的 sysroot 和运行库，交叉编译只需要一个 `--target`：

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

不用 `--sysroot`，不用 `-L`，也不用装 SDK：clang 针对这个目标会读取 `bin/aarch64-w64-mingw32.cfg`，它把 clang 指向 `xclang/aarch64-w64-mingw32/`，链接的是专为这个目标编译的 libc++、libunwind 和 compiler-rt。可以理解为用原版 clang 做的 `zig cc`。每个主机平台（Linux、Windows、macOS 的 x64 和 arm64）都带着全部六个目标平台；macOS 目标平台用 Xcode 的 SDK。

## 适合谁

想要一套可以锁定版本、随项目分发、可复现的工具链，并且希望编出来的程序拷到哪都能跑的人：

- **默认密封（hermetic）。** libc++、libc++abi、libunwind 和 builtins 都是静态链接的，Linux 程序只需要 glibc 2.17。产物只依赖操作系统本身。
- **每个部分都能单独使用。** sysroot 和运行库都是普通目录，按 clang 驱动期望的方式排布。
- **快。** clang 和 lld 用 PGO 和 ThinLTO 构建，并且在每个主机平台上都静态链接 xclang 自己的 libc++。
- **小。** clang、lld 和大部分工具是同一个程序 `llvm`，每个包 80 到 120 MB。
- **也给基于 clang 的工具用**：每个 release 都带着构建它所用的 libclang 和选项表。

它不是用来构建 conda-forge 包的编译器：conda-forge 的 `clang`/`gcc` 动态链接打包好的运行库，并接入 `run_exports`；xclang 有意两样都不做。

## 安装

从 [clice 的 conda 频道](https://conda.clice.io) 用 pixi 安装：

```toml
[workspace]
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "osx-arm64", "win-64"]

[dependencies]
xclang = "23.1.2.5.*"
```

环境激活时把 xclang 的 `bin/` 放到 `PATH` 最前面，不影响 conda-forge 的编译器。也可以从 [GitHub release](https://github.com/clice-io/xclang/releases) 下载压缩包，解压到任意位置使用。

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
bazel_dep(name = "xclang", version = "23.1.2.5")
```

## 文档

文档为英文：

- [Installing](docs/install.md)：pixi 和 conda、release 压缩包、版本号
- [Using clang](docs/clang.md)：目标平台和配置文件、GCC 的库名、sanitizer、手动 `import std`
- [CMake](docs/cmake.md)：`find_package(xclang)`、`xclang::std`、其它目标平台、用 FetchContent 下载工具链
- [Bazel](docs/bazel.md)：模块、工具链、C++20 模块和 sanitizer
- [libclang and the option tables](docs/libclang.md)：给基于 clang 的工具用
- [Hosts, targets and layout](docs/layout.md)：主机平台、目标平台、目录结构和限制
- [How a release is built](docs/build.md)：PGO 流程、测试、workflow、仓库结构
- [Patches](docs/patches.md)：对 LLVM 的修改
- [Roadmap](docs/roadmap.md)：计划中、在考虑中和在研究中的工作
- [CHANGELOG](CHANGELOG.md)

xclang 是为 [clice](https://github.com/clice-io/clice) 开发的，clice 的发布构建是它的第一个用户；[catter](https://github.com/clice-io/catter) 也用它构建。
