# xclang 命令

`xclang` 用于获取工具链未内置且不允许二次分发的厂商 SDK，并在运行 cargo 时将当前工具链设为各目标平台的 C 编译器与链接器。每个工具链压缩包都内置了这个命令，位于 `bin/xclang`（在 Windows 上为 `xclang.exe`）。SDK 为什么由用户自行获取而不随包分发，见[交叉编译](../guide/cross-compiling.md)。

```text
xclang sdk list [macos|windows]
xclang sdk fetch macos --accept-license [--preset P] [--version V]
xclang sdk fetch windows --accept-license [--preset P] [--msvc-version V] [--sdk-version V] [--arch x86_64,aarch64,x86]
xclang sdk path macos|windows [the selection options of fetch]
xclang sdk packages macos|windows [the selection options of fetch] [--json]
xclang sdk use <name>
xclang sdk remove <name>
xclang target list
xclang target add <target>...
xclang target remove <target>...
xclang cargo <cargo's arguments>
xclang --version
```

## 厂商 SDK

`xclang sdk fetch` 直接从厂商下载 SDK。为应对偶发的下载中断或文件损坏，每次下载最多重试三次，并对照版本表中锁定的文件大小与 sha256 摘要校验。如果某个 macOS SDK 所在的安装包已被 Apple 下架，它会在 Apple 软件更新目录列出的其他安装包中寻找对应版本，并校验 SDK 的内容摘要（[原因见此](../design/macos.md#packages-apple-withdraws-and-content-digests)）。校验通过后，它会将 SDK 解压到独立目录中：

| SDK | 目录 | 用途 |
|---|---|---|
| macOS | `$XCLANG/sdk/macos-<version>` | 在 Linux 与 Windows 主机上运行 `clang++ --target=arm64-apple-macos`（[macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)）；在 macOS 主机上或使用工具链外部的 SDK 时，需传入 `-isysroot <dir>` |
| MSVC 与 Windows SDK | `$XCLANG/sdk/windows-msvc<version>-sdk<version>` | `clang++ --target=x86_64-pc-windows-msvc`、`clang-cl`：[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets) |

| 命令或选项 | |
|---|---|
| `--accept-license` | 未传入时，fetch 会打印厂商的许可条款并停止 |
| `sdk path` | 打印在给定相同选择选项（`--preset`、`--version`、`--msvc-version`、`--sdk-version`、`--arch`）时 fetch 解压的目标目录，例如 `-isysroot "$(xclang sdk path macos)"`。传入 `--arch` 时，如果目录中的 SDK 缺少所列的任一架构，命令会报错失败 |
| `sdk packages` | 打印在给定相同选择选项时，fetch 为尚未获取的 SDK 所需下载的安装包：列出每个安装包的 sha256、文件大小和 URL，或配合 `--json` 输出 `{"name": <the SDK's directory>, "packages": [{"url", "size", "sha256", "file"}]}`。构建系统可自行将这些安装包按 `file` 字段的文件名下载到某个目录中，再交由 `fetch --cache` 从中读取；Bazel 模块正是这样做的（[Bazel](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)）。对于构建系统无法自行下载的安装包——例如已被 Apple 下架的安装包，或没有锁定 sha256 的安装包（超出版本表的 `--version latest`）——仍由 fetch 自行下载 |
| `--cache <dir>` | fetch 将下载的文件保存在此目录中，并按 sha256 直接复用目录中已有的文件 |
| `sdk list` | 列出 xclang 支持的预设与版本（标明默认项）、已下载的 SDK 以及当前启用的 SDK；解压最后一步写出的 `.xclang-sdk.json` 记录了 SDK 的来源信息，缺少此文件的目录会被列为未完成 |
| `sdk use <name>` | 将某个已下载的 SDK 设为当前启用的版本（见下文） |
| `sdk remove <name>` | 删除已下载的 SDK；若它是当前启用的版本，还会一并删除指向它的链接 |
| `--preset <image>` | 使用对应 GitHub runner 镜像或标签（如 `windows-2022`、`macos-15`）的 SDK 版本；默认分别为 `windows-latest` 与 `macos-latest` |
| `--version`, `--sdk-version`, `--msvc-version` | 指定完整或部分版本号（如 `15`、`10.0.26100`、`14.44`）以替代预设版本，匹配时选取最新的对应版本。`--version latest` 会选取当前 Apple 更新目录中列出的最新 macOS SDK，它可能超出版本表范围，且不具备可复现性 |
| `--arch <archs>` | 要下载的 Windows SDK 架构，可选 `x86_64`、`aarch64` 与 `x86`，默认为 `x86_64,aarch64`。再次下载同一 SDK 时会保留已有的架构，例如传入 `--arch x86` 会追加 x86 架构 |
| `--sdk-dir <dir>` | 存放 SDK 的其他目录，适用于工具链安装在只读目录中的场景 |
| `--links <how>` | fetch 创建 macOS SDK 内链接的方式：`junction` 使用目录联接与硬链接（Windows 默认）；`symlink` 使用符号链接（其他系统默认）；或 `copy` 直接拷贝文件 |
| `--root <dir>` | 命令所操作的工具链目录，默认为命令自身所在的工具链 |

重新下载已存在的 SDK 时，会先将旧目录暂存为 `.<name>.old`，再重新解压，直到新目录完整就绪后才清理旧目录。如果下载或解压失败，会将旧目录恢复原位，保持可用；如果过程被中断，则留待下次执行时恢复。在此期间，磁盘需要留有同时容纳新旧两个 SDK 的空间。如果旧目录无法移开（例如在 Windows 上有程序正打开其中的文件），下载会立即停止，原有 SDK 保持不变。

### 当前启用的 SDK

最后一次下载的 SDK 或由 `sdk use` 指定的 SDK 即为当前启用的版本：`$XCLANG/sdk/windows` 与 `$XCLANG/sdk/macos` 会通过符号链接（在 Windows 上则是无需提权的目录联接）指向它，从而为配置文件提供固定路径。每个 Windows SDK 都按已下载的架构和驱动模式包含对应的配置文件 `<arch>-pc-windows-msvc.cfg` 与 `<arch>-pc-windows-msvc-clang-cl.cfg`，其中记录了 SDK 路径及具体版本号。MSVC 目标平台自身的配置文件会通过 `bin/<arch>-pc-windows-msvc-sdk.cfg` 与 `bin/<arch>-pc-windows-msvc-clang-cl-sdk.cfg` 读取它们，而这两个文件会在运行 `fetch`、`use` 和 `remove` 时改写：通过 `sdk/windows` 引入当前启用 SDK 的配置文件，或标明当前没有对应架构的 SDK（[原因见此](../guide/cross-compiling.md#msvc-targets)）。更新 conda 软件包会重置这些文件，使其不指向任何 SDK；再次运行 `sdk use` 即可重新启用。在 Linux 与 macOS 主机上，配置文件也会直接指定 `sdk/windows`。在 Linux 与 Windows 主机上，macOS 目标平台的配置文件会将 `sdk/macos` 设为 `-isysroot`（[原因见此](../guide/cross-compiling.md#on-linux-and-windows-hosts)）；而在 macOS 主机上默认使用 Xcode 的 SDK，若要使用下载的 SDK 则需手动传入 `-isysroot`。通过 `--sdk-dir` 下载的 SDK 位于工具链目录之外，工具链自带的配置文件不会自动查找它。

在 Windows 上，目录联接记录的是绝对路径。移动工具链目录后，运行 `xclang sdk use <name>` 可将 `sdk/windows` 或 `sdk/macos` 重新指向新位置下的 SDK。在 Windows 上默认使用目录联接下载的 macOS SDK 内部还包含大量目录联接：移动工具链目录后请重新下载，或在下载时传入 `--links copy` 以免生成任何链接。

### 版本

编译进程序内部的 `xclang/sdk-versions.json` 列出了厂商提供的所有版本：

- NuGet 上的 Windows SDK；
- Visual Studio 各发布频道中的 MSVC 工具集；
- Apple 软件更新目录中的 macOS SDK 安装包；
- 预设（preset）：GitHub runner 镜像所使用的版本，使交叉构建环境与 CI 工作流一致。其中 `windows-2022` 包含 MSVC 14.44，其 STL 仍支持 Windows 7 SP1 与 8.1。

未指定版本时，默认采用预设中的版本。

### 下载内容

**macOS** 来自 `swcdn.apple.com` 上的 Command Line Tools 安装包，无需 Apple ID。解压时会跳过 man 手册、可执行工具与 Perl 文件。在 Windows 上，符号链接会转换为无需提权的目录联接（针对目录）和硬链接（针对文件）。下载体积为 62 MB，解压后为 610 MB。

**Windows** 来自 Visual Studio 的 `.vsix` 包与 NuGet 的 `Microsoft.Windows.SDK.CPP` 包，按 Visual Studio 安装目录的 `/winsysroot` 结构排布。`.vsix` 包提供 CRT 与 STL：包括头文件、STL 的 `std` 模块源码（`std.ixx`），以及各架构的静态与 DLL 运行时库和静态运行时库的 PDB 文件。调试构建链接时会查找这些 PDB 文件，缺失则会报 LNK4099 警告。在区分大小写的文件系统上，解压时还会创建约 3,600 个链接，兼容 Windows 代码常用的大小写拼写。同时下载 x64 与 arm64 时下载体积为 600 MB，解压后为 1.8 GB。

## 目标平台

`xclang target list` 列出当前版本的目标平台，目前全部内置于工具链中。`xclang target add` 与 `target remove` 用于安装和移除以独立压缩包发布的目标平台，目前尚无版本发布此类压缩包（[目标平台压缩包](../design/roadmap.md#target-archives)）。

## cargo

`xclang cargo build --target <Rust target>` 及其他 cargo 子命令会在运行 cargo 时设好目标平台（由 `--target`、`build.target` 指定，或取当前主机）所需的各项环境变量。每个目标平台的链接器都是 `xclang` 自身，在缓存目录中命名为 `<Rust target>-linker`，负责带上目标平台所需的参数调用 clang（MSVC 目标平台则调用 lld-link）。如果目标平台缺少 Rust 标准库，会自动运行 `rustup target add` 安装；如果缺少厂商 SDK，则会提示运行对应的 `xclang sdk fetch` 命令。针对各个目标平台设置的具体变量见 [Rust 与 Cargo](../integrations/cargo.md#what-xclang-cargo-sets)。

## 网络

所有网络请求只发送 `User-Agent: xclang/<version>`，不附带任何其他用户信息。TLS 由基于 ring 的 rustls 实现，证书则对照操作系统的信任库校验：macOS 上使用 Security.framework，Windows 上使用系统证书存储，Linux 上读取系统的 CA 证书文件。因此企业内部安装的根证书也会自动受信任。如果 Linux 系统未安装 CA 证书文件，则会回退使用 Mozilla 根证书列表。

## 环境变量

| 变量 | |
|---|---|
| `XCLANG_ROOT` | 工具链目录，同 `--root` |
| `XCLANG_SDK_DIR` | 存放 SDK 的其他目录，同 `--sdk-dir` |
| `XCLANG_JOBS` | 解压使用的线程数，默认为每个逻辑 CPU 一个线程 |
| `XCLANG_TARGET_INDEX` | 指定其他目标平台索引，同 `--index` |
| `XCLANG_CACHE_DIR` | `xclang cargo` 存放链接器包装程序与 CMake 工具链文件的目录，默认为用户缓存目录下的 `xclang` |
| `XCLANG_STDLIB` | 设为 `platform` 时，`xclang cargo` 使用平台的 C++ 标准库编译 C++ 代码（[Rust 与 Cargo](../integrations/cargo.md#the-system-s-c-library)） |
| `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` | 代理设置，均会生效 |
| `SSL_CERT_FILE` | CA 证书文件路径，在 Linux 上读取 |
