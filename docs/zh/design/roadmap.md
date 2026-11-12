# 路线图

尚未进入正式发版的每个目标平台与功能都在本页占一行，并标有一个状态词。其他页面直接链接到对应行，不再重复说明状态。已进入正式发版的内容记录在各自的文档页中，每次发版的变更见 [CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md)。

| 状态 | 含义 |
|---|---|
| 已支持 | 已包含在正式发版中。 |
| 未发布 | 已合入 `main` 并由 CI 测试，但尚未随正式版本发布。 |
| 计划中 | 已确定要做，尚未进入正式发版，可能正在某个分支上推进。 |
| 研究中 | 希望支持，但能否做好尚无定论。 |
| 考虑中 | 希望支持，但具体形态或维护成本尚待权衡。 |
| 不计划 | 按设计不在支持范围内。 |

## 愿景

xclang 的目标是让 `clang` 拥有 `rustup`、`cross-rs` 与 `cargo-zigbuild` 带给 Rust 的体验：一个编译器覆盖所有目标平台。常用目标平台随每个主机压缩包一同分发，受许可证限制无法再分发的厂商 SDK 由用户直接从厂商拉取，C++ 运行时库则可按需从源码构建（[什么是 xclang？](../guide/what-is-xclang.md)、[交叉编译](../guide/cross-compiling.md)）。内置集合之外的更多目标平台将作为独立的目标平台压缩包发布，在构建需要时按需拉取。每个目标平台都遵循[封闭性](hermeticity.md)原则：程序在运行时只依赖无法再分发的操作系统库，其余全部静态链接。

## 目标平台

目标平台的 tier 表示 CI 测试它的方式（[目标平台与主机](../guide/cross-compiling.md#targets-and-hosts)）：Tier 1 在 GitHub 托管的 runner 上原生运行测试（包括在 `x86_64` Windows 上运行 `x86` 二进制程序，以及在 `wasmtime` 下运行 WebAssembly 二进制程序），Tier 2 在模拟器或虚拟化环境中运行测试，Tier 3 仅编译与链接而不运行。Tier 3 目标平台可能[按需从源码构建](../features/runtimes-from-source.md)运行时库，而不随包附带预编译库。「用户（SDK）」表示目标平台需要用户在接受厂商许可证后自行拉取厂商 SDK。

| 目标平台 | C 运行时库 | 来源 | Tier | 状态 |
|---|---|---|---|---|
| <a id="windows-x86-msvc"></a>Windows x86 (MSVC) | 微软的 CRT 与 STL、Windows SDK | 用户（SDK） | 1 | 研究中 |
| <a id="windows-7"></a>Windows 7 与 XP (MSVC) | 微软的静态 CRT，配合 YY-Thunks | 用户（SDK） | 3 | 研究中 |
| <a id="windows-x86-mingw"></a>Windows x86 (MinGW) | mingw-w64，UCRT | xclang | 1 | 考虑中 |
| <a id="arm64ec"></a>Windows arm64ec | 微软的 ARM64EC 库 | 用户（SDK） | 3 | 考虑中 |
| <a id="msvcrt"></a>基于 msvcrt 的 Windows (MinGW)，Windows 10 之前 | msvcrt | | | 不计划 |
| <a id="glibc-newer"></a>带更高版本 glibc 的 Linux x64、arm64 | glibc 2.28 | xclang | 1 | 考虑中 |
| <a id="linux-architectures"></a>Linux x86 | glibc 2.17 | xclang | 1 | 考虑中 |
| Linux armv7（硬浮点） | glibc 2.17 | xclang | 2 | 考虑中 |
| Linux riscv64 | glibc 2.31 | xclang | 2 | 考虑中 |
| Linux ppc64le, s390x | glibc 2.17 | xclang | 2 | 考虑中 |
| Linux loongarch64 | glibc 2.36 | xclang | 2 | 考虑中 |
| <a id="musl-architectures"></a>Linux riscv64, armv7 (musl) | musl | xclang | 2 | 考虑中 |
| <a id="wasm"></a>WebAssembly (`wasm32-wasip1`, `wasm32-wasip2`) | wasi-libc | xclang | 1 | 考虑中 |
| <a id="android"></a>Android arm64, x64, armv7 | bionic | 用户，来自 NDK（SDK） | 2 | 考虑中 |
| <a id="openharmony"></a>OpenHarmony arm64 | OpenHarmony 的 musl | xclang | 2 | 考虑中 |
| <a id="freebsd"></a>FreeBSD x64, arm64 | FreeBSD 14 的 libc | xclang | 2 | 考虑中 |
| <a id="bsd"></a>OpenBSD, NetBSD | 各自的 libc | xclang | 3 | 考虑中 |
| <a id="bare-metal"></a>裸机：Arm Cortex-M、-R、-A、AArch64、RISC-V | picolibc | xclang | 2 | 考虑中 |
| <a id="ios"></a>iOS、tvOS、watchOS、visionOS 及其模拟器 | Apple 的 SDK | 用户，来自完整版 Xcode（SDK） | 3 | 研究中 |
| <a id="emscripten"></a>Emscripten | Emscripten 自带 | emsdk | | 不计划 |

- **更高版本的 glibc**：面向需要 glibc 2.17 所缺特性（如 `-static-pie` 与较新的 C 标准库接口）的程序提供 `x86_64` 与 `aarch64` Linux 目标平台，同样搭配静态 `libc++` 与 `compiler-rt`。
- **其他 Linux 架构**：各自使用对应架构可用的最早 glibc 版本（`riscv64` 与 `loongarch64` 没有 glibc 2.17），并提供 `compiler-rt` 在对应架构上支持的 sanitizer。
- **WebAssembly**：`wasm32-wasip2` 使用每个主机压缩包内置的 `wasm-component-ld` 链接；C++ 异常按需开启。
- **Android**：基于 NDK 的 sysroot 构建，搭配配置在 NDK 内联 ABI 命名空间（`__ndk1`）下的 xclang 静态 `libc++`。
- **iOS 及 Apple 其他设备平台**：这些平台的 SDK 仅随完整版 Xcode 分发（下载需要 Apple ID），其 C++ 运行时库预计将[按需从源码构建](../features/runtimes-from-source.md)。
- **Windows 7 与 XP**：MSVC 目标平台链接静态 CRT 并配合 [YY-Thunks](https://github.com/Chuyu-Team/YY-Thunks) 补齐旧版 Windows 缺失的 API（`mingw-w64` 搭配 `libc++` 无法支持 XP；Windows 9x 不在支持范围内）。
- **`msvcrt`**：xclang 的 MinGW 目标平台使用 UCRT（Windows 10 及以上）；不计划提供面向旧版 `msvcrt.dll` 的 MinGW 变体。
- **Emscripten**：`emsdk` 自带完整工具链，因此 Emscripten 不作为 xclang 的目标平台。

## xclang 命令

| 条目 | 状态 |
|---|---|
| <a id="target-archives"></a>供 `xclang target add` 使用的目标平台压缩包与发版索引 | 计划中 |
| <a id="fetched-targets-in-build-systems"></a>在 CMake 软件包与 Bazel 模块中支持拉取的目标平台 | 计划中 |

[`xclang target add`](../reference/xclang-command.md#targets) 已实现按发版清单（记录每个目标平台压缩包的 URL、`sha256`、大小、tier 及所需厂商 SDK）将同一发版的单目标平台压缩包解压到工具链目录中（包含 sysroot、预编译运行时库、`compiler-rt`、配置文件与 C 运行时库许可证声明）。待后续发版提供目标平台压缩包后，CMake 软件包与 Bazel 模块会将拉取的目标平台与内置目标平台一并配置和注册。

## 运行时库与工具

| 条目 | 状态 |
|---|---|
| <a id="runtimes-msvc"></a>面向 MSVC 目标平台从源码构建运行时库 | 计划中 |
| <a id="runtimes-bazel-lto"></a>在 Bazel 中将源码构建的运行时库与程序一起执行 LTO | 考虑中 |
| <a id="musl-sanitizers"></a>面向 musl 目标平台的 ASan、TSan、LSan 与 libFuzzer，配合动态链接的 musl（采用 Alpine 的方式） | 考虑中 |
| <a id="libgcc-s-script"></a>将 `libgcc_s.a` 改为指向 libunwind 的链接器脚本，供 Rust 的 Linux 目标平台使用 | 考虑中 |
| <a id="openmp"></a>OpenMP 运行时库 | 不计划 |
| <a id="tool-binaries"></a>clang-format、clang-tidy 与 clangd 可执行程序 | 不计划 |
| <a id="shared-runtime"></a>跨共享库共享的 C++ 运行时库 | 不计划 |
| <a id="conda-forge"></a>用于构建 conda-forge 软件包的编译器 | 不计划 |
| <a id="libclang-msvc"></a>面向 MSVC ABI 程序的 libclang | 不计划 |

- **面向 MSVC 目标平台从源码构建运行时库，以及 Bazel 中的 ThinLTO**：扩展[从源码构建运行时库](../features/runtimes-from-source.md)，支持基于拉取的 Windows SDK 用 `clang-cl` 在 `vcruntime` 之上编译 `libc++`；同时在 Bazel 中将源码构建的运行时库作为 `cc_library` 依赖暴露出来，让 Bazel 对它们的位码目标文件执行 ThinLTO 后端动作。
- **musl 目标平台的 sanitizer**：ASan、TSan 与 LSan 需要借助 `dlsym` 拦截 C 标准库函数，而静态链接的 musl 可执行文件没有 `dlsym`（[sanitizer](../features/sanitizers.md#musl-targets)）。支持它们需要像 Alpine Linux 那样提供动态链接 `libc.so` 的 musl 目标平台变体。
- **将 `libgcc_s.a` 作为链接器脚本**：把 Linux sysroot 中的空静态库 `libgcc_s.a` 替换为 `INPUT(-lunwind)`，使手动配置的 `*-unknown-linux-gnu` Cargo 构建无需额外添加 `-Clink-arg=-l:libunwind.a` 即可完成链接（[不使用 `xclang cargo`](../integrations/cargo.md#without-xclang-cargo)）。
- **不计划**：xclang 是编译器工具链，编辑器或静态检查工具直接链接 [`libclang`](../features/libclang.md)；`libc++` 静态链接进每个二进制文件，不在动态库之间共享（[每个共享对象独立的 `libc++`](hermeticity.md#one-libc-per-shared-object)）；conda-forge 配方使用 conda-forge 自己的动态链接编译器包；`libclang` 仅面向六个主机平台构建（Windows 上为 MinGW，供 clice 使用），不提供 MSVC ABI 版本。

## 编译速度

| 条目 | 状态 |
|---|---|
| <a id="pgo-training"></a>覆盖 Objective-C、clang-cl、Mach-O 链接与 libclang clang-tidy 检查的 PGO 训练 | 计划中 |
| <a id="bolt"></a>在 PGO 与 ThinLTO 之上为 Linux 主机的 clang 与 lld 启用 BOLT | 研究中 |

[PGO 训练语料](pgo.md#the-training)会在各版本之间持续扩充。

## 可复现性与供应链

| 条目 | 状态 |
|---|---|
| <a id="cmake-relative-paths"></a>在 CMake 构建的调试信息中使用相对路径 | 计划中 |
| <a id="immutable-releases"></a>不可变的 GitHub Release | 计划中 |
| <a id="slsa"></a>SLSA 溯源证明（provenance attestation） | 计划中 |

- **CMake 中的相对调试路径**：CMake 构建目前会在 DWARF 与 Mach-O 调试映射中记录构建目录的绝对路径，而 Bazel 构建记录的是相对于执行根目录的路径（[调试信息中的路径](../features/debugging.md#paths-in-debug-information)）。
- **不可变的 GitHub Release 与 SLSA 溯源证明**：防止已发布的压缩包与 `SHA256SUMS` 在 GitHub 上被同时替换（[校验下载文件](../reference/releases.md#checking-a-download)），并附上可验证的构建溯源证明，将每个发版产物与对应的提交及 GitHub Actions 工作流运行记录绑定。

## 紧跟 LLVM

| 条目 | 状态 |
|---|---|
| <a id="llvm-releases"></a>LLVM 24.x 及后续每个 23.1 版本，随上游发布跟进 | 计划中 |

每次上游发布新的 LLVM 版本时，都会基于新版本校验[补丁序列](../reference/patches.md)并构建，同时移除上游已合入的补丁。

## 开放问题

上述条目中尚待敲定的设计选择：

- **Android 的 sysroot**：是由 `xclang sdk fetch` 从 Google 的 NDK 中仅下载所需文件，还是由 xclang 直接分发 sysroot。
- **Apple 设备平台的运行时库**：鉴于 Apple 许可证对设备平台库与 macOS 库有不同规定，是发布预编译压缩包，还是仅按需从源码构建。
- **高于 2.17 的 glibc**：构建时是传入命名配置文件（`--config=`）选择，还是使用独立的 target triple 写法。
- **拉取的目标平台存放位置**：是只存放在工具链目录内，还是同时支持存放在用户指定的目录。
