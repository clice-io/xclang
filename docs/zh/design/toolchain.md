# 工具链结构

`clang` 通过 `bin/` 下的纯文本配置文件定位各个目标平台的 sysroot、头文件、运行时库和链接器，而非将默认路径编译进编译器内部。`clang`、`lld` 与绝大多数二进制工具共用同一个多合一可执行文件（`llvm`），而 sysroot 与共用头文件均为普通目录，在 Windows 工具链和 Linux sysroot 中都不包含任何符号链接。因此，本机编译与交叉编译的唯一区别在于是否传入 `--target=<triple>`，传入 `-stdlib=platform` 即可切换到平台的 C++ 标准库，传入 `--no-default-config` 则恢复为上游原版 `clang`（[交叉编译](../guide/cross-compiling.md#how-clang-finds-a-target-s-files)、[压缩包目录结构](../reference/layout.md)）。

## 每个目标平台独立的配置文件

为某个目标平台编译或链接时，`clang` 会在自身可执行文件所在的 `bin/` 目录下查找 `<triple>.cfg`（`clang-cl` 则查找 `<triple>-clang-cl.cfg`），并将文件中的参数加到命令行最前面。例如传入 `--target=aarch64-w64-mingw32` 时，`clang` 会先规范化 triple，再读取 `aarch64-w64-windows-gnu.cfg`。`toolchain/common.ts` 会为每个目标平台的所有受支持写法在 `bin/` 下生成对应的配置文件：

| 目标平台 | `bin/` 下的配置文件 |
|---|---|
| Linux（glibc） | `<arch>-unknown-linux-gnu.cfg`, `<arch>-pc-linux-gnu.cfg` |
| Linux（musl） | `<arch>-unknown-linux-musl.cfg`, `<arch>-pc-linux-musl.cfg` |
| Windows（MinGW） | `<arch>-w64-windows-gnu.cfg`, `<arch>-pc-windows-gnu.cfg` |
| macOS | `<arch>-apple-darwin.cfg`, `<arch>-apple-macos.cfg`, `<arch>-apple-macosx.cfg` |
| Windows（MSVC） | `<arch>-pc-windows-msvc.cfg`、`<arch>-unknown-windows-msvc.cfg`，以及供 `clang-cl` 使用的 `<spelling>-clang-cl.cfg` |

其中 `<arch>` 为 `x86_64`，或在 64 位 Arm 上同时提供 `aarch64` 与 `arm64`。由于 `compiler-rt` 将库文件安装在规范命名的 `<arch>-unknown-linux-*` 与 `<arch>-w64-windows-gnu` 目录下，[补丁 0013](../reference/patches.md) 会将 Linux 与 MinGW 目标平台的 `-pc-` 和 `arm64-` 写法映射回对应的运行时库目录。

各个目标平台配置文件设置的选项如下（[`toolchain/config/`](https://github.com/clice-io/xclang/tree/main/toolchain/config)）：

| 目标平台 | `<spelling>.cfg` 中的选项 |
|---|---|
| Linux（glibc） | `--sysroot=<CFGDIR>/../<triple>`、引入目标平台 `__config_site` 与共用 `libc++` 头文件的 `-stdlib++-isystem`、`-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`、`-static-libstdc++ -static-libgcc`、`-fuse-ld=lld` |
| Linux（musl） | 同上，将 `-static-libstdc++ -static-libgcc` 替换为 `-static`，连同 `musl` 一起静态链接（[musl 目标平台](../guide/cross-compiling.md#musl-targets)） |
| Windows（MinGW） | `--sysroot=<CFGDIR>/../<triple>`、引入目标平台 `__config_site` 与共用 `libc++` 头文件的 `-stdlib++-isystem`、`-idirafter <CFGDIR>/../mingw-w64/include`、`-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`、`-fuse-ld=lld`（sysroot 仅含静态库） |
| macOS | 在 Linux 与 Windows 主机上设置 `-isysroot <CFGDIR>/../sdk/macos`（在 macOS 主机上使用 Xcode 的 SDK）；`-mmacos-version-min=13.0`、`-fuse-ld=lld`；引入目标平台 `__config_site` 与共用 `libc++` 头文件的 `-stdlib++-isystem`、将 `libc++.a` 排在 SDK 的 `libc++.tbd` 之前的 `-L<CFGDIR>/../<triple>/lib`，以及供查找 `libc++.modules.json` 的 `-B<CFGDIR>/../<triple>/lib`（[macOS](macos.md)） |
| Windows（MSVC） | 在 Linux 与 macOS 主机上设置 `-Xmicrosoft-windows-sys-root <CFGDIR>/../sdk/windows`（在 `clang-cl` 中为 `/winsysroot`）；`@<triple>-sdk.cfg`（`@<triple>-clang-cl-sdk.cfg`），由 `xclang sdk` 改写以引入当前启用 SDK 的版本配置；`-fuse-ld=lld`；指定 `clang_rt.builtins-<arch>.lib` 与混合 CRT 的目标文件指令（`--linker-option=/nodefaultlib:libucrt.lib`、`--dependent-lib=ucrt.lib`）；`-D_STATIC_INLINE_UCRT_FUNCTIONS=0`；以及引入 `libc++` 的 `-stdlib++-isystem`（在 `clang-cl` 中为 `/clang:-stdlib++-isystem`，编译 C 代码时的告警由[补丁 0011](../reference/patches.md) 消除；见 [Windows](windows.md#config-files-and-object-directives)） |

`<CFGDIR>` 会展开为 `bin/`，因此工具链解压到任意目录均可直接使用，无需修改任何文件。由于 `clang` 对主机的默认目标平台同样会加载配置文件，在 Linux 上运行本机编译命令 `clang++ main.cpp` 时，也会基于内置的 glibc 2.17 sysroot 编译并静态链接 `libc++`。

另外两条配置文件规则避免了在 `clang-cl` 与 Bazel 中出现意外行为：

- **`clang-cl` 默认构建当前主机架构的 MSVC 目标平台。** 在未传入 `--target` 的情况下运行时，`clang-cl` 会先查找 `<default-target>-clang-cl.cfg` 与 `<default-target>.cfg`，随后才切换到 MSVC triple。为此，`toolchain/common.ts` 将 `<arch>` 对应的 MSVC `clang-cl` 配置写入了所有目标平台写法的 `<spelling>-clang-cl.cfg`（以及 `<spelling>-clang-cl-system.cfg`），使直接运行 `clang-cl` 时构建 `<arch>-pc-windows-msvc`，而不会误读主机目标平台的 GNU 风格参数。
- **Bazel 将配置文件改写为相对路径。** `clang` 会把 `<CFGDIR>` 展开为绝对路径并写入 `.d` 依赖文件，破坏跨机器的动作缓存命中。因此 Bazel 模块会在 `cfg/` 下生成使用相对于执行根目录路径的配置文件副本，并在编译时传入 `--no-default-config --config=<file>`（[无绝对路径](bazel-module.md#no-absolute-paths)）。

### 平台的 C++ 标准库

每个 `<spelling>.cfg` 旁都配有一个 `<spelling>-system.cfg`（以及 `<spelling>-clang-cl-system.cfg`）。当传入 `libc++` 以外的任何 `-stdlib=` 值（如 `-stdlib=platform` 或 `-stdlib=libstdc++`；在 `clang-cl` 中为 `/clang:-stdlib=platform`）时，编译器会选用 `<spelling>-system.cfg` 替代 `<spelling>.cfg`（[补丁 0018](../reference/patches.md)、[交叉编译](../guide/cross-compiling.md#the-platform-s-c-library)）：

| 目标平台 | `<spelling>-system.cfg` 中的选项 |
|---|---|
| Linux（glibc）、Linux（musl）、Windows（MinGW） | 仅含 `-fuse-ld=lld`；C 与 C++ 标准库取自宿主机、发行版的交叉编译软件包或 `--sysroot` |
| macOS | SDK 路径（在 Linux 与 Windows 主机上为 `-isysroot <CFGDIR>/../sdk/macos`）、`-mmacos-version-min=13.0`、`-fuse-ld=lld`，并链接 SDK 中的 `libc++.tbd` |
| Windows（MSVC） | 去掉了 `-stdlib++-isystem` 的 MSVC 目标平台配置，使用已下载 SDK 或 Visual Studio 中的微软 STL |

之所以必须切换配置文件，是因为 `<spelling>.cfg` 中的参数无法在命令行后半部分撤销：无论 `-stdlib=` 如何设置，`-stdlib++-isystem` 都会添加 `libc++` 头文件；macOS 上的 `-L<CFGDIR>/../<triple>/lib` 会把静态库 `libc++.a` 排在 SDK 的 `libc++.tbd` 之前；而且内置的 Linux 与 MinGW sysroot 并不包含 `libstdc++`。

### 为什么不把默认配置编译进驱动

LLVM 支持将默认 C++ 标准库、编译器运行时库、栈展开库和链接器直接编译进驱动中（`CLANG_DEFAULT_CXX_STDLIB`、`CLANG_DEFAULT_RTLIB`、`CLANG_DEFAULT_UNWINDLIB`、`CLANG_DEFAULT_LINKER`），xclang 23.1.2.1 曾采用这种做法。这些设置会被编译进同时属于 `libclang` 的 `clangDriver` 库中。

基于 `libclang` 构建的工具（如 clice）会运行 `clangDriver`，根据 `compile_commands.json` 中其他编译器的条目计算头文件搜索路径。将默认配置编译进 `clangDriver` 后，编译数据库中的 `g++` 命令算出的不再是 `libstdc++` 的头文件路径，而是变成了 xclang 的 `libc++` 头文件路径。

不在 `toolchain/cmake/caches/clang.cmake` 中设置这些 `CLANG_DEFAULT_*` 变量，而是将默认配置放在 `bin/*.cfg` 中，即可将两者解耦：`bin/clang` 会读取 `bin/<triple>.cfg`，而链接进 `libclang` 工具内部的 `clangDriver` 旁没有 `bin/*.cfg`，行为与上游原版 `clang` 一致。

### 原生无配置编译器

传入 `--no-default-config` 会指示 `clang` 忽略 `bin/<triple>.cfg`。此时 `clang` 会像未加特殊配置的上游构建一样，查找宿主机系统的头文件和库并调用系统链接器（`toolchain/sysroot.ts` 与 `toolchain/runtimes.ts` 在构建 sysroot 和 `libc++` 本身时就使用了 `--no-default-config`）。

## 多合一可执行文件

`toolchain/cmake/caches/clang.cmake` 开启了 `LLVM_TOOL_LLVM_DRIVER_BUILD=ON`，将 `clang`、`clang-scan-deps`、`lld` 以及绝大多数二进制工具（`llvm-ar`、`llvm-ranlib`、`llvm-lib`、`llvm-dlltool`、`llvm-nm`、`llvm-objcopy`、`llvm-strip`、`llvm-install-name-tool`、`llvm-objdump`、`llvm-readobj`、`llvm-rc`、`llvm-windres`、`llvm-symbolizer`、`dsymutil`、`llvm-gsymutil`、`llvm-libtool-darwin`、`llvm-lipo` 等）合并构建为单个多合一可执行文件 `bin/llvm`（在 Windows 上为 `bin/llvm.exe`）。

这样无需在每个工具中重复打包一份 LLVM 库：`bin/` 下的各个工具名在 Linux 与 macOS 上是指向 `llvm` 的符号链接，在 Windows 上则是由 [`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c) 编译而成的轻量启动器，负责在配置了关闭即终止的作业对象内启动 `llvm.exe <tool-name> <arguments>`（[启动器](windows.md#the-launchers)）。配合省略 glibc 的 `locale-archive`、链接时开启安全相同代码折叠（Linux 与 Windows 上传入 `-Wl,--icf=safe -Wl,-O2`）以及使用 `.tar.xz` 压缩所有主机压缩包，每个主机工具链压缩包的体积都控制在 100 MB 左右（[版本发布](../reference/releases.md#assets)）。

让各个工具动态链接共享库 `libLLVM`（`LLVM_LINK_LLVM_DYLIB`）虽然也能共享代码，但出于编译速度考量未采用：跨共享库边界的调用必须经过动态链接器跳表，而且 ThinLTO 无法跨共享库边界内联和优化。

LLVM 多合一驱动构建未包含的五个工具则在 `bin/` 下编译为独立的可执行文件：`llvm-profdata`、`llvm-cov`、`llvm-dwarfdump`、`llvm-strings` 与 `FileCheck`。

### `-###` 的输出格式

由于 `clang` 由多合一程序 `llvm` 分发执行，`clang -###` 打印的 `-cc1` 命令会以 `llvm` 作为可执行文件名，并在 `"-cc1"` 之前多出一个 `"clang"` 参数：

```text
"/path/xclang/bin/llvm" "clang" "-cc1" ...
```

解析 `clang -###` 输出的工具应向后扫描查找 `"-cc1"`，而不要假定可执行文件路径后的第一个参数就是 `"-cc1"`。

## 纯目录结构

每个目标平台的 sysroot（`<toolchain>/<triple>/`）都是一个只包含编译和链接所需文件的普通目录：头文件、启动文件、C 运行时库、`libc++`、`libc++abi`、`libunwind` 与 [GCC 桩库](hermeticity.md#gcc-library-names)，而 `compiler-rt` 则存放在 `lib/clang/<major>/lib/` 下（[压缩包目录结构](../reference/layout.md)）。

在多个目标平台之间完全相同的头文件只存放一份，且不使用符号链接（由 `toolchain/common.ts` 中的 `shareHeaders` 处理）：所有目标平台共用 `libc++/include/c++/v1`，各目标平台的 `__config_site`（以及非 MSVC 目标平台上的 `cxxabi.h`）放在 `libc++/include/<normalized-triple>/c++/v1` 下，两个 MinGW 目标平台则共用 `mingw-w64/include`（[共用头文件](../reference/layout.md#shared-headers)）。`toolchain/package.ts` 会校验 Windows 工具链压缩包不含任何符号链接，且所有压缩包中都不存在仅大小写不同的两个路径（[为什么选择 glibc 2.17](hermeticity.md#why-glibc-2-17)）。

各 sysroot 与 `compiler-rt` 目录中的内容并不绑定于 xclang 编译的 `clang`。只要传入 `--sysroot` 与 `-resource-dir`，任何同主版本号的上游 `clang` 都可以基于这些目标平台目录执行交叉编译。
