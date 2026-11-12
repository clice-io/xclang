# 调试与调试符号

发布的二进制文件通常会剥离符号（strip），并将调试符号单独保存，用于将崩溃地址解析为函数、文件名与行号。xclang 使用每个工具链压缩包内置的工具（`llvm-gsymutil`、`dsymutil`、`llvm-symbolizer`、`llvm-dwarfdump` 与 `llvm-strip`）为所有目标平台构建调试符号：

- **GSYM**（支持除 MSVC 以外的所有目标平台）：由 `llvm-gsymutil --convert` 从 DWARF 转换而来的按地址索引的函数、内联调用栈与行号表。GSYM 文件体积约为 DWARF 的十分之一，便于在崩溃收集器中快速查询。
- **dSYM**（面向 [macOS](../guide/cross-compiling.md#macos) 目标平台）：供 Apple 工具与 `lldb` 读取的 `.dSYM` 包，可由 `dsymutil` 在任意主机上收集生成。
- **PDB**（面向 [MSVC](../guide/cross-compiling.md#msvc-targets) 目标平台）：由 `lld-link` 写出的 CodeView `.pdb` 文件（`llvm-gsymutil` 不支持读取它）。

## 用法

示例位于 [examples/debug-symbols](https://github.com/clice-io/xclang/tree/main/examples/debug-symbols)。下文的 CMake 与直接使用 `clang++` 的命令均在运行 `pixi install` 后进入 `pixi shell`，并在示例目录中执行。`tool.cpp` 禁止将 `answer` 内联，使其地址精确对应到一行源码：

<!-- file: examples/debug-symbols/tool.cpp -->
```cpp
#include <cstdio>

extern "C" [[gnu::noinline]] int answer(int x) { return x * 6 + 36; }

int main(int argc, char**) { std::printf("%d\n", answer(argc)); }
```

### CMake

`xclang_debug_symbols(<program>)` 会在每次链接 CMake 目标 `<program>` 后生成调试符号：在二进制文件旁生成 `<program>.gsym`（`llvm-gsymutil` 的告警写入 `<program>.gsym.log`），针对 macOS 目标平台还会一并生成 `<program>.dSYM`。

<!-- file: examples/debug-symbols/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(tool LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)

add_executable(tool tool.cpp)
target_compile_options(tool PRIVATE -g)
xclang_debug_symbols(tool)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/tool
```

程序会输出 `42`，其旁会生成 `build/tool.gsym`（在 macOS 目标平台上还有 `build/tool.dSYM`）。

- 向 `xclang_debug_symbols(tool ...)` 传入 `GSYM_ARGS --merged-functions`，可在相同代码折叠（ICF）合并函数体相同的函数时保留所有函数名。
- 在 macOS 目标平台上，`xclang_debug_symbols` 会指示链接器将 ThinLTO 目标文件保留在 `<build-dir>/<program>.lto` 中，以便 `dsymutil` 读取其中的 DWARF（[为什么在链接阶段生成 dSYM](#why-a-dsym-comes-from-the-link)）。
- 在 MSVC 目标平台上，只要链接带有 `-g`（`Debug` 与 `RelWithDebInfo` 默认包含；其他构建类型请同时在 `target_link_options` 中传入 `-g`），`lld-link` 就会写出 `.pdb`，而 `xclang_debug_symbols` 不执行任何操作。

### Bazel

`xclang_debug_symbols` 规则用于生成 GSYM 文件，`generate_dsym_file` 特性则会在 macOS 链接期间生成 `.dSYM` 包：

<!-- file: examples/debug-symbols/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")
load("@xclang//bazel:debug_symbols.bzl", "xclang_debug_symbols")

cc_binary(
    name = "tool",
    srcs = ["tool.cpp"],
    copts = ["-g"],
    features = ["generate_dsym_file"],
)

xclang_debug_symbols(
    name = "tool_symbols",
    binary = ":tool",
)
```

::: details MODULE.bazel 与 .bazelrc

<!-- file: examples/debug-symbols/MODULE.bazel -->
```python
module(name = "tool")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")
```

<!-- file: examples/debug-symbols/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
```

:::

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --strip=never //:tool_symbols //:tool.stripped
```

- `bazel-bin/tool.gsym` 是生成的 GSYM 文件。`llvm-gsymutil` 在主机上运行（交叉编译其他目标平台时同样如此），并传入 `--num-threads=1` 以保证重复构建产出逐字节相同的结果。其告警信息会写入 `gsym_log` 输出组中的 `tool.gsym.log`。传入 `gsymutil_args = ["--merged-functions"]` 可保留被 ICF 合并的函数的全部名称。
- 面向 macOS 目标平台的 `bazel-bin/tool.dSYM` 可在任意主机上生成，位于 `dsyms` 输出组中；传入 `--apple_generate_dsym` 可为整个构建启用 `generate_dsym_file`。
- 在 MSVC 目标平台上，`tool_symbols` 会从链接步骤的 `generate_pdb_file` 特性（对应 `pdb_file` 输出组，在 `-c dbg` 下默认开启）输出 `bazel-bin/tool.pdb`。
- `bazel-bin/tool.stripped` 是供发布使用的剥离符号后的二进制文件（[剥离符号](#strip)）。Bazel 的 `fastbuild` 模式默认会剥离调试信息，除非传入了 `--strip=never`（或 `-c dbg`）。

无需将工具链加入 `PATH`，即可通过 `@xclang//bazel:llvm-gsymutil` 运行工具链中的 `llvm-gsymutil`（由于 `bazel run` 会切换到 runfiles 目录，请为 `.gsym` 文件传入绝对路径）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run @xclang//bazel:llvm-gsymutil -- "$PWD/bazel-bin/tool.gsym"
```

传入 `--address=0x<address>` 可查询指定地址。

#### 在 gdb、lldb 与 VS Code 中调试

Bazel 构建的调试信息中的所有路径均相对于执行根目录（[调试信息中的路径](#paths-in-debug-information)）。在调试器中配置一条从 `.` 到工作区根目录下 `bazel-<workspace>` 符号链接（其中 `<workspace>` 为工作区目录名）的映射即可。这个符号链接下包含工作区自身的源码，以及对应外部仓库的 `external/<repo>`：

```text
# gdb, in ~/.gdbinit or the session
directory /path/to/workspace/bazel-workspace
# lldb, in ~/.lldbinit or the session
settings set target.source-map . /path/to/workspace/bazel-workspace
```

在 VS Code 中，CodeLLDB 通过 `launch.json` 中的 `sourceMap` 配置：

```json
"sourceMap": { ".": "${workspaceFolder}/bazel-workspace" }
```

配合 `gdb` 使用的 C/C++ 扩展则通过 `setupCommands` 配置：

```json
"setupCommands": [{ "text": "directory ${workspaceFolder}/bazel-workspace" }]
```

在 macOS 上，`lldb` 可在任意目录下读取 `.dSYM` 包。若没有 `.dSYM`，`lldb` 会相对于当前工作目录读取二进制文件调试映射表中记录的目标文件（`bazel-out/...`）；此时请在包含 `bazel-out` 符号链接的工作区根目录下启动 `lldb`。

### 直接使用 Clang

带 `-g` 编译一个 Linux `x86_64` 二进制文件，将其 DWARF 转换为 `tool.gsym`，并查询 `answer` 的地址（这些命令可在任意主机上运行）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-unknown-linux-gnu -g -O2 tool.cpp -o tool
llvm-gsymutil --convert tool --out-file tool.gsym --num-threads=1
llvm-gsymutil tool.gsym --address=0x$(llvm-nm tool | awk '$3 == "answer" { print $1 }')
```

命令会输出 `answer @ <this directory>/tool.cpp:3`。针对 macOS 目标平台，请先用 `dsymutil tool -o tool.dSYM` 生成 `.dSYM` 包，再用 `llvm-gsymutil --convert` 转换这个 `.dSYM` 包。

## 选项

| | CMake | Bazel | 直接使用 Clang |
|---|---|---|---|
| GSYM | `xclang_debug_symbols(<program>)` | `xclang_debug_symbols(name, binary)` | `llvm-gsymutil --convert <in> --out-file <out> --num-threads=1` |
| dSYM（macOS 目标平台） | 由 `xclang_debug_symbols(<program>)` 生成 | `features = ["generate_dsym_file"]`，或 `--apple_generate_dsym` | `dsymutil <bin> -o <bin>.dSYM` |
| PDB（MSVC 目标平台） | 带 `-g` 链接时写出 | `generate_pdb_file`（`-c dbg` 下默认开启），或 `xclang_debug_symbols` | `-g`（在 `clang-cl` 中为 `/Zi`） |
| 额外 `llvm-gsymutil` 参数 | `GSYM_ARGS <option>...` | `gsymutil_args = [...]` | 命令行参数 |
| `llvm-gsymutil` 日志 | `<program>.gsym.log` | 输出组 `gsym_log` | 标准输出与标准错误（stdout/stderr） |
| 调试信息参数 | `-g` | `copts = ["-g"]` 或 `-c dbg`（`fastbuild` 下需配合 `--strip=never`） | `-g` |
| 剥离符号后的二进制文件 | `llvm-strip` | `<binary>.stripped` 目标 | `llvm-strip --strip-unneeded`（ELF/COFF）或 `--strip-all`（Mach-O） |

完整选项列表见 [CMake API](../reference/cmake-api.md) 与 [Bazel API](../reference/bazel-api.md)。

## 行为说明

- **Bazel 构建在调试信息中记录相对路径**（[见下文](#paths-in-debug-information)），在不同沙盒与代码检出目录中均能产出逐字节相同的二进制文件。
- **macOS `.dSYM` 包在链接阶段收集生成**，从而将 ThinLTO 目标文件包含在内（[见下文](#why-a-dsym-comes-from-the-link)）。
- **GSYM 文件在 macOS 上由 `.dSYM` 生成**，在 Linux 与 MinGW 目标平台上则直接由二进制文件生成；`llvm-gsymutil` 可在任意主机上运行。MSVC 目标平台改为生成 `.pdb`。
- **针对不同目标文件格式采用对应的符号剥离方式**（[见下文](#strip)）。
- **生成 GSYM 需要 `-g`**：对于 `-gline-tables-only` 生成的 DWARF，LLVM 23 的 `llvm-gsymutil` 不会加载任何函数，生成的 GSYM 仅包含来自符号表的名称，没有文件名与行号信息。
- **单线程保证 GSYM 一致**：以默认线程数运行 `llvm-gsymutil --convert` 时，每次运行写出的文件布局都会有所不同（三次运行的大小在 3,043,120 至 3,053,168 字节之间波动，但查询结果一致）。传入 `--num-threads=1` 后，每次运行都会生成逐字节相同的文件，且体积缩小约 0.6%；在 4 核 runner 上转换 Ubuntu 24.04 的 `libclang-cpp.so.18`（GSYM 大小 98 MB）与 `libLLVM.so.18`（GSYM 大小 118 MB）时，单线程耗时分别为 6.0 s 与 7.8 s，4 线程耗时为 4.3 s 与 5.7 s。`xclang_debug_symbols` 会传入 `--num-threads=1`。

### 调试信息中的路径

默认情况下，编译器会在 DWARF 中记录当前工作目录的绝对路径（`DW_AT_comp_dir`），而在 macOS 上链接器还会将每个 `.o` 文件的绝对路径写入二进制文件的调试映射表（`N_OSO` stab 条目），供 `lldb` 与 `dsymutil` 查找 DWARF。这样一来，在两个不同目录或不同沙盒中构建同一份源码会产出不同的二进制文件，且其中的调试路径在其他机器上并不存在。

在 Bazel 中，xclang 的工具链会将所有调试路径与覆盖率路径设为相对于执行根目录的路径：

- **编译时传入 `-ffile-compilation-dir=.`**：`DW_AT_comp_dir` 与覆盖率映射将编译目录记录为 `.`，源文件路径则为 `pkg/file.cpp` 或 `external/<repo>/...`。
- **macOS 链接时传入 `-Wl,-oso_prefix,.`**：Mach-O 调试映射表将目标文件记录为 `bazel-out/...`。库的目标文件通过 `--start-lib` 与 `--end-lib` 直接传给链接器，而不打包成 `.a` 静态库：在静态库归档中，两个同名目标文件（例如由 `foo.cppm` 和 `foo.cpp` 编译出的 `foo.o`）在调试映射表中都会记为 `libfoo.a(foo.o)` 且 Bazel 修改时间均为 `0`，这会导致 `dsymutil` 为两者都读取归档中的第一个成员。
- **Windows 链接省略时间戳**：MinGW 链接传入 `-Wl,--no-insert-timestamp`，MSVC 链接传入 `-Wl,/Brepro`，且 MSVC PDB 记录相对于执行根目录的源文件路径。
- **工具路径保持相对路径**：`clang` 运行时带有 `-no-canonical-prefixes`。

CMake 构建在调试信息中保留了 CMake 的绝对路径；CMake 中的相对调试路径目前在[计划中](../design/roadmap.md#cmake-relative-paths)。

### 为什么在链接阶段生成 dSYM

Mach-O 可执行文件不内嵌 DWARF 节；它的调试映射表指向各个 `.o` 文件，由 `dsymutil` 从这些 `.o` 文件中读取 DWARF。在 ThinLTO 下，LTO 后端会在链接期间将 bitcode 编译为临时 `.o` 文件，并在链接返回前将它们删除。如果在常规 ThinLTO 链接结束后再运行 `dsymutil`，就会漏掉所有经 ThinLTO 编译的函数（此前 clice 的 macOS 每日构建就因此缺失了 `libclang` 的行号信息）。

因此，xclang 会保留链接阶段的 LTO 目标文件并从中生成 `.dSYM`：

- 链接时传入 `-object_path_lto <dir>` 保留 ThinLTO 后端生成的临时目标文件。在 Bazel 中，`dsymutil` 会在链接动作内部紧接着运行，并在动作结束前删除临时目录；在 CMake 中，目标文件保留在 `<build-dir>/<target>.lto` 下，由 `dsymutil` 作为构建后步骤运行。
- 链接时传入 `--keep-icf-stabs`，使被 ICF 折叠的函数在调试映射表中保留各自的 stab 条目，从而让 `llvm-gsymutil` 的 `--merged-functions` 记录所有被合并的函数名。
- `dsymutil` 使用 `--linker classic` 运行：LLVM 23 默认的 `--linker parallel`（在面向 macOS 15+ 部署目标时）生成的 DWARF 5 行号表会导致 Apple 的 `atos` 崩溃。
- 传入 `-object_path_lto` 还暴露了 `ld64.lld` 的一个缺陷：在 `arm64` 上，空的 `ltmp0` 目标文件会覆盖 `main` 的 `__unwind_info` 条目；这一问题已由[补丁 0007](../reference/patches.md) 修复（[macOS](../design/macos.md#why-ld64-lld-and-patch-0007)）。

### 剥离符号

Bazel 的 `<name>.stripped` 目标（以及手动剥离符号时使用的 `llvm-strip`）会根据二进制文件的目标文件格式采用对应的剥离方式：

- **ELF 与 COFF**：使用 `--strip-unneeded`，移除调试节以及重定位不需要的符号。
- **Mach-O**：使用 `--strip-all`（与 Apple 的 `strip` 行为一致），移除所有无需由 `dyld` 绑定的符号，包括全局函数名。

在 macOS 上，`dladdr` 会将调用栈中的地址解析为排在它前面最近的一个符号。如果剥离符号后的二进制文件仍保留全局函数符号或导出的弱函数符号，崩溃日志就会把已剥离的局部函数内部的崩溃归因到排在它前面的导出符号上。虽然 `--strip-all` 会移除局部符号与未导出的全局符号，但它仍会保留供 `dyld` 合并（coalescing）的导出符号，包括弱符号形式的 C++ 模板实例化与内联函数（在 clice 剥离符号后的二进制文件中有 1,844 个此类符号）。因此，Bazel 中的优化版 macOS 构建默认开启 `no_exported_symbols` 特性，传入 `-Wl,-no_exported_symbols` 使可执行文件不导出任何符号；这样 `<name>.stripped` 不会保留任何函数符号，崩溃日志会直接记录原始地址，再由 `.dSYM` 或 `.gsym` 精确完成符号化。如果可执行文件需要加载绑定其自身符号的插件，可在对应的 `cc_binary` 上设置 `features = ["-no_exported_symbols"]` 关闭这一特性。如需向 `llvm-strip` 传入额外参数，请使用 `--stripopt`。
