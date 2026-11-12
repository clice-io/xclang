# Bazel API

本页列出 `xclang` Bazel 模块提供的所有内容。具体用法见 [Bazel](../integrations/bazel.md)。模块要求 Bazel 9 与 rules_cc 0.2.25 及以上，位于代码仓库的 `packages/bazel` 下，每次发版都会发布到 [bazel.clice.io](https://bazel.clice.io)。

## 工具链

模块会为每个主机注册面向各目标平台的 C++ 工具链：面向主机自身的是 `@xclang//bazel/toolchains:<host>`，面向其他目标平台的是 `<host>-to-<target>`；musl 目标平台为 `@xclang//bazel/toolchains/musl:<host>-to-<target>`，MSVC 目标平台为 `@xclang//bazel/toolchains/msvc:<host>-to-<target>`（这两组会排在前面优先注册）。每个工具链都使用针对对应目标平台配置的主机压缩包，且只会下载运行 Bazel 所在机器的主机压缩包。MSVC 目标平台以及在非 macOS 主机上构建的 macOS 目标平台会基于根模块获取的厂商 SDK 构建（[标签](#tags)）；未配置对应标签时，工具链会使构建报错失败并说明原因。

每个工具链都会：

- 将 Windows 可执行文件命名为 `.exe`，将共享库命名为 `.dll`；
- 默认将库静态链接进测试与可执行程序中（[默认静态链接](../design/bazel-module.md#static-by-default)）；
- 将外部仓库的头文件作为系统头文件编译（`-isystem`）；
- 抹除 `__DATE__`、`__TIME__` 与 `__TIMESTAMP__` 的时间戳；
- 不在命令行中放入任何绝对路径（[无绝对路径](../design/bazel-module.md#no-absolute-paths)）。

## 平台

供 `--platforms` 使用的 `@xclang//platforms:<target>`：

| 平台 | 别名 | 目标平台 |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-linux-gnu` | Linux x64，glibc 2.17 |
| `aarch64-unknown-linux-gnu` | `aarch64-linux-gnu` | Linux arm64，glibc 2.17 |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu` | Windows x64，MinGW-w64（UCRT） |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu` | Windows arm64，MinGW-w64（UCRT） |
| `aarch64-apple-darwin` | `arm64-apple-darwin` | macOS arm64；在非 macOS 主机上需配合 Apple 的 SDK |
| `x86_64-apple-darwin` | | macOS x64；在非 macOS 主机上需配合 Apple 的 SDK |
| `x86_64-pc-windows-msvc` | | Windows x64，MSVC ABI，需配合微软的 SDK |
| `aarch64-pc-windows-msvc` | | Windows arm64，MSVC ABI，需配合微软的 SDK |
| `x86_64-unknown-linux-musl` | `x86_64-linux-musl` | Linux x64，musl，静态链接 |
| `aarch64-unknown-linux-musl` | `aarch64-linux-musl` | Linux arm64，musl，静态链接 |

每个平台都声明了 `@platforms//os`、`@platforms//cpu` 以及 C 标准库约束（`@xclang//platforms/libc:glibc`、`:musl`、`:mingw`、`:macosx` 或 `:msvc`）。除额外要求 `:musl` 或 `:msvc` 的 musl 与 MSVC 工具链外，其余工具链只要求平台匹配 os 与 cpu；因此用户自定义的只含 os 与 cpu 的平台也可直接使用，若未指定 `:musl` 或 `:msvc`，在 Linux 上默认选用 glibc，在 Windows 上默认选用 MinGW。

## 特性

| 特性 | 默认值 | |
|---|---|---|
| `asan`, `tsan`, `ubsan`, `lsan` | 关闭 | 作用于整个构建的 sanitizer（如 `--features=asan`）；`asan` 会使用 ASan libc++（或带 ASan 插桩的从源码构建的运行时库）编译并链接。Windows 目标平台支持 `ubsan` 以及 x64 下的 `asan`（此时每个可执行文件旁都会附带 ASan DLL）；musl 目标平台支持 `ubsan`。其他不支持的组合会被拒绝 |
| `msan` | 关闭 | 作用于整个构建的 MemorySanitizer，需配合从源码构建运行时库（`--@xclang//runtimes:source`，此时会一并构建 MSan 运行时库）；仅支持 Linux（glibc）目标平台。未启用源码运行时库或面向其他目标平台时会被拒绝 |
| `copy_dynamic_libraries_to_binary` | Windows 目标平台：开启 | 将程序所需的 DLL（包括 ASan 的 DLL）拷贝到 `bazel-bin` 下可执行文件旁及其 runfiles 目录中，与 Bazel 内置 Windows 工具链的行为一致 |
| `cpp_modules` | 关闭 | C++20 模块：支持 `cc_library` 与 `cc_binary` 的 `module_interfaces`，由 clang-scan-deps 扫描依赖；需配合 `--experimental_cpp_modules` 使用 |
| `gc_sections` | Linux 目标平台：在 `opt` 下开启；Windows 目标平台：关闭 | 传入 lld 的 `--gc-sections`，在 MSVC 目标平台上则传入 lld-link 的 `/opt:ref`（[为什么在 Windows 上默认关闭](../design/windows.md#gc-sections-and-static-initializers)） |
| `thinlto_cache` | 开启 | 链接器的 ThinLTO 缓存；仅当 `XCLANG_THINLTO_CACHE` 指定了目录时才会传入对应参数 |
| `generate_dsym_file` | 关闭 | macOS 目标平台：在链接阶段生成 `<name>.dSYM`（位于输出组 `dsyms` 中）；传入 `--apple_generate_dsym` 可为整个构建开启 |
| `supports_dynamic_linker` | 关闭 | 面向 Linux 目标平台启用 Bazel 将依赖库动态链接进测试与可执行文件的行为；关闭时则与其余目标平台一样始终静态链接 |
| `release_strip` | 开启 | 控制 `<name>.stripped` 的剥离方式：对 ELF 与 COFF 使用 `--strip-unneeded`，对 Mach-O 使用 `--strip-all`（[剥离符号](../features/debugging.md#strip)） |
| `modules_embed_all_files` | 开启 | 在 C++20 模块接口生成的模块文件中内嵌源码（`-Xclang -fmodules-embed-all-files`），使带 `-g` 编译且 import 它的文件在沙盒内能够读取这些源码 |
| `macos_default_link_flags` | 关闭 | 来自 rules_cc 的特性：在 macOS 目标平台的每次链接中传入 `-fobjc-link-runtime`，将 Foundation 与 libobjc 链接进每个可执行文件和库；关闭时，目标只链接显式声明的 framework（[macOS 链接说明](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)） |
| `no_exported_symbols` | macOS 目标平台：在 `opt` 下开启 | 使可执行文件不导出任何符号（`-Wl,-no_exported_symbols`），避免剥离符号后残留的符号在崩溃日志中误标栈帧名称（[剥离符号](../features/debugging.md#strip)）；若程序需要加载绑定其自身符号的插件，请关闭此特性 |
| `generate_pdb_file` | MSVC 目标平台：在 `dbg` 下开启 | 链接时写出 `<name>.pdb`（位于输出组 `pdb_file` 中），内部记录相对于执行根目录的路径 |
| `dynamic_link_msvcrt` | 关闭 | MSVC 目标平台：链接 VC 运行时 DLL（`/MD`），替代默认的混合 CRT |
| `debug_msvcrt` | 关闭 | MSVC 目标平台：链接调试版 CRT（默认为 `/MTd`，配合 `dynamic_link_msvcrt` 时为 `/MDd`） |

可通过 `--features=<name>` 为整个构建开启某项特性，通过 `--features=-<name>` 关闭；也可在单个目标上设置 `features = ["<name>"]` 或 `["-<name>"]`。

## C++ 标准库

作用于整个构建的参数：

| 参数 | 默认值 | |
|---|---|---|
| `--@xclang//bazel:stdlib` | `libc++` | 设为 `platform` 时：使用平台的 C++ 标准库替代 libc++（MSVC 目标平台使用微软的 STL，macOS 目标平台使用同一 SDK 中的 libc++），并改用 `<target>-system.cfg` 配置文件（[系统的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)）。`@xclang//bazel:std` 会随之切换。其余目标平台以及 `--@xclang//runtimes:source` 均会拒绝这一选项 |

## 从源码构建运行时库

位于 `@xclang//runtimes` 下、作用于整个构建的参数（[从源码构建运行时库](../features/runtimes-from-source.md)）：

| 参数 | 默认值 | |
|---|---|---|
| `--@xclang//runtimes:source` | `false` | 使用工具链的 `libc++/src` 配合当前构建的特性与 `--copt` 为目标平台编译 libc++（含 libc++abi）、libc++experimental 与 libunwind，并在所有编译和链接中用它们替代预编译版本。在 MSVC 目标平台上会被拒绝 |
| `--@xclang//runtimes:hardening` | `none` | libc++ 的加固模式：`none`、`fast`、`extensive`、`debug` |
| `--@xclang//runtimes:abi_version` | `1` | libc++ 的 ABI 版本，`1` 或 `2` |
| `--@xclang//runtimes:abi_namespace` | `__<version>` | libc++ 的内联 ABI 命名空间，格式为 `__<name>` |
| `--@xclang//runtimes:abi_defines` | 无 | libc++ 的 ABI 宏（`_LIBCPP_ABI_*`），以逗号分隔 |
| `--@xclang//runtimes:exceptions` | `true` | 设为 `false` 时：构建禁用异常的 libc++ 与 libc++abi |
| `--@xclang//runtimes:rtti` | `true` | 设为 `false` 时：构建禁用 RTTI 的 libc++；需同时设置 `exceptions=false` |

这些运行时库是主机工具链仓库内的库目标，在与主构建相同但设置了 `@xclang//runtimes:building` 的独立配置下（使用不挂载源码运行时库的同一工具链），按 LLVM CMake 构建的方式编译（`bazel/runtimes_sources.bzl`）。构建启用的 sanitizer 特性会对 libc++ 与 libc++abi 插桩，但不会对 libunwind 或 MemorySanitizer 自身的运行时库插桩。所有运行时库均不启用 ThinLTO 编译。

遇到不支持的组合时，模块会立即停止构建并说明原因：在 MSVC 目标平台上启用从源码构建运行时库或设置任何相关参数；在未开启 `--@xclang//runtimes:source` 的情况下设置其他运行时库参数；在未开启源码运行时库或非 glibc 目标平台上启用 `msan`；或者启用了目标平台没有对应运行时库的 sanitizer 特性。

## 目标与规则

| Label | |
|---|---|
| `@xclang//bazel:std` | 针对当前目标平台的 libc++ `std` 与 `std.compat` 模块库目标，供其他目标依赖，使用当前构建的 `--cxxopt` 编译。配合 `--@xclang//bazel:stdlib=platform` 时，在 MSVC 目标平台上编译微软 STL 的模块，在 macOS 目标平台上则不可用（标记为不兼容） |
| `@xclang//bazel:debug_symbols.bzl` 中的 `xclang_debug_symbols(name, binary, gsymutil_args)` | 在除 MSVC 以外的所有目标平台上，调用单线程的 llvm-gsymutil 生成 `<binary>.gsym`（每次运行产出相同文件，`gsymutil_args` 追加在 `--num-threads=1` 之后），并在 macOS 目标平台上同时输出 `<binary>.dSYM`（需在 `cc_binary` 上启用 `generate_dsym_file`）；llvm-gsymutil 的日志位于输出组 `gsym_log` 中。在 MSVC 目标平台上则输出 `<binary>.pdb`（配合 `generate_pdb_file`） |
| `@xclang//bazel:llvm-gsymutil` | 当前主机工具链中的 llvm-gsymutil，可通过 `bazel run` 直接运行：`bazel run @xclang//bazel:llvm-gsymutil -- <absolute .gsym> --address=0x<address>` |
| `@xclang//bazel:resource_dir.bzl` 中的 `xclang_resource_dir(name, srcs)` | 将 clang 的资源目录按 `lib/clang/<major>/` 布置在调用它的包内，供同一包内的 `bin/<name>` 可执行文件使用；默认取自 `@libclang` |

## 标签

属于模块扩展 `use_extension("@xclang//bazel:extensions.bzl", "xclang")` 的标签，仅在根模块中生效：用于在接受厂商许可证的前提下从厂商获取 SDK（[构建 MSVC 目标平台，以及在任意主机上构建 macOS](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)）。各选项与 `xclang sdk fetch` 一致（[版本](../reference/xclang-command.md#versions)）。

| 标签 | |
|---|---|
| `xclang.windows_sdk(accept_license, preset, msvc_version, sdk_version)` | 面向 MSVC 目标平台获取微软的 CRT、STL 与 Windows SDK；设置 `accept_license = True` 表示接受 Visual Studio Build Tools 与 Windows SDK 许可条款 |
| `xclang.macos_sdk(accept_license, preset, version)` | 在非 macOS 主机上面向 macOS 目标平台获取 Apple 的 macOS SDK；设置 `accept_license = True` 表示接受 Xcode 与 Apple SDK 协议。`version = "latest"` 会选取拉取仓库当下 Apple 更新目录中列出的最新 SDK，不具备可复现性 |

## 仓库

由模块扩展 `use_extension("@xclang//bazel:extensions.bzl", "xclang")` 提供；每个仓库仅在构建实际用到时才会按需拉取。

| 仓库 | |
|---|---|
| `@libclang` | 当前目标平台的 libclang：包含带完整链接接口的 `@libclang//:clangBasic`、`:LLVMSupport` 等库目标，以及 `:headers`、`:resource_dir`、`:AllTargetsInfos`、`:AllTargetsDescs`、`:AllTargetsAsmParsers` 与 `:AllTargetsDisassemblers`。启用 `--features=asan` 时自动切换为 ASan 构建版本。不提供 MSVC 目标平台版本，依赖它的目标会自动标记为与 MSVC 目标平台不兼容 |
| `@libclang_asan` | ASan 构建版本（面向 Linux x64 与 macOS arm64 目标平台） |
| `@libclang_<target>` | 指定目标平台的 libclang |
| `@llvm_option_inc` | clang、lld、llvm-lib 与 llvm-dlltool 的选项表，作为纯头文件库提供 |

## 环境变量

通过 `--repo_env=<name>=<value>` 传入：

| 变量 | |
|---|---|
| `XCLANG_THINLTO_CACHE` | 链接器 ThinLTO 缓存目录的绝对路径；模块会自动创建这个目录（[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)） |
| `XCLANG_ROOT` | 直接使用本机已解压的主机工具链，替代发布版本中的压缩包 |
| `XCLANG_LIBCLANG_ROOT`, `XCLANG_LIBCLANG_ASAN_ROOT` | 直接使用本机已解压的主机 libclang 或其 ASan 构建版本，替代发布版本中的压缩包 |
| `BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1` | rules_cc 的变量：关闭其本机编译器探测。除非 `xclang` 的 `bazel_dep` 排在 `rules_cc` 之前，否则必须设置：Bazel 按模块 `bazel_dep` 的顺序匹配工具链，而 rules_cc 探测到的本机编译器会抢先接管主机构建（在 Windows 上还会接管所有 Windows 平台的构建） |
| `BAZEL_NO_APPLE_CPP_TOOLCHAIN=1` | apple_support 的变量：关闭其基于 Xcode clang 的工具链；在 Mac 上，如果 `apple_support` 的 `bazel_dep` 排在 `xclang` 之前，它会抢先接管 macOS 目标平台的构建 |

## 版本记录

`packages/bazel/bazel/versions.bzl` 记录了模块所下载的发布版本号，以及取自对应版本 `SHA256SUMS` 的各个压缩包 sha256 摘要。模块自身的版本号与发布版本号一致。
