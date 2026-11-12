# macOS

本页介绍 xclang 的 macOS 目标平台、`xclang sdk fetch macos`、`ld64.lld` 以及 macOS 主机工具链是如何构建和配置的。如何为 macOS 目标平台编译程序见[交叉编译](../guide/cross-compiling.md#macos)。

## 为什么使用 xclang 的 `libc++` 而非系统自带版本

macOS 目标平台配置文件会将 xclang 的 `libc++` 头文件（`-stdlib++-isystem`）加入 C++ 头文件搜索路径，并把 xclang 的静态库 `libc++.a`（内含 `libc++abi`）排在 SDK 的 `libc++.tbd` 之前。栈展开库（unwinder）则使用系统 `libSystem` 自带的实现（[封闭性](hermeticity.md)）。

静态链接 xclang 的 `libc++` 有两个好处：

- **C++ 标准库特性不受操作系统版本限制**：Apple 的 SDK 会为较新的 `libc++` 特性加上可用性属性（availability attribute），将其绑定到首次在 `/usr/lib/libc++.1.dylib` 中提供这些特性的 macOS 版本。将 xclang 的 `libc++` 链接进程序后，可用的标准库特性只取决于 xclang 版本，而不受目标 macOS 版本限制（例如对浮点数调用 `std::format` 在 `-mmacos-version-min=13.0` 下即可正常工作，而使用系统的 `libc++` 则需要 `13.3` 及以上）。
- **跨平台一致的 `libc++`**：程序在 macOS、Linux 与 Windows 上使用的是同一套 `libc++` 实现。

传入 `-stdlib=platform` 会切换到 `bin/<triple>-system.cfg`（[补丁 0018](../reference/patches.md)），保留 SDK、部署目标版本与 `ld64.lld`，并链接操作系统的 `/usr/lib/libc++.1.dylib`（[交叉编译](../guide/cross-compiling.md#the-platform-s-c-library)）。

`x86_64-apple-darwin` 主机工具链本身是在 `arm64` macOS 上交叉编译出来的——构建时会先编译出 `arm64` 架构的表生成器（table generator），从而避免在构建过程中通过 Rosetta 运行任何 `x86_64` 程序——随后在 `x86_64` Mac（`macos-15-intel`）上完成测试。

## 无需安装 Xcode 获取 Apple SDK

Apple 的 macOS SDK 包含在 `swcdn.apple.com` 分发的 Command Line Tools `.pkg` 安装包内，列在无需 Apple ID 即可访问的 Apple 软件更新目录（`swscan.apple.com`）中。`.pkg` 是一个 `xar` 压缩包，其中的 `Payload` 是由多个 `xz` 分块组成的 `pbzx` 流，内部封装了一个 `cpio` 归档。`xclang` 使用自身代码直接解析 `xar`、`pbzx`、`xz` 和 `cpio`，因此 `xclang sdk fetch macos` 无需借助任何 macOS 专用工具即可在 Linux、Windows 和 macOS 上运行（[`xclang` 命令](../reference/xclang-command.md)）。

解压时，`xclang` 只提取 `Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk`，并跳过 `usr/bin/`、`usr/share/`（其中的 man 手册文件名含有 Windows 文件系统不允许的 `:` 字符）和 `System/Library/Perl/`。在 Windows 上，SDK 中的符号链接默认会创建为无需提权的目录联接（junction）和文件硬链接（`--links junction`）。

[Windows MSVC 目标平台](windows.md#config-files-and-object-directives)需要通过生成的配置文件传入 MSVC 与 Windows SDK 的版本号子目录，而 macOS SDK 只需要指定根目录。因此 Linux 与 Windows 上的目标平台配置文件可以直接写入 `-isysroot <CFGDIR>/../sdk/macos`；即使工具链内尚未下载 SDK，在命令行显式传入 `-isysroot` 也依然可以正常工作。

## Apple 下架安装包的处理与内容摘要

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

## 为什么使用 `ld64.lld` 与补丁 0007

在 macOS、Linux 和 Windows 上统一使用 `ld64.lld`，不仅让所有主机拥有同一个 Mach-O 链接器，还能在不调用 `codesign` 的情况下对 `arm64` 二进制文件作临时签名，直接按编译器自身的 LLVM 版本支持 LTO（无需随附 120 MB 的 `libLTO.dylib` 或传入 `-lto_library`），并在所有主机上接受相同的 ThinLTO 缓存（`-cache_path_lto`）与相对路径调试映射表（`-oso_prefix`）参数。

当 `clang` 在单条命令中同时执行 ThinLTO 编译与链接时，会向链接器传入 `-object_path_lto`。启用 `-object_path_lto` 后，LTO 后端首先会写出一个空目标文件，其中唯一的符号 `ltmp0` 与紧随其后的函数（`main`）具有相同的地址。上游 `ld64.lld` 会从代码段的所有符号收集栈展开条目，导致在 `arm64` 上 `ltmp0` 的空展开条目覆盖了 `__unwind_info` 中 `main` 的条目，使异常无法穿过 `main` 展开（`llvm/llvm-project#224949`，已由 `llvm/llvm-project#225055` 修复）。xclang 通过[补丁 0007](../reference/patches.md) 合入了这项修复。

此外，Xcode 27 的 macOS 27 SDK 在 `libSystem` 及系统框架的 `.tbd` 桩文件中引入了新的架构名称 `arm64e.x1`，xclang 中的 LLVM TextAPI 已支持这一名称。

## Mach-O 上的调试信息

Mach-O 链接会将 DWARF 调试信息保留在 `.o` 目标文件中，并在可执行文件的调试映射表（debug map，即 `N_OSO` stab 条目）里记录这些目标文件的路径，再由 `dsymutil` 根据它们收集生成 `.dSYM` 包（[调试](../features/debugging.md)）：

- **调试映射表中的相对路径**：默认情况下，调试映射表记录的是各个目标文件的绝对路径，因此在不同目录下链接同一个程序会生成不同的字节内容。Bazel 链接时会传入 `-oso_prefix .`，使调试映射表记录形如 `bazel-out/...` 的相对路径。
- **ThinLTO 临时目标文件**：启用 ThinLTO 时，LTO 后端生成的临时目标文件会在链接结束时被链接器删除，因此 xclang 的 [CMake](../integrations/cmake.md) 与 [Bazel](../integrations/bazel.md) 集成会传入 `-object_path_lto`，并在链接步骤中一并生成 `.dSYM` 包（[为什么在链接阶段生成 dSYM](../features/debugging.md#why-a-dsym-comes-from-the-link)）。
- **剥离符号**：发布二进制文件使用与 Apple 的 `strip` 行为一致的 `llvm-strip --strip-all` 剥离符号；优化版 Bazel 构建还会传入 `-Wl,-no_exported_symbols`，使剥离符号后的可执行文件不保留任何导出的弱 C++ 符号，防止 `dladdr` 将崩溃栈帧误归因到这些符号上（[剥离符号](../features/debugging.md#strip)）。

## Sanitizer 的 dylib

两个 macOS 目标平台均支持 AddressSanitizer（附带经 ASan 插桩的 `libc++`）、ThreadSanitizer、LeakSanitizer、UndefinedBehaviorSanitizer 与 libFuzzer。它们的运行时库是位于 `lib/clang/<major>/lib/darwin/` 下的通用二进制 `.dylib` 文件（`libclang_rt.*_osx_dynamic.dylib`），在运行时从工具链或可执行文件所在目录加载，属于仅供测试使用的[封闭性](hermeticity.md)例外（[sanitizer](../features/sanitizers.md)）。在构建 xclang 工具链时，面向 Darwin 的 `compiler-rt` 会带 `ZERO_AR_DATE=1` 链接，避免静态库归档的时间戳写入 `.dylib` 的调试映射表或 Mach-O UUID。
