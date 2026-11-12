# Bazel 模块

xclang 的 Bazel 模块（`packages/bazel`）让 C++ 构建保持自包含，并能跨检出目录与机器复用缓存：每个动作读取的工具链与 SDK 文件都是已声明的 Bazel 输入，命令行与构建产物中不包含绝对路径（macOS 主机上的 Xcode SDK 与原生 sanitizer rpath 除外），而且 `cc_library` 依赖默认静态链接进程序与测试。模块的配置与用法见 [Bazel](../integrations/bazel.md)，它的 label、标志与特性见 [Bazel API](../reference/bazel-api.md)。

## 每个工具链文件都是声明输入

`xclang_toolchain` 仓库规则按 `bazel/versions.bzl` 中锁定的 `sha256` 下载主机工具链压缩包。编译或链接动作从压缩包读取的每个文件都在 `cc_toolchain` 的 filegroup 中声明：编译用到 `bin/` 下的可执行文件、`clang` 的资源头文件、目标平台的 sysroot 头文件及共用的 `libc++` / `mingw-w64` 头文件，链接用到目标平台的 sysroot 库与 `compiler-rt`。模块扩展拉取的厂商 SDK 同样作为输入声明（[见下文](#vendor-sdks-as-repositories)）；唯一位于 Bazel 外部的主机路径是 macOS 主机上由 `xcrun --show-sdk-path` 定位的 Xcode macOS SDK。

在有 Bazel 模块之前，xclang 的 Bazel 配置直接包装 `PATH` 上的 `clang`，不声明任何工具链文件，这从两方面破坏了缓存：

- `PATH` 的任何变动都会使工具链仓库失效，触发整个工作区重新构建。
- 升级 `PATH` 上的 `clang` 不会改变任何动作输入，构建缓存仍会返回旧编译器生成的目标文件。

把每个工具链文件声明为动作输入同时解决了这两个问题：升级 `xclang` 模块会改变所有编译与链接动作的输入摘要并触发重编，而在另一个目录或另一台机器上使用同一发布版本构建则能共享缓存命中。

代价是沙盒文件布置开销：每次执行编译和链接动作时，Bazel 沙盒都要为数千个已声明的工具链文件创建链接。在 Windows 主机上，Bazel 默认不使用沙盒运行动作（除非开启 `--experimental_use_windows_sandbox`），因此漏声明的输入会由同一目标在 Linux 与 macOS 上的构建检出；同时，Windows 上 Bazel 默认输出根目录在布置层级较深的工具链与 SDK 目录树时会超出路径长度限制，因此 Windows 主机需设置 `startup --output_user_root=C:/b`（[在 Windows 主机上](../integrations/bazel.md#on-a-windows-host)）。

## 无绝对路径

只有当动作命令行与动作产物都不包含特定于检出目录、output base 或沙盒的路径时，磁盘缓存或远程缓存才能跨目录与机器复用动作结果。`packages/bazel` 从所有编译、模块与链接动作中移除了绝对路径：

- **改写配置文件**：`clang` 会将配置文件中的 `<CFGDIR>` 解析成绝对路径，并写入 `.d` 依赖文件。在仓库初始化阶段，`_bazel_cfg`（`bazel/repositories.bzl`）把每个目标平台的配置文件拷贝到 `cfg/` 下，将 `<CFGDIR>/..` 替换为 `external/<repository>`，同时写入 `-resource-dir=external/<repository>/lib/clang/<major>`；工具链则传入 `--no-default-config --config=external/<repository>/cfg/<target>.cfg`。
- **相对工具前缀**：编译与链接标志中加入 `-no-canonical-prefixes`，包装脚本（`scan_deps` 与 `dsym_link`）也按自身所在目录的相对路径定位工具。
- **调试信息与二进制时间戳**：每次编译传入 `-ffile-compilation-dir=.`；macOS 链接传入 `-Wl,-oso_prefix,.`；MinGW 链接传入 `-Wl,--no-insert-timestamp`；MSVC 目标平台在编译时传入 `-mno-incremental-linker-compatible` 与 `-gno-codeview-command-line`（避免 Windows 启动器路径写入 CodeView 记录），链接时传入 `-Wl,/Brepro`，用 `/pdbsourcepath:.` 设置 PDB 源码路径，且内嵌的 PDB 名称不带目录前缀（[调试信息中的路径](../features/debugging.md#paths-in-debug-information)）。
- **C++20 模块文件**：传入 `-Xclang -fmodule-file-home-is-cwd` 让 `.pcm` 文件记录相对于执行根目录的输入路径，并传入 `-Xclang -fmodules-embed-all-files`（`modules_embed_all_files`，默认开启），使带 `-g` 编译且 import 它的文件在沙盒内直接从 `.pcm` 中读取源码文本（[构建缓存与模块](../features/modules.md#build-caches-and-modules)）。
- **预处理器时间戳**：传入 `-Wno-builtin-macro-redefined`，并将 `__DATE__`、`__TIME__` 与 `__TIMESTAMP__` 定义为 `"redacted"`。

macOS 主机上仍保留两处绝对路径：来自本机的 Xcode SDK 路径（`-isysroot`），以及原生 macOS 构建开启 sanitizer 特性时传入的 `-Wl,-rpath,<absolute_root>/lib/clang/<major>/lib/darwin`，用于让二进制程序在运行时找到 sanitizer 的 `.dylib`。

## 每组主机与目标平台对应一个工具链

由于每个主机压缩包都包含所有内置目标平台的 sysroot 与运行时库，模块会为每组 `(host, target)` 注册一个 `cc_toolchain`：`exec_compatible_with` 匹配主机操作系统与 CPU，`target_compatible_with` 匹配目标平台。Bazel 会选出同时匹配主机与 `--platforms` 目标平台的工具链，且只下载当前主机的工具链压缩包。

对于需要厂商 SDK 的目标平台（MSVC 目标平台，以及在 Linux 和 Windows 主机上构建的 macOS 目标平台），如果根 `MODULE.bazel` 中没有添加对应标签，构建会解析到一个在分析阶段立即报错退出的工具链，并打印所需添加的 `xclang.windows_sdk` 或 `xclang.macos_sdk` 标签。

`@xclang//platforms:<target>` 中的平台声明了 `@platforms//os`、`@platforms//cpu` 以及 C 标准库约束（`@xclang//platforms/libc:glibc`、`:musl`、`:mingw`、`:macosx` 或 `:msvc`）。由于 musl 工具链（`//bazel/toolchains/musl:all`）与 MSVC 工具链（`//bazel/toolchains/msvc:all`）要求 `:musl` 或 `:msvc` 约束，且在 `MODULE.bazel` 中排在仅按操作系统与 CPU 匹配的 `//bazel/toolchains:all` 之前注册，不带 `libc` 约束的自定义 `platform` 在 Linux 上默认选用 `glibc`，在 Windows 上默认选用 MinGW。

## 内置 rules_cc 工具链配置副本

借助 `single_version_override` 补丁修改其他 Bazel 模块中的 `.bzl` 文件只在根 `MODULE.bazel` 中生效，这会迫使每个使用 `xclang` 的项目都在自身仓库中维护补丁文件；而直接对构建中的 `rules_cc` 仓库打补丁，一旦新版本 `rules_cc` 修改了邻近代码就会失效（如 `rules_cc` 0.2.28 的变更）。如果迁移到 `rules_cc` 基于规则的工具链 API，又得重新实现 `--macos_minimum_os`、`libtool`、死代码剥离与 sanitizer 特性。

因此，`packages/bazel/bazel/unix_cc_toolchain_config.bzl` 直接保存了一份 xclang 自己的 `rules_cc` 0.2.28 `unix_cc_toolchain_config.bzl` 副本。这份副本只从 `rules_cc`、`apple_support` 与 `bazel_skylib` 加载公开文件，无需下游项目配置 override 即可兼容 `rules_cc` 0.2.25 及以上版本。

相比上游 `rules_cc`，xclang 的配置与 `bazel/toolchain.bzl` 增加了以下改动：

- MinGW 与 MSVC 目标平台使用 `.exe` 和 `.dll` 作为产物名称，且在 Windows 上不传入 `rpath`；
- 支持 MSVC 目标平台：使用 GNU 风格的 `clang` 驱动配合 `lld-link` 标志，默认开启 `-std=c++17`，禁用 PIC，支持生成 PDB（`generate_pdb_file`）、选择 CRT（`dynamic_link_msvcrt`、`debug_msvcrt`）以及布置运行时 DLL（`copy_dynamic_libraries_to_binary`）；
- 默认静态链接 `cc_library` 依赖（[见下文](#static-by-default)）；
- 外部仓库的头文件以 `-isystem` 传入（`external_include_paths` 默认开启），避免第三方依赖的警告导致构建失败；
- sanitizer 标志：启用 `asan` 时切换到预编译的 ASan `libc++`，启用 `--@xclang//runtimes:source` 时从 `libc++/src` 构建 `libc++`、`libc++abi` 与 `libunwind`，并在 glibc Linux 目标平台上支持 MemorySanitizer（`msan`）（[从源码构建运行时库](../features/runtimes-from-source.md)）；
- `gc_sections` 在 Linux 的 `opt` 构建下默认开启，在 Windows 上默认关闭（[`gc-sections` 与静态初始化器](windows.md#gc-sections-and-static-initializers)）；
- macOS 链接除非开启 `macos_default_link_flags`，否则不传 `-fobjc-link-runtime`；`--macos_minimum_os` 下限锁定为 `13.0`；在 Linux 与 macOS 上将库目标文件夹在 `--start-lib` 与 `--end-lib` 之间传入（避免 Bazel 将时间戳归零后 `dsymutil` 混淆静态库中的同名成员）；由 `dsym_link` 在链接阶段调用 `dsymutil --linker classic` 生成 `.dSYM` 包（避开 LLVM 23 并行链接器生成的会导致 `atos` 崩溃的 DWARF 5 行号表；[为什么在链接阶段生成 dSYM](../features/debugging.md#why-a-dsym-comes-from-the-link)）；
- 按二进制格式区分的符号剥离（ELF 与 COFF 使用 `--strip-unneeded`，Mach-O 使用 `--strip-all` 并在 `opt` 下配合 `-Wl,-no_exported_symbols`；[剥离符号](../features/debugging.md#strip)）；
- 在 macOS 上与 Linux 和 Windows 一样，将库的 `defines` 传给 C++20 模块编译与 `clang-scan-deps` 依赖扫描。

## 默认静态链接

在 `rules_cc` 的默认配置下，只要开启了 `supports_dynamic_linker`，`cc_test` 目标的 `cc_library` 依赖就会分别链接成独立的共享库。由于 xclang 链接的每个共享库都带有各自私有的静态 `libc++`（[每个共享对象独立的 `libc++`](hermeticity.md#one-libc-per-shared-object)），将每个 `cc_library` 链接成共享对象会让每个库都持有一份独立的 `libc++` 实例（这曾导致 `kotatsu` 的测试在启动时因重复释放内存而崩溃，并在 Windows 上链接失败）。

因此，工具链配置默认关闭 `supports_dynamic_linker`，使 `cc_library` 目标静态链接进可执行文件与测试。`cc_binary(linkshared = True)` 仍会生成共享库（`libfoo.so`、`libfoo.dylib`、`foo.dll`），而在 Linux 目标平台上设置 `features = ["supports_dynamic_linker"]` 可以重新开启动态链接。

## 作为外部仓库的厂商 SDK

MSVC 目标平台需要微软的 CRT、STL 与 Windows SDK，Linux 和 Windows 主机上的 macOS 目标平台需要 Apple 的 macOS SDK。直接调用 `clang` 或使用 CMake 时，[`xclang` 命令](../reference/xclang-command.md)会把拉取的 SDK 解压到 `<toolchain>/sdk/`；但 Bazel 构建不能向工具链仓库写入文件，而且必须把每个 SDK 文件都声明为构建输入。`bazel/sdk.bzl` 将每个厂商 SDK 作为独立的外部仓库管理：

- **在根 `MODULE.bazel` 中接受许可条款**：只有根模块（`mod.is_root`）中的 `xclang.windows_sdk` 与 `xclang.macos_sdk` 标签会生效，依赖模块不能替下游使用者接受厂商许可证。
- **Bazel 负责下载，`xclang` 负责解压**：仓库规则运行 `xclang sdk packages <vendor> --json` 查询锁定的安装包 URL、大小与 `sha256` 摘要，调用 `rctx.download` 将安装包下载到 Bazel 共享仓库缓存中（自动应用已配置的 Bazel 镜像、代理或 `--distdir`），随后调用 `xclang sdk fetch <vendor> --accept-license --cache downloads --sdk-dir sdk` 解压归档，并在大小写敏感的文件系统上创建大小写折叠符号链接。如果 Apple 下架了某个锁定的 macOS Command Line Tools 安装包，`xclang sdk fetch` 会在 Apple 软件目录中定位替代安装包，并按内容摘要校验解压出的 SDK（[Apple 下架的安装包](macos.md#packages-apple-withdraws-and-content-digests)）。
- **生成 `sdk.cfg`**：每个 SDK 仓库都会写出带执行根目录相对路径的 `sdk.cfg`（macOS 为 `-isysroot external/<repo>/sdk/<name>`，MSVC 目标平台为改写后指定 MSVC 与 Windows SDK 版本目录的 `<arch>-pc-windows-msvc.cfg`），工具链的 `cfg/<target>.cfg` 再经由 `@../../<sdk_repo>/sdk.cfg` 引入它。
- **按架构惰性拉取仓库**：`xclang_windows_sdk_x86_64`（下载大小 310 MB）、`xclang_windows_sdk_aarch64`（下载大小 380 MB）与 `xclang_macos_sdk` 只有在构建面向对应平台时才会拉取。
- **拆分编译与链接 filegroup**：SDK 仓库中的 `BUILD.bazel` 用 `glob()` 导出 `:compiler_files` 与 `:linker_files`。对于 macOS SDK，`_unlink_cycles` 会在 `glob()` 运行前移除目录符号链接环（如 `Ruby.framework` 的 `Headers/ruby/ruby -> .`）；`:compiler_files` 布置头文件与 framework（15,000 个文件），`:linker_files` 布置 `.tbd` 桩文件与 `SDKSettings.*`（9,800 个文件）。对于 MSVC 目标平台，`:compiler_files` 声明 7,300 个头文件与链接，`:linker_files` 声明 1,300 个库文件。

## Registry

`published.yml` 基于已发布的发版产物构建并测试发版标签后，`node packages/bazel/bazel.ts archive` 会构建 `xclang-bazel-<version>.tar.gz`，并将模块发布到 [bazel.clice.io](https://bazel.clice.io)。`bazel.ts` 在内存中以确定性方式构造 `ustar` 归档——条目排序、权限设为 `0755`/`0644`、所有者与时间戳字段清零、gzip 的 OS 头字节设为 `255`——从而保证生成的 registry 压缩包在任何主机上都逐字节一致。
