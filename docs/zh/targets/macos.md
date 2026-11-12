# macOS

macOS 目标平台 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`（以及 `arm64-apple-darwin`、`*-apple-macos` 和 `*-apple-macosx` 等写法）在所有主机上均基于 Apple 的 macOS SDK 编译，将 xclang 的 `libc++` 与 `libc++abi` 静态链接进可执行文件，并使用 `ld64.lld` 链接（[交叉编译](cross-compiling.md)）。编译出的程序默认可在 macOS 13.0 及以上系统运行。

## 在 macOS 主机上

在 macOS 主机上，`clang` 直接使用本机 Xcode 或 Command Line Tools 的 SDK，无需通过 `xclang` 下载任何文件：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

`clang` 按标准顺序查找 SDK：优先使用命令行上最后一个 `-isysroot`，其次是 `SDKROOT` 环境变量，最后是 Xcode 或 Command Line Tools 的 SDK（通过 `xcselect` 查找，解析结果与 `xcrun` 一致）。

## 在 Linux 与 Windows 主机上

在 Linux 与 Windows 主机上，先运行一次 `xclang sdk fetch macos --accept-license` 获取 Apple 的 macOS SDK，即可通过 `--target` 为任一 macOS 架构构建程序：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch macos --accept-license
clang++ -O2 --target=arm64-apple-macos hello.cpp -o hello-macos-arm64
```

`xclang sdk fetch macos` 会将 SDK 解压到 `<toolchain>/sdk/macos-<version>`，并将 `<toolchain>/sdk/macos` 指向它（[`xclang` 命令](../reference/xclang-command.md)）。在 Linux 与 Windows 主机上，macOS 目标平台配置文件的开头是 `-isysroot <CFGDIR>/../sdk/macos`，因此只传 `--target` 时会自动使用当前启用的 SDK：

| 主机 | 使用的 SDK |
|---|---|
| macOS | 最后一个 `-isysroot`，否则为 `SDKROOT`，再否则为 Xcode 的 SDK（`xcselect`） |
| Linux、Windows | 命令行上最后一个 `-isysroot`，否则为 `<toolchain>/sdk/macos` |

在 Linux 与 Windows 主机上，由于只有未传入 `-isysroot` 参数时 `clang` 才会读取 `SDKROOT`，而目标平台配置文件已经提供了 `-isysroot`，因此 `clang` 自身不会读取 `SDKROOT`。传入 `--sysroot` 也不会替换 SDK（编译阶段仍会使用配置文件中的 `-isysroot`，只有链接阶段会使用 `--sysroot`）。如需指定其他 SDK，请在命令行传入 `-isysroot <dir>`；支持 `SDKROOT` 的构建系统（包括 cargo、rustc 以及 [CMake](../integrations/cmake.md) 包）会将其转换为 `-isysroot` 传入，从而覆盖默认路径。如果既未下载 SDK 也未传入 `-isysroot`，`clang` 会警告 `sdk/macos` 不存在，并找不到任何 C 头文件。

### 预设、版本号与 `latest`

- **预设（Preset）**：`xclang sdk fetch macos` 默认使用 `macos-latest` 预设（`macOS-26-arm64`，SDK 26.5）。传入 `--preset macos-15`（或 `macOS-26`、`macOS-15-arm64`）可下载与对应 GitHub Actions runner 镜像一致的 SDK 版本。
- **锁定版本**：传入 `--version <ver>`（如 `--version 15` 或 `--version 15.5`）会选取 `xclang/sdk-versions.json` 中锁定的最新匹配 SDK。运行 `xclang sdk use <name>` 可在已下载的多个版本之间切换 `<toolchain>/sdk/macos`（[`xclang` 命令](../reference/xclang-command.md)）。
- **`--version latest`**：直接查询 Apple 的实时软件更新目录，获取命令运行当下最新可用的 macOS SDK。由于这个 SDK 可能比 `xclang/sdk-versions.json` 版本表中的更新，它没有锁定摘要，也不具备可复现性。
- **下架的安装包**：当 Apple 从 CDN 下架某个 Command Line Tools 安装包并替换为重新签名的安装包时，`xclang sdk fetch` 会自动回退查询 Apple 的更新目录，并通过解压后 SDK 的内容摘要校验其完整性（[见下文](#packages-apple-withdraws-and-content-digests)）。

## xclang 的 libc++ 与 `-stdlib=platform`

macOS 目标平台配置文件会将 xclang 的 `libc++` 头文件加入 C++ 头文件搜索路径，并把 xclang 的静态库 `libc++.a`（内含 `libc++abi`）排在 SDK 的 `libc++.tbd` 之前。栈展开库（unwinder）则使用系统 `libSystem` 自带的实现（[封闭性](../design/hermeticity.md)）。

静态链接 xclang 的 `libc++` 有两个好处：

- **C++ 标准库特性不受目标系统版本限制**：Apple 的 SDK 会为较新的 `libc++` 特性加上可用性属性（availability attribute），将其绑定到首次在 `/usr/lib/libc++.1.dylib` 中提供这些特性的 macOS 版本。将 xclang 的 `libc++` 静态链接进程序后，可用的标准库特性只取决于 xclang 版本，而不受目标 macOS 版本限制。
- **跨平台一致的 `libc++`**：程序在 macOS、Linux 与 Windows 上使用的是同一套 `libc++` 实现。

传入 `-stdlib=platform` 可改用 SDK 中的 C++ 标准库（即操作系统的 `/usr/lib/libc++.1.dylib`），同时保持相同的 SDK、部署目标版本与链接器（[交叉编译](cross-compiling.md#the-platform-s-c-library)）。当需要跨接口向基于系统 `libc++` 编译的库传递 C++ 类型，或希望直接使用操作系统自带的 C++ 运行时库时，请使用 `-stdlib=platform`。启用 `-stdlib=platform` 后，较新的 C++ 标准库符号需要匹配的部署目标版本：例如对浮点数调用 `std::format` 需要 `-mmacos-version-min=13.3` 及以上。

目标平台配置文件默认设置 `-mmacos-version-min=13.0`；可在命令行传入更高版本的 `-mmacos-version-min=<ver>` 覆盖它。

## ld64.lld 与 `-fuse-ld=ld`

在包括 macOS 主机在内的所有主机上，macOS 目标平台均使用 `ld64.lld` 链接。与 Apple 的 `ld` 一样，`ld64.lld` 会自动对 `arm64` 二进制文件作临时签名（ad-hoc signing），无需调用 `codesign` 即可在 Apple silicon 上直接运行；`llvm-install-name-tool` 在修改二进制文件后也会重新签名。

在 macOS 主机上，如需改用 Apple 的 `ld` 链接非 LTO 目标文件，可传入 `-fuse-ld=ld`。Apple 的 `ld` 需要通过与编译器 LLVM 版本一致的 `libLTO.dylib` 读取 LTO bitcode；正如 xclang 不为其他主机的系统链接器附带 LTO 插件一样，xclang 也不附带 `libLTO.dylib`（为每个 macOS 主机压缩包节省了 120 MB），因此 LTO 构建始终使用 `ld64.lld` 链接。

## 两种架构

每个主机压缩包都同时包含 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`，可通过 `llvm-lipo` 将两种架构的程序合并为通用二进制文件（universal binary）。在 CMake 中，构建另一个 macOS 架构通过 `CMAKE_OSX_ARCHITECTURES` 处理，不视为交叉编译（[CMake](../integrations/cmake.md)）。

`x86_64` macOS 程序可通过 Rosetta 在 `arm64` Mac 上运行，而 `arm64` 程序无法在 `x86_64` Mac 上运行。`x86_64-apple-darwin` 主机工具链本身是在 `arm64` macOS 上交叉编译出来的——构建时会先编译出 `arm64` 架构的表生成器（table generator），从而避免在构建过程中运行任何 `x86_64` 程序——随后在 `x86_64` Mac（`macos-15-intel`）上完成测试。

## 调试信息

Mach-O 链接会将 DWARF 调试信息保留在 `.o` 目标文件中，并在可执行文件的调试映射表（debug map）里记录这些目标文件的路径，再由 `dsymutil` 根据它们收集生成 `.dSYM` 包（[调试](../features/debugging.md)）：

- **调试映射表中的相对路径**：默认情况下，调试映射表记录的是各个目标文件的绝对路径，因此在不同目录下链接同一个程序会生成不同的字节内容。Bazel 链接时会传入 `-oso_prefix .`，使调试映射表记录形如 `bazel-out/...` 的相对路径。
- **ThinLTO 临时目标文件**：启用 ThinLTO 时，LTO 后端生成的临时目标文件会在链接结束时被链接器删除，因此 xclang 的 [CMake](../integrations/cmake.md) 与 [Bazel](../integrations/bazel.md) 集成会在链接步骤中一并生成 `.dSYM` 包。

发布构建可使用与 Apple `strip` 行为一致的 `llvm-strip --strip-all` 剥离符号（[调试](../features/debugging.md)）。

## Sanitizer

两个 macOS 目标平台均支持 AddressSanitizer（附带经 ASan 插桩的 `libc++`）、ThreadSanitizer、LeakSanitizer、UndefinedBehaviorSanitizer 与 libFuzzer；它们的运行时库是从工具链或可执行文件所在目录加载的 `.dylib` 文件，属于面向测试构建的[封闭性](../design/hermeticity.md)例外（[sanitizer](../features/sanitizers.md)）。

## macOS SDK 与链接器的工作原理

### 无需安装 Xcode 获取 Apple SDK

Apple 的 macOS SDK 包含在 `swcdn.apple.com` 分发的 Command Line Tools `.pkg` 安装包内，列在无需 Apple ID 即可访问的 Apple 软件更新目录（`swscan.apple.com`）中。`.pkg` 是一个 `xar` 压缩包，其中的 `Payload` 是由多个 `xz` 分块组成的 `pbzx` 流，内部封装了一个 `cpio` 归档。`xclang` 使用自身代码直接解析 `xar`、`pbzx`、`xz` 和 `cpio`，因此 `xclang sdk fetch macos` 无需借助任何 macOS 专用工具即可在 Linux、Windows 和 macOS 上运行。

解压时，`xclang` 只提取 `Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk`，并跳过 `usr/bin/`、`usr/share/`（其中的 man 手册文件名含有 Windows 文件系统不允许的 `:` 字符）和 `System/Library/Perl/`。在 Windows 上，SDK 中的符号链接默认会创建为无需提权的目录联接（junction）和文件硬链接（`--links junction`）。

[Windows MSVC 目标平台](windows.md#config-files-and-object-directives)需要通过生成的配置文件传入 MSVC 与 Windows SDK 的版本号子目录，而 macOS SDK 只需要指定根目录。因此 Linux 与 Windows 上的目标平台配置文件可以直接写入 `-isysroot <CFGDIR>/../sdk/macos`；即使工具链内尚未下载 SDK，在命令行显式传入 `-isysroot` 也依然可以正常工作。

### Apple 下架安装包的处理与内容摘要

Apple 的软件更新目录列出了各个 macOS 版本当前可用的 Command Line Tools 安装包。Apple 会不定期下架旧安装包（在 `swcdn.apple.com` 上返回 `403` 或 `404`），并替换为重新签名的安装包——新安装包的外层压缩包字节发生了变化，但内部的 SDK 完全未变：例如当产品编号 `142-50405` 替换 `082-83364` 时，其中 macOS `26.5` SDK 的全部 18,516 个文件完全一致。

兼顾安装包下架容错与构建可复现性的做法是，`xclang/sdk-versions.json` 对每个 macOS 安装包做了双重锁定：同时记录外层 `.pkg` 压缩包的 `sha256` 以及内部 SDK 的内容摘要。当 Apple 的 CDN 对锁定的 URL 返回 `403` 或 `404` 时，`xclang sdk fetch`（以及 [Bazel](../integrations/bazel.md) 模块的回退逻辑）会读取 Apple 的更新目录，检查候选安装包 `Payload` 的开头部分以寻找所请求的 SDK 版本，并在解压后的 SDK 与锁定的内容摘要一致时接受这个安装包。

内容摘要是 SDK 清单的 `sha256` 值。这份清单涵盖安装包 `cpio` 载荷中 `Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk/` 下的每个普通文件与符号链接（包括 `xclang` 解压落盘时跳过的 man 手册、工具与 Perl 文件），按路径逐字节排序，每行一条记录：

```text
file <sha256 of its bytes> <path>
link <sha256 of its target> <path>
```

每行以换行符结尾，`<path>` 是使用 `/` 分隔的相对于 SDK 根目录的路径，硬链接则按普通 `file` 对其字节内容计算哈希。目录本身、文件权限、修改时间以及 `xclang` 在 Windows 上创建链接的方式均不影响摘要结果；在 Mac 上运行 `pkgutil --expand-full` 解压出的是同一棵目录树。

这种锁定机制带来四点直接影响：

- **Apple 已彻底下架的版本无法下载**：当 Apple 在更新目录中用新版本替换了旧版本 SDK（例如用 `27.2` 替换 `27.0`）时，目录中不再有任何安装包包含旧版本，下载会报错退出并列出 Apple 当前提供的版本。
- **相同的版本号字符串不代表同一个 SDK**：早期 Command Line Tools 构建中的 `26.5` SDK 与锁定的 `26.5` 有 9 个文件不同；即使版本号字符串相同，只要 SDK 内容与锁定的摘要不符，安装包也会被拒绝。
- **`--version latest` 不可复现**：它会直接采用运行时 Apple 更新目录中列出的最新 SDK，可能超出版本表范围且未经锁定。
- **xclang 不维护镜像**：xclang 不会在自己的服务器上缓存或二次分发 Apple 的安装包。将 `.pkg` 保存在 `xclang sdk fetch` 的 `--cache` 目录，或保存在 Bazel 的仓库缓存及 `--distdir` 中（[CI](../integrations/ci.md)），即可在 Apple 将对应版本从 CDN 移除后继续用于构建。

### 为什么使用 ld64.lld 与补丁 0007

在 macOS、Linux 和 Windows 上统一使用 `ld64.lld`，不仅让所有主机拥有同一个 Mach-O 链接器，还能直接按编译器自身的 LLVM 版本支持 LTO（无需通过 `-lto_library` 加载外部 `libLTO.dylib`），并在所有主机上接受相同的 ThinLTO 缓存（`-cache_path_lto`）与相对路径调试映射表（`-oso_prefix`）参数。

当 `clang` 在单条命令中同时执行 ThinLTO 编译与链接时，会向链接器传入 `-object_path_lto`。启用 `-object_path_lto` 后，LTO 后端首先会写出一个空目标文件，其中唯一的符号 `ltmp0` 与紧随其后的函数（`main`）具有相同的地址。上游 `ld64.lld` 会从代码段的所有符号收集栈展开条目，导致在 `arm64` 上 `ltmp0` 的空展开条目覆盖了 `__unwind_info` 中 `main` 的条目，使异常无法穿过 `main` 展开（`llvm/llvm-project#224949`，已由 `llvm/llvm-project#225055` 修复）。xclang 通过[补丁 0007](../reference/patches.md) 合入了这项修复。

此外，Xcode 27 的 macOS 27 SDK 在 `libSystem` 及系统框架的 `.tbd` 桩文件中引入了新的架构名称 `arm64e.x1`，xclang 中的 LLVM TextAPI 已支持这一名称。

## 已知限制

- **非 macOS 主机不含应用包资源编译器**：编译资源目录（asset catalog）以及 `.nib` 或 `.xib` 文件需要仅支持在 macOS 上运行的 Apple `actool` 与 `ibtool`。命令行程序、`.dylib` 共享库与纯代码框架则可在任意主机上构建。
- **仅支持临时签名（ad-hoc signing）**：链接器仅对二进制文件作临时签名；使用 Developer ID 证书签名及公证（notarization）需要 Apple 官方工具与 Apple 开发者账号。
- **Apple 许可条款**：macOS SDK 的使用受 Apple 许可条款约束，运行 `xclang sdk fetch macos --accept-license` 即表示接受这些条款（[交叉编译](cross-compiling.md#why-vendor-sdks-are-fetched-not-shipped)）。
- **iOS、tvOS、watchOS 与 visionOS**：iOS、tvOS、watchOS、visionOS 及其模拟器的 SDK 仅包含在需要 Apple ID 登录才能下载的完整版 Xcode 中，无法无人值守地自动获取；这些目标平台的支持目前在[研究中](../design/roadmap.md#ios)。
