# PGO

在全部六个主机平台上，xclang 的 `clang` 与 `lld` 均使用在 Linux x64 上采集的单份前端 profile 开启按 profile 引导的优化（PGO）与 ThinLTO 构建。在 23.1.2.6 的 C++ 基准测试中，xclang 在 Linux 与 macOS 上的编译速度与 LLVM 官方的 PGO+ThinLTO 发布构建持平，在 Windows x64 上则比 LLVM 官方构建快 11% 至 22%；在 23.1.2.1 中，相比未启用 PGO 的同一构建，这份 profile 将 C++ 编译耗时缩短了 16% 至 34%。

## 训练负载

PGO 会针对训练期间实际执行的代码路径优化编译器与链接器。在 [`toolchain/pgo/train.ts`](https://github.com/clice-io/xclang/blob/main/toolchain/pgo/train.ts) 中，带插桩的 Linux x64 版 `clang`、`clang-scan-deps` 与 `lld` 会运行同时覆盖构建系统与语言服务器场景的训练负载：

- **C 与 C++ 编译**：在 `-O0 -g` 与 `-O2` 下为 `x86_64` 和 `aarch64` Linux 编译 Abseil（`-std=c++20`）与 SQLite（`sqlite3.c`、`shell.c`），外加在 `-O2 -flto=thin` 下为这两个 Linux 目标平台编译 SQLite，以及在 `-O0 -g` 与 `-O2` 下为 `x86_64-w64-mingw32` 编译 SQLite。
- **预编译头与编辑器前导头（preamble）**：一份共用的预编译头，在 `-O0 -g`、`-O2` 与 `-fsyntax-only` 下读取并对 `absl::` 执行代码补全；同时从每个 Abseil 源文件开头的 `#include` 块提取前导头，为每个文件单独预编译一次，再模拟编辑器的行为用它解析函数体并对 `std::` 和 `absl::` 执行代码补全。
- **C++20 模块与 P1689 依赖扫描**：在 `-std=c++23` 下编译 `libc++` 的 `std` 与 `std.compat`、`magic_enum`、`Vulkan-Hpp`（在 `x86_64` 上编译 `vulkan.cppm` 与 `vulkan_video.cppm`）、封装为模块的 `nlohmann/json`、包含多个分区的 `geometry` 模块（`shapes`、`detail`、`algorithms`），以及所有 import 它们的文件。在 `-O2` 下，模块分两步构建（先用 `--precompile` 生成 `.pcm`，再由 `.pcm` 编译为 `.o`）；在 `-O0 -g` 下，使用精简模块文件（`-fmodules-reduced-bmi -fmodule-output=`）单步完成构建。随后运行 `clang-scan-deps -format=p1689` 扫描单条编译命令（模拟 CMake 的调用方式）以及完整的 Abseil `compile_commands.json` 数据库。
- **代码补全**：在 Abseil 源文件、预编译头使用方、前导头以及 import 模块的文件上运行 `-fsyntax-only -Xclang -code-completion-at=...`（补全 `std::`、`nlohmann::`、`magic_enum::`、`geometry::`、`vk::`、`j.`）。
- **链接**：通过 `lld` 执行 ELF 链接（包括在 `-O0 -g`、`-O2` 与 `-O2 -flto=thin` 下链接 `x86_64` 和 `aarch64` Linux 程序，以及链接各模块示例程序）与 COFF 链接（在 `-O0 -g` 与 `-O2` 下链接 `x86_64-w64-mingw32` 的 SQLite）。

整个训练过程在约 23 分钟内运行约 1,700 次调用，为每个版本合并生成一份 profile，并作为 `xclang-<version>.profdata` 发布（[版本发布](../reference/releases.md#assets)）。

目前的训练语料尚未涵盖 Objective-C、`clang-cl` 与 MSVC 模式解析、Mach-O 链接（`ld64.lld`）、`aarch64` COFF 链接、仅在 Windows 或 macOS 主机上执行的代码路径、sanitizer 编译趟（pass），以及 `clang` 自身不调用的 `libclang` 库（如 `clang-tidy` 检查项、`clangIndex`、`clangIncludeCleaner`）。扩充训练语料以覆盖这些路径已在[计划中](roadmap.md#pgo-training)，并在各版本之间持续推进。

## 一份 Profile 通用于所有主机

`clang` 支持两种 PGO 插桩模式，决定了在一台主机上采集的 profile 能否用于优化另一台主机：

- **IR 插桩**（`-fprofile-generate`）：在早期优化趟之后对 LLVM IR 插桩，并对此时每个函数的控制流图计算哈希。由于早期优化趟会参考目标平台的代价模型，同一个源码函数在 `x86_64` 与 `arm64` 上可能生成不同的控制流图，导致在一种架构上采集的 profile 无法匹配另一种架构。
- **前端插桩**（`-fprofile-instr-generate`，对应 LLVM 的 `LLVM_BUILD_INSTRUMENTED=Frontend`）：直接对 `clang` AST 插桩，并根据函数的源码结构计算哈希。同一份源码在所有目标平台上都会生成相同的哈希。

xclang 采用前端插桩。在 23.1.2.1 之前的实验中，在 Linux x64 上采集的 profile 在全部六个主机平台上都能匹配 113,000 个函数中的几乎全部（每个平台仅差 0 或 1 个函数），且所得编译耗时与合并全部六个主机各自采集的 IR profile 相比，差异在 runner 波动误差范围内（下表为编译 Abseil / LLVM `Sema` 相对于不启用 PGO 的耗时比值，取五台 runner 的中位数）：

| 主机 | 前端插桩（单份 Linux profile） | IR 插桩（六个主机的 profile 合并） |
|---|---|---|
| Linux x64 | 0.725 / 0.727 | 0.722 / 0.721 |
| Linux arm64 | 0.814 / 0.800 | 0.826 / 0.844 |
| macOS arm64 | 0.905 / 0.818 | 0.895 / 0.864 |
| Windows x64 | 0.771 / 0.792 | 0.764 / 0.820 |

因此，训练只需在单台 Linux x64 runner 上运行一次，生成的 profile 即可用于优化全部六个主机的工具链与 `libclang` 压缩包，无需在各个主机上分别构建插桩版本或借助模拟器运行。

### 重映射文件

前端 profile 按修饰名（mangled name）查找每个函数，而固定宽度整数类型与指针大小整数类型在 LP64 与 LLP64/Darwin ABI 下的名称修饰规则不同：`size_t` 与 `uint64_t` 在 Linux 上是 `unsigned long`（编码为 `m`），但在 Windows 上是 `unsigned long long`（编码为 `y`；在 macOS 上 `uint64_t` 也是 `unsigned long long`）；而 `int64_t` 在 Linux 上是 `long`（`l`），在 Windows 与 macOS 上则是 `long long`（`x`）。如果不做重映射，参数含有 `size_t` 或 `uint64_t` 的函数在 Windows 与 macOS 上的修饰名就会与 Linux profile 中的记录不同，从而无法获得 profile 计数。

为此，[`toolchain/pgo/remap.txt`](https://github.com/clice-io/xclang/blob/main/toolchain/pgo/remap.txt) 通过 `-fprofile-remapping-file` 映射了 `type m y` 与 `type l x`。在同一批 23.1.2.1 之前的实验中，加入重映射文件后，Abseil / `Sema` 的相对编译耗时在 macOS arm64 上从 `0.896 / 0.923` 改善到了 `0.794 / 0.845`，在 Windows x64 上从 `0.787 / 0.824` 改善到了 `0.772 / 0.829`。

还有两小类函数无法通过 LLVM 的重映射器匹配：

- 在 Windows 上，有 230 个带有上述类型整数字面量模板实参的函数（占总计数的 1.8%）。
- 具有内部链接的函数：在 Windows 上有 122 个，在 macOS 上有 39 个（分别占总计数的 0.06% 与 0.02%），因为前端 profile 中 `static` 函数的键格式为 `<file>:<mangled>`，而重映射器在解析修饰名前不会剥离 `<file>:` 前缀。

## 实测收益

`bench.yml`（`tests/bench/bench.ts`）使用未包含在训练语料中的代码，在各主机平台的 runner 上测量本机编译耗时：

- `fmt` 的十个测试文件（重度使用模板的 C++20 代码）；
- `lua` 的 C 源文件；
- 预编译 `libc++` 的 `std` 模块。

每项负载分别在 `-fsyntax-only`、`-O0 -g` 与 `-O2` 下逐文件单进程编译。测试在同一台 runner 上按轮次交替轮换各编译器的执行顺序，先取单机多轮测试的中位数，再取各机器相对于基准编译器比值的跨机中位数。百分之几以内的差异属于 runner 的正常波动。

基准编译器为同版本的 LLVM 官方发布构建：在 Linux 与 macOS 上启用了 PGO 与 ThinLTO（Linux x64 上还启用了 BOLT；为 xclang 的 Linux 主机启用 BOLT 目前在[研究中](roadmap.md#bolt)），在 Windows 上则启用了 PGO 但未启用 LTO。由于 LLVM 官方未发布 `x86_64` macOS 二进制包，在 `x86_64` macOS 上以 xclang 自身作为基准。

### 23.1.2.6

相对于 LLVM 23.1.2 官方发布构建的编译耗时比值，每个主机取五台 runner 的中位数，测于 2026-10-06（[运行记录 37356476645](https://github.com/clice-io/xclang/actions/runs/37356476645)，测量已发布的 23.1.2.6 压缩包；Linux x64 因其中一个任务在基准测试前统计体积时失败而取四台 runner）。标有 `llvm.exe` 的行直接调用 `llvm.exe clang++`，不经过 `clang++.exe` 启动器：

| 主机 | fmt（语法检查 / O0 / O2） | lua（语法检查 / O0 / O2） | std（O0 / O2） |
|---|---|---|---|
| Linux x64 | 1.035 / 1.009 / 1.069 | 1.118 / 1.062 / 1.109 | 1.013 / 1.022 |
| Linux arm64 | 1.000 / 0.976 / 1.042 | 1.082 / 1.011 / 1.075 | 0.970 / 0.994 |
| macOS arm64 | 0.902 / 0.935 / 1.014 | 1.169 / 0.971 / 0.959 | 0.980 / 0.890 |
| Windows x64 | 0.798 / 0.825 / 0.890 | 1.083 / 1.050 / 1.001 | 0.777 / 0.849 |
| Windows x64, `llvm.exe` | 0.798 / 0.809 / 0.885 | 0.968 / 0.960 / 0.974 | 0.821 / 0.844 |
| Windows arm64 | 0.888 / 0.906 / 0.954 | 1.271 / 1.212 / 1.167 | 0.925 / 0.940 |
| Windows arm64, `llvm.exe` | 0.860 / 0.898 / 0.947 | 1.019 / 1.065 / 1.056 | 0.915 / 0.932 |

同一批 macOS runner 上也运行了 Apple 的 `clang`：在 `arm64` 上（相对于 LLVM 官方构建），它在 `fmt` 上的耗时比值为 `1.097 / 1.207 / 1.206`，在 `lua` 上为 `0.879 / 0.875 / 1.004`；在 `x86_64` 上（相对于 xclang），它在 `fmt` 上为 `1.168 / 1.223 / 1.221`，在 `lua` 上为 `0.841 / 0.973 / 0.990`。

23.1.2.6 实测结果小结：

- **Linux 与 macOS**：在 C++ 代码上，xclang 与 LLVM 官方的 PGO+ThinLTO 构建表现持平；在 `lua` 的小型 C 文件上耗时最多增加 17%。在 LLVM 官方二进制文件额外经过 BOLT 优化的 Linux x64 上，xclang 在 C++ 上耗时最多增加 7%，在 C 上最多增加 12%。
- **Windows**：相比 LLVM 使用 MSVC 构建的 `clang`（启用 PGO 但未启用 LTO），xclang 使用 MinGW 构建的 `clang`（启用 PGO 与 ThinLTO）在 C++ 编译上耗时在 x64 上缩短 11% 至 22%，在 arm64 上缩短 5% 至 11%。
- **Windows 启动器开销**：`lua` 的每个 C 文件只需几十毫秒即可编译完成，因此相比直接运行 `llvm.exe clang++`，先启动 `clang++.exe` 再拉起 `llvm.exe` 在 x64 上最多增加 12% 耗时，在 arm64 上最多增加 25% 耗时；而在 C++ 文件上，进程启动开销可以忽略不计（[启动器](windows.md#the-launchers)）。
- **Apple 的 `clang`**：在两种 macOS 架构上编译 `fmt` 均比 xclang 多花 17% 至 29% 的时间，而在 `lua` 上的耗时则介于快 25% 到慢 5% 之间。

### 23.1.2.1

相对于 LLVM 23.1.2 官方发布构建的编译耗时比值，取三台 runner 的中位数（Linux 与 macOS 见[运行记录 36249036595](https://github.com/clice-io/xclang/actions/runs/36249036595)，Windows 见[运行记录 36250216010](https://github.com/clice-io/xclang/actions/runs/36250216010)），最后一列为不启用 PGO profile 编译的同一 xclang 构建（`no PGO, fmt`）：

| 主机 | fmt（语法检查 / O0 / O2） | lua | std（O0 / O2） | 未启用 PGO，fmt |
|---|---|---|---|---|
| Linux x64 | 1.031 / 1.006 / 1.046 | 1.106 / 1.061 / 1.098 | 1.047 / 1.022 | 1.279 / 1.250 / 1.244 |
| Linux arm64 | 0.972 / 0.957 / 1.018 | 1.012 / 0.968 / 1.050 | 0.959 / 0.964 | 1.283 / 1.237 / 1.272 |
| macOS arm64 | 0.986 / 0.983 / 1.050 | 0.948 / 0.804 / 0.994 | 0.860 / 0.955 | 1.367 / 1.323 / 1.353 |
| Windows x64 | 0.809 / 0.830 / 0.893 | 1.075 / 1.049 / 1.041 (`llvm.exe`: 1.044 / 0.987 / 1.020) | 0.885 / 1.021 | 1.226 / 1.155 / 1.227 |
| Windows arm64 | 0.899 / 0.916 / 0.958 | 1.332 / 1.238 / 1.187 (`llvm.exe`: 1.090 / 1.058 / 1.079) | 0.944 / 0.939 | 1.178 / 1.150 / 1.162 |

- **Profile 的效果**：不启用 PGO 时，同一份 ThinLTO 构建在 `fmt` 上的耗时是 LLVM 官方发布构建的 1.15 至 1.37 倍；启用 Linux 前端 profile 后，编译耗时降低了 16% 至 34%。
- **`x86_64` macOS runner 的波动误差**：在六类 runner 中波动最大的 `macos-15-intel` 上，23.1.2.1 未启用 PGO 的构建相对于启用 PGO 的 xclang 测得比值在 `0.84` 至 `1.12` 之间，Apple 的 `clang` 在 `fmt` 上测得 `0.89` 至 `1.08`（在 `lua` 上为 `0.57` 至 `0.87`），而在 23.1.2.6 的五台 runner 测试中，Apple 的 `clang` 在 `fmt` 上则慢了 17% 至 22%。因此，在波动误差范围之外，尚不能确定 PGO 是否对交叉编译出的 `x86_64` macOS 主机程序在 Intel Mac 上的运行有明显提升。
