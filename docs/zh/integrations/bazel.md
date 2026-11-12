# Bazel

xclang 是发布在 clice registry（[bazel.clice.io](https://bazel.clice.io)）上的 Bazel 模块，会将主机的 C++ 工具链注册到所有目标平台，并提供 `libclang` 与 LLVM 选项表的仓库。

要求：Bazel 9 与 `rules_cc` 0.2.25 及以上。请通过 [bazelisk](https://github.com/bazelbuild/bazelisk) 运行 Bazel（它会从 `.bazelversion` 读取版本）：可执行 `npm install -g @bazel/bazelisk`，或通过 `npx bazelisk` 运行 `devDependency` 中的包。conda-forge 没有提供 `bazelisk`，且其 `bazel` 软件包只能在 `--batch` 模式下运行。

## 配置项目

将 `rules_cc` 与 `xclang` 添加到 `MODULE.bazel`，并在 `.bazelrc` 中配置 clice registry 与 C++20 模块参数。示例项目位于 [examples/bazel](https://github.com/clice-io/xclang/tree/main/examples/bazel)：

<!-- file: examples/bazel/MODULE.bazel -->
```python
module(name = "hello")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.5.1")
```

`version`（在 `bazel_dep` 中）是项目所需的最低版本；Bazel 会在整个依赖图中选取所请求的最高版本（[版本号](../reference/releases.md#versions)）。`.bazelrc` 配置了 registry 以及使用 `import std` 所需的参数：

<!-- file: examples/bazel/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
common --enable_platform_specific_config
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
# import std: libc++'s modules are built with these options, and so are
# their importers.
common --cxxopt=-std=c++23 --host_cxxopt=-std=c++23
common --experimental_cpp_modules
common:windows --enable_runfiles
```

`BUILD.bazel` 构建了一个 import `std` 的二进制程序：

<!-- file: examples/bazel/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "hello",
    srcs = ["main.cpp"],
    features = ["cpp_modules"],
    deps = ["@xclang//bazel:std"],
)
```

`main.cpp` 与 [CMake 示例](cmake.md#set-up-a-project)中的文件相同。

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:hello
```

程序会输出 `hello from xclang: 3 targets, the first linux`。模块会自动注册其工具链。由于 Bazel 按 `bazel_dep` 的声明顺序求值工具链，`.bazelrc` 关闭了 `rules_cc` 的本机编译器探测（`BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1`）；如果项目将 `apple_support` 列在 `xclang` 之前，还需设置 `--repo_env=BAZEL_NO_APPLE_CPP_TOOLCHAIN=1`（[Bazel API](../reference/bazel-api.md)）。如果某个库模块仅在自身开发与测试中使用 `xclang`，请为这条 `bazel_dep` 标上 `dev_dependency = True`。

## 在 Windows 主机上

将两个 `startup` 选项写入 `%USERPROFILE%\.bazelrc`（`startup` 选项不支持按平台区分）。第一项设置较短的输出根目录，避开因默认路径过深触发的 Windows 路径长度限制；第二项创建符号链接形式的 runfiles，替代文件拷贝：

<!-- excerpt: .github/workflows/examples.yml -->
```
startup --output_user_root=C:/b
startup --windows_enable_symlinks
```

Bazel 在 Windows 上不使用沙盒运行动作，因此动作在 Windows 上可能会读取未声明的输入文件；同一目标在 Linux 与 macOS 上的构建则会校验这些声明。

## 构建其他目标平台

传入 `--platforms=@xclang//platforms:<target>` 即可构建其他目标平台：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:hello
```

十个目标平台列在 [Bazel API](../reference/bazel-api.md) 与[交叉编译](../guide/cross-compiling.md#targets-and-hosts)中。交叉编译直接使用主机工具链压缩包中针对目标平台的配置，Bazel 不会下载第二个工具链压缩包。`@xclang//bazel:std` 与 `@libclang` 会自动跟随目标平台切换，而在执行配置（`cfg = "exec"`）下构建的工具则面向主机平台构建。你也可以自定义 `platform` 目标：工具链按操作系统与 CPU 匹配，未添加 C 标准库约束时 Linux 默认选用 `glibc`、Windows 默认选用 MinGW；如需选用 musl 或 MSVC，请分别添加 `@xclang//platforms/libc:musl` 或 `@xclang//platforms/libc:msvc`。

- **musl 目标平台**：`--platforms=@xclang//platforms:x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl` 可在任意主机上构建静态程序（[musl 目标平台](../guide/cross-compiling.md#musl-targets)）。在同架构的 Linux 主机上，`bazel test` 可直接运行它们的测试。
- **MSVC 目标平台，以及在非 macOS 主机上构建 macOS 目标平台**：需要在根 `MODULE.bazel` 中声明接受厂商许可证（[见下文](#build-for-msvc-and-for-macos-anywhere)）。未添加对应标签时，构建会立即报错失败并提示需要添加的内容。
- **默认共用同一个输出目录**：Bazel 9 会将不同平台的构建产物写入同一个 CPU 输出目录（如 `k8-fastbuild`），因此切换 `--platforms` 会覆盖先前的产物。在 `common --experimental_platform_in_output_dir` 写入 `.bazelrc` 后，可为每个平台分配独立的目录（如 `x86_64-w64-mingw32-fastbuild`）。
- **为其他目标平台构建测试**：`bazel test` 会在主机上运行测试，因此交叉编译出的测试请放到目标平台的机器上运行（[CI](ci.md#build-on-one-runner-run-on-another)）。`cc_test` 可为任意目标平台构建；其他测试规则只有在存在匹配目标平台操作系统与 CPU 的执行平台时才能构建，或传入 `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain=false` 在任意主机上构建。

## 构建 MSVC 目标平台，以及在任意主机上构建 macOS

将 `xclang.windows_sdk` 与 `xclang.macos_sdk` 添加到根 `MODULE.bazel` 中以接受厂商许可证，让模块扩展获取微软的 CRT 与 Windows SDK（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)）以及 Apple 的 macOS SDK（[macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)）：

```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
xclang.windows_sdk(accept_license = True)
xclang.macos_sdk(accept_license = True)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-pc-windows-msvc //:hello
bazel build --platforms=@xclang//platforms:aarch64-apple-darwin //:hello
```

- **仅根模块生效**：只有根模块中的标签会生效，依赖项中的标签会被忽略。未设置 `accept_license = True` 时，需要 SDK 的构建会打印厂商许可条款并停止（[厂商 SDK](../guide/cross-compiling.md#vendor-sdks)）。
- **锁定版本**：扩展默认使用 `windows-latest` 与 `macos-latest` 预设。传入 `preset = "windows-2022"` 可改用其他 runner 预设，也可传入 `msvc_version` 与 `sdk_version`（Windows）以及 `version`（macOS）锁定具体版本（[预设、版本与 `latest`](../guide/cross-compiling.md#presets-and-versions)、[Bazel API](../reference/bazel-api.md)）。
- **首次需要时按需获取**：每个 SDK 都是独立的仓库（`xclang_windows_sdk_x86_64`、`xclang_windows_sdk_aarch64`、`xclang_macos_sdk`）。只有当构建面向对应平台时，Bazel 才会把厂商安装包下载到仓库缓存中，并由工具链的 `xclang` 命令将其解压到 output base。在 macOS 主机上，macOS 目标平台直接使用 Xcode 的 SDK。如果 Apple 下架了某个锁定的 macOS 安装包，`xclang` 会按内容摘要定位替代安装包并直接下载（[Apple 下架的安装包](../design/macos.md#packages-apple-withdraws-and-content-digests)）。
- **切勿公开共享厂商 SDK 缓存**：仓库缓存中存有厂商安装包，而远程执行会上传包含 SDK 文件在内的动作输入。请勿将包含这些内容的仓库缓存或远程执行缓存设为公开或对外共享；仅缓存动作产物的远程缓存则不会分发 SDK。

在 MSVC 目标平台上，C++ 编译默认使用 `-std=c++17`（除非 `--cxxopt` 或 `copts` 指定了标准版本），并链接[混合 CRT](../guide/cross-compiling.md#msvc-targets)。其工具链特性包括：

- `generate_pdb_file`（在 `-c dbg` 下默认开启）：写出 `<name>.pdb`（输出组 `pdb_file`），其中源文件路径相对于执行根目录，且在二进制文件中仅内嵌文件名。
- `dynamic_link_msvcrt`：链接动态 VC 运行时 DLL（`/MD`）。
- `debug_msvcrt`：链接调试版 CRT（默认 `/MTd`，开启 `/MDd` 需配合 `dynamic_link_msvcrt`）。
- `gc_sections`：向链接器传入 `/opt:ref`（针对 `lld-link`，与 MinGW 一样默认关闭）。

`@libclang` 没有面向 MSVC 目标平台的预编译压缩包，因此依赖 `@libclang` 的目标会标记为与 MSVC 平台不兼容，并在构建 `//...` 时自动跳过。

在 macOS 目标平台上，部署目标版本由 `--macos_minimum_os` 控制，且不低于 `13.0`（[macOS](../guide/cross-compiling.md#stdlib-platform-and-the-deployment-target)）。不同于 `rules_cc` 内置的 macOS 工具链，xclang 的工具链不会在每次链接时传入 `-fobjc-link-runtime`，因此 C++ 程序只会链接自身及其依赖项显式声明的 framework。使用 CoreFoundation 的库需声明 `linkopts = ["-Wl,-framework,CoreFoundation"]`；对于未声明这一参数的依赖项，启用 `macos_default_link_flags` 特性即可恢复传入 `-fobjc-link-runtime`。

`--@xclang//bazel:stdlib=platform` 会基于[平台的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)而非 xclang 的 `libc++` 构建：在 MSVC 目标平台上使用微软的 STL（此时 `@xclang//bazel:std` 会构建 STL 的模块），在 macOS 目标平台上使用 SDK 的 `/usr/lib/libc++.1.dylib`（此时 `@xclang//bazel:std` 不可用）。Linux、musl 与 MinGW 目标平台会拒绝这一参数，因为它们的平台 `libstdc++` 位于工具链外部。

## 功能

- **C++20 模块与 `import std`**：依赖 `@xclang//bazel:std` 以使用 `import std`，并将模块接口列在 `module_interfaces` 中，同时加上 `features = ["cpp_modules"]`（[C++20 模块](../features/modules.md#bazel)）。
- **Sanitizer**：传入 `--features=asan`、`ubsan`、`tsan`、`lsan` 或 `msan`，即可对构建插桩并链接匹配的运行时库（[Sanitizer](../features/sanitizers.md#bazel)）。
- **从源码构建运行时库**：传入 `--@xclang//runtimes:source`，即可使用工具链内置源码编译 `libc++`、`libc++abi` 与 `libunwind`，并启用加固模式、自定义 ABI 选项、禁用异常或 RTTI，或启用 MemorySanitizer（[从源码构建运行时库](../features/runtimes-from-source.md#bazel)）。
- **调试、GSYM、dSYM 与剥离符号**：在 gdb、lldb 或 VS Code 中将 `.` 映射到 `bazel-<workspace>`（[在 gdb、lldb 与 VS Code 中调试](../features/debugging.md#debug-in-gdb-lldb-and-vs-code)），并使用 `xclang_debug_symbols`、`generate_dsym_file` 与 `<binary>.stripped` 发布调试符号和剥离符号后的二进制文件（[调试](../features/debugging.md#bazel)）。
- **libclang 与 ThinLTO 缓存**：从 `libclang` 与 `llvm_option_inc` 所在的 `xclang` 模块扩展加载仓库，并设置 `--repo_env=XCLANG_THINLTO_CACHE=<dir>`（在 Linux 上还需加上 `--sandbox_writable_path=<dir>`）缓存 ThinLTO 链接结果（[libclang](../features/libclang.md#bazel)、[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)）。

## 生成 compile_commands.json

从 clice registry 添加 `compdb` 模块，即可为编辑器及 clice、clangd 等语言服务器生成 `compile_commands.json`：

```python
bazel_dep(name = "compdb", version = "0.1.0", dev_dependency = True)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run @compdb//:refresh
bazel run @compdb//:refresh -- //:hello
```

不带参数时，`@compdb//:refresh` 覆盖 `//...`；带参数时，它接受 `bazel build` 参数与目标匹配模式（如 `--config=dev //src/...`）。它会求值一个不执行实际编译的 aspect，在工作区根目录下写出以执行根目录作为 `compile_commands.json` 中 `directory` 字段的编译数据库，涵盖 C、C++、C++20 模块接口及所有 import 它们的文件。详见 [registry README](https://github.com/clice-io/bazel#compdb)。

## 使用特定提交或已解压的工具链

配合 `git_override` 与 `strip_prefix = "packages/bazel"` 可测试本仓库的某个提交；对应提交中的 `packages/bazel/bazel/versions.bzl` 指定了它所下载的发布压缩包版本（`main` 分支跟踪最新发布版本）：

```python
bazel_dep(name = "xclang", version = "23.1.2.8")
git_override(
    module_name = "xclang",
    remote = "https://github.com/clice-io/xclang",
    commit = "<commit>",
    strip_prefix = "packages/bazel",
)
```

如需使用本机已解压的工具链压缩包（例如 CI 构建产物），请传入 `--repo_env=XCLANG_ROOT=<dir>`；若还有已解压的主机版，可一并设置 `XCLANG_LIBCLANG_ROOT` 或 `XCLANG_LIBCLANG_ASAN_ROOT` 指向对应的 `libclang`。交叉编译目标平台仍会从发布版本中下载对应的 `libclang` 压缩包。
