# 安装

获取 xclang 有四种方式。每种方式提供的都是同一版本的同一套工具链，按项目构建方式选择即可。

| 方式 | 适用场景 | 下载内容 |
|---|---|---|
| [pixi 或 conda](#pixi-and-conda) | 开发机、CI、任意构建系统 | 主机工具链（conda 包形式） |
| [发布压缩包](#archives) | 任意环境：解压即用 | 主机工具链 |
| [CMake FetchContent](#cmake-fetchcontent) | 零预装即可完成配置的 CMake 项目 | 主机工具链（解压至用户缓存目录） |
| [Bazel registry](#bazel) | Bazel 项目 | 主机工具链，以及按需下载的 libclang（通过 `sha256` 校验） |

在本文档中，*工具链目录*（命令行中记作 `$XCLANG`）指安装或解压工具链的目录，其下的 `bin/` 存放 clang、lld 及其他工具（[压缩包目录结构](../reference/layout.md)）。

## pixi 与 conda

xclang 发布在 [clice conda 频道](https://conda.clice.io)。在 pixi 工作区中添加这个频道与 `xclang` 包：

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

- 这个软件包会将包含所有目标平台的主机压缩包解压到 `$PREFIX/opt/xclang`。激活环境后，`$PREFIX/opt/xclang/bin` 会排在 `PATH` 最前面，而不会向 `$PREFIX/bin` 写入任何文件，因此不会影响 conda-forge 的编译器。
- 每个主机平台各有一个软件包：`linux-64`、`linux-aarch64`、`osx-64`、`osx-arm64`、`win-64` 和 `win-arm64`。
- 同一频道下的 `noarch` 包 `llvm-option-inc` 会将选项表安装到 `$PREFIX/include/llvm-options-td`。

xclang 不是用于构建 conda-forge 配方（recipe）的编译器（[封闭性](../design/hermeticity.md)）。

## 压缩包

每个 [GitHub 版本](https://github.com/clice-io/xclang/releases)都会为各主机平台发布一个工具链压缩包 `xclang-<version>-<host>.tar.xz`（约 100 MB）。将其解压到任意位置即可直接运行 `xclang/bin/` 下的工具。最新版本的 `SHA256SUMS` 文件中列出了压缩包文件名与版本号。在 Linux 上：

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

在 macOS 上，使用 `shasum -a 256 -c --ignore-missing SHA256SUMS` 校验摘要。在 Windows 上使用 PowerShell，其中 `tar` 是系统自带的 `C:\Windows\System32\tar.exe`：

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

如需锁定特定版本，将 `v` 设为对应的版本号并从 `releases/download/$v` 下载 `SHA256SUMS` 即可。`hello.cpp` 来自[快速开始](quick-start.md)。可以把 `xclang/bin` 加入 `PATH`，或直接按路径调用可执行文件。Windows 压缩包不含符号链接，无需管理员权限或开发者模式即可解压（[Windows](../targets/windows.md)）。在 Windows 上，`xclang sdk fetch` 下载的厂商 SDK 通过记录绝对路径的目录联接（junction）访问：移动工具链目录后，运行 `xclang sdk use <name>` 即可将其指向新位置，而 macOS SDK 则需重新下载（[`xclang` 命令](../reference/xclang-command.md)）。

## CMake FetchContent

CMake 项目可以在调用 `project()` 之前下载主机工具链，这样机器上只需安装 CMake、Ninja 和 Git 即可完成构建配置：

<!-- excerpt: examples/cmake-fetch/CMakeLists.txt -->
```cmake
include(FetchContent)
FetchContent_Declare(xclang
    GIT_REPOSITORY https://github.com/clice-io/xclang
    GIT_TAG latest)
FetchContent_MakeAvailable(xclang)
include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
```

`xclang.cmake` 会下载对应版本的主机压缩包，对照这个版本的 `SHA256SUMS` 校验后解压到用户缓存目录中，每个版本与主机平台组合只解压一次（[CMake](../integrations/cmake.md)）。

## Bazel

clice 的 Bazel registry [bazel.clice.io](https://bazel.clice.io) 上有 `xclang` 模块。先在 `.bazelrc` 里加上这个 registry：

<!-- excerpt: examples/bazel/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

接着在 `MODULE.bazel` 中声明依赖：

<!-- excerpt: examples/bazel/MODULE.bazel -->
```python
bazel_dep(name = "xclang", version = "23.1.5.1")
```

这个模块会下载主机压缩包并校验锁定的 `sha256`，然后将其注册为所有目标平台的 C++ 工具链（[Bazel](../integrations/bazel.md)）。

## 版本号

每个版本的标签格式均为 `<llvm version>.<revision>`。例如 `23.1.2.1` 是基于 LLVM 23.1.2 的第一次构建，`23.1.2.2` 是第二次。版本号直接标明上游 LLVM 版本，并在 conda、Bazel 和 CMake 中保持一致的排序顺序。

已发布的版本不会覆盖替换。任何修复或重新构建都会作为下一个修订号发布，发布工作流也会拒绝已存在的版本标签。每个版本号及其压缩包的 `sha256` 摘要永久指向逐字节相同的内容。

当改动只涉及打包层（例如 Bazel 模块、CMake 包或目标平台配置文件）时，新版本会采用 *repack* 方式发布：下一个修订号直接复用上一版本的编译器与运行时库，二者逐字节相同。

各个分发渠道都会以 `<version>` 发布版本，并支持锁定特定版本或获取最新版本：

| 渠道 | 发布内容 | 锁定版本 | 获取最新版本 |
|---|---|---|---|
| [GitHub Releases](https://github.com/clice-io/xclang/releases) | 全部 17 个发布文件 | `releases/download/<version>` | `releases/latest`，其中的 `SHA256SUMS` 标明了具体版本号 |
| [conda.clice.io](https://conda.clice.io) | 基于发布压缩包构建的各主机 `xclang` 包与 `noarch` 的 `llvm-option-inc` 包 | `xclang = "<version>.*"`（软件包构建号记录这个版本的打包修复次数） | `xclang = "*"`，由 `pixi.lock` 锁定，直到运行 `pixi update` |
| CMake FetchContent | 仓库标签 `<version>` | `GIT_TAG <version>` | `GIT_TAG latest`（指向最新发布标签的分支） |
| [bazel.clice.io](https://bazel.clice.io) | 基于发布压缩包构建并测试通过后发布的 `xclang` Bazel 模块 | `version = "<version>"` | Bazel 自动解析依赖图中请求的最高版本 |

## 发布文件

每个 [GitHub 版本](https://github.com/clice-io/xclang/releases)都包含固定的 17 个发布文件：

| 发布文件 | 内容 | 大小 |
|---|---|---|
| `xclang-<version>-<host>.tar.xz` | 工具链压缩包，每个主机平台一个，内置全部八个目标平台 | 约 100 MB |
| `libclang-<version>-<host>.tar.xz` | clang 与 LLVM 的静态库及头文件，每个主机平台一个（[libclang](../features/libclang.md)） | 约 265 MB |
| `libclang-<version>-<host>-asan.tar.xz` | 带 ASan 插桩的 libclang 构建，提供 Linux x64 与 macOS arm64 版本 | 约 200 MB |
| `llvm-option-inc-<version>.tar.xz` | 预先生成的 clang、lld、llvm-lib 与 llvm-dlltool 选项表 | 约 200 KB |
| `xclang-<version>.profdata` | 构建这个版本所用的 PGO profile（[PGO](../design/pgo.md)） | 约 50 MB |
| `SHA256SUMS` | 这个版本中其余所有发布文件的 `sha256` 摘要 | |

六个 `<host>` triple 分别为 `x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`、`x86_64-w64-mingw32`、`aarch64-w64-mingw32`、`aarch64-apple-darwin` 和 `x86_64-apple-darwin`。

## 校验下载文件

发布工作流会根据上传的发布文件生成 `SHA256SUMS`。你可以对照 `SHA256SUMS` 校验任意下载的发布文件（如需指定版本，向 `gh release download` 传入 `<version>`）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
gh release download -R clice-io/xclang -p SHA256SUMS -p 'llvm-option-inc-*'
sha256sum -c --ignore-missing SHA256SUMS
```

Bazel 模块会对照 `versions.bzl` 中锁定的 `sha256` 摘要校验每个下载的压缩包；CMake 的 `xclang.cmake` 则会对照这个版本的 `SHA256SUMS` 文件校验工具链压缩包。在 `versions.bzl` 或你自己的仓库中锁定摘要，还能防范 GitHub 上的压缩包与 `SHA256SUMS` 被同时替换；不可变（immutable）GitHub 版本目前在计划中（[路线图](../design/roadmap.md)）。

## 验证安装

从 `PATH` 或工具链目录运行 `clang++ --version`，会输出编译器版本以及表示其所在 `bin/` 目录的 `InstalledDir`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ --version
```

`xclang --version` 会输出其自身版本、工具链目录以及所属版本号 `<llvm version>.<revision>`。每个版本的变更记录在 [CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md) 中。

## 下一步

- [快速开始](quick-start.md)：为各个目标平台构建程序，并构建使用 `import std` 的 CMake 项目。
- [交叉编译](../targets/cross-compiling.md)：目标平台、厂商 SDK 与构建系统参数。
