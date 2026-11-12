# 版本发布

xclang 的每个版本都会发布到 GitHub Releases、clice conda 频道、CMake `FetchContent` 以及 clice Bazel registry。安装 xclang 的方式见[快速开始](../guide/quick-start.md)，解压后压缩包内的目录结构见[压缩包目录结构](layout.md)。

## 版本号

每个版本的标签格式均为 `<llvm version>.<revision>`。例如 `23.1.2.1` 是基于 LLVM 23.1.2 的第一次构建，`23.1.2.2` 是第二次。版本号直接标明上游 LLVM 版本，并在 conda、Bazel 和 CMake 中保持一致的排序顺序。

已发布的版本不会覆盖替换。任何修复或重新构建都会作为下一个修订号发布，发布工作流也会拒绝已存在的版本标签。每个版本号及其压缩包的 `sha256` 摘要永久指向逐字节相同的内容。每个版本的变更记录在 [CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md) 中。

## 重新打包（Repack）

当改动只涉及打包层（例如 Bazel 模块、CMake 包或目标平台配置文件）时，新版本会采用 *repack* 方式发布：下一个修订号直接复用上一版本的编译器与运行时库，二者逐字节相同。

## 分发渠道

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
| `xclang-<version>-<host>.tar.xz` | 工具链压缩包，每个主机平台一个，内置全部八个目标平台（[压缩包目录结构](layout.md)） | 约 100 MB |
| `libclang-<version>-<host>.tar.xz` | `clang` 与 LLVM 的静态库及头文件，每个主机平台一个（[libclang](../features/libclang.md)） | 约 265 MB |
| `libclang-<version>-<host>-asan.tar.xz` | 带 ASan 插桩的 `libclang` 构建，提供 Linux x64 与 macOS arm64 版本（[ASan 构建](../features/libclang.md#the-asan-build)） | 约 200 MB |
| `llvm-option-inc-<version>.tar.xz` | 预先生成的 `clang`、`lld`、`llvm-lib` 与 `llvm-dlltool` 选项表（[选项表](../features/libclang.md#the-option-tables)） | 约 200 KB |
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

Bazel 模块会对照 `versions.bzl` 中锁定的 `sha256` 摘要校验每个下载的压缩包；CMake 的 `xclang.cmake` 则会对照这个版本的 `SHA256SUMS` 文件校验工具链压缩包。在 `versions.bzl` 或你自己的仓库中锁定摘要，还能防范 GitHub 上的压缩包与 `SHA256SUMS` 被同时替换（[不可变 GitHub 版本](../design/roadmap.md#immutable-releases)）。

## 可复现构建

每次发布都会在两台机器上各打包一次每个主机的压缩包、各构建一次 `xclang` 命令，再逐字节比对：压缩包里的条目按顺序排列，时间取提交的时间，不记录所有者，并按固定分块压缩。用某个修订号的 profile（`xclang-<version>.profdata`）重新构建，应当能得到完全相同的全部压缩包；每次完整重建都会再启动一次完整构建，在发布之前确认这一点。这是检查出来的，不是保证：构建 xclang 的编译器或链接器本身有 bug，就可能破坏它。重新构建还需要 GitHub 的 runner，因为程序里留有构建时的部分路径，macOS 构建也会记下 runner 上 Xcode 的 SDK 版本。
