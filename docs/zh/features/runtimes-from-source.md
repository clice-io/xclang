# 从源码构建 C++ 运行时库

xclang 的预编译 C++ 运行时库为每个目标平台提供了一套固定配置的 `libc++`、`libc++abi` 与 `libunwind`：未启用加固（hardening）模式、采用 ABI 版本 1、开启异常与 RTTI，且除预编译的 ASan `libc++` 外不含其他 sanitizer 插桩（[sanitizer](sanitizers.md)）。CMake 或 Bazel 构建也可以改用每个工具链压缩包内置的源码（`libc++/src`），按自身的配置选项编译运行时库，并将程序链接到这个变体。当构建有以下需求时，可从源码构建运行时库：

- **MemorySanitizer**：要求程序中的每个库（包括 `libc++` 与 `libc++abi`）都使用 `-fsanitize=memory` 插桩，并配合 `compiler-rt` 的 MSan 运行时库。从源码构建时，ThreadSanitizer 与 AddressSanitizer 同样会对 `libc++` 和 `libc++abi` 插桩。
- **`libc++` 加固模式**（`fast`、`extensive`、`debug`）：不仅在头文件中启用检查，也在编译出的库代码内部启用检查。
- **ABI 选项**：`libc++` ABI 版本 2、有界迭代器（bounded iterators）或自定义内联 ABI 命名空间。
- **在 `libc++` 与 `libc++abi` 中禁用异常或禁用 RTTI**。
- **将 `libc++` 与程序一起执行 ThinLTO**（CMake）。

默认仍使用预编译运行时库。除 MSVC 目标平台外，其余所有目标平台均支持从源码构建运行时库。

## 用法

### CMake

配合 xclang 的工具链文件传入 `-DXCLANG_RUNTIMES=source`，以及所需的 `libc++` 或 sanitizer 选项：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_LIBCXX_HARDENING=fast
cmake --build build
```

首次配置会将运行时库变体构建到 `build/xclang-runtimes/<target>-<digest>` 中（4 核下约需半分钟）；后续配置会直接复用它，修改选项则会在旁边创建另一个变体目录（跨构建树共用时可指定 `XCLANG_RUNTIMES_DIR`）。构建中的每次编译和链接都会使用这个变体，包括 CMake 的编译器检测与 `xclang::std`。

构建 MemorySanitizer 版本时，会在编译 `libc++` 之前先编译 `compiler-rt` 的 MSan 运行时库：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-msan --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory -DCMAKE_BUILD_TYPE=RelWithDebInfo
```

`XCLANG_SANITIZER`（`address`、`memory`、`thread`、`undefined`、`leak`）会向整个构建添加 `-fsanitize=<sanitizer>` 并选取匹配的运行时库，因此项目自身的参数无需再加 `-fsanitize=`。在使用预编译运行时库所支持的 sanitizer 时，`XCLANG_SANITIZER` 同样可以直接配合预编译运行时库工作：`address` 会链接预编译的 ASan `libc++`（[sanitizer](sanitizers.md#cmake)），而在 `x86_64` Windows 上程序会从自身所在目录或 `PATH` 加载 ASan DLL（[MinGW 目标平台](sanitizers.md#mingw-targets)）。

如需为其他目标平台交叉编译运行时库变体，配合同一个工具链文件加上 `-DXCLANG_TARGET=<target>` 即可。

### Bazel

[examples/runtimes](https://github.com/clice-io/xclang/tree/main/examples/runtimes) 中的示例使用从源码构建的运行时库测试 `libc++`：

<!-- file: examples/runtimes/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_test.bzl", "cc_test")

cc_test(
    name = "words_test",
    srcs = ["words_test.cpp"],
)
```

::: details words_test.cpp 与 MODULE.bazel

<!-- file: examples/runtimes/words_test.cpp -->
```cpp
#include <cstdio>
#include <map>
#include <sstream>
#include <string>

int main() {
    std::istringstream text("the runtimes from source are the runtimes of the build");
    std::map<std::string, int> counts;
    for (std::string word; text >> word;) ++counts[word];
    std::string report;
    for (const auto& [word, n] : counts) report += word + " " + std::to_string(n) + "\n";
    // MemorySanitizer checks what printf reads: libc++ wrote it, so libc++
    // must be instrumented too.
    std::printf("%s", report.c_str());
    return counts["runtimes"] == 2 ? 0 : 1;
}
```

<!-- file: examples/runtimes/MODULE.bazel -->
```python
module(name = "runtimes")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.11")
```

:::

使用 `@xclang//runtimes` 下的参数配置构建所用的运行时库变体：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --@xclang//runtimes:source --@xclang//runtimes:hardening=fast //...
```

将 `--@xclang//runtimes:source` 与 `--features=msan`（面向 glibc Linux 目标平台）、`asan`、`tsan`、`ubsan` 或 `lsan` 组合使用，即可按当前构建的 sanitizer 对 `libc++` 与 `libc++abi` 插桩：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel test --@xclang//runtimes:source --features=msan //...
```

在 Bazel 中，运行时库是工具链仓库内部的 `cc_library` 目标，会按当前构建的 sanitizer 特性与 `--copt` 参数针对目标平台编译，并像普通目标一样缓存在 Bazel 的动作缓存中。可以在 `.bazelrc` 中为项目常用的变体定义具名配置：

```text
build:msan --@xclang//runtimes:source --features=msan
build:hardened --@xclang//runtimes:source --@xclang//runtimes:hardening=extensive
```

## 选项

| | CMake（工具链文件） | Bazel |
|---|---|---|
| 从源码构建运行时库 | `XCLANG_RUNTIMES=source` | `--@xclang//runtimes:source` |
| `libc++` 加固模式：`none`、`fast`、`extensive`、`debug` | `XCLANG_LIBCXX_HARDENING` | `--@xclang//runtimes:hardening` |
| `libc++` ABI 版本：`1` 或 `2` | `XCLANG_LIBCXX_ABI_VERSION` | `--@xclang//runtimes:abi_version` |
| `libc++` 内联 ABI 命名空间（`__<name>`） | `XCLANG_LIBCXX_ABI_NAMESPACE` | `--@xclang//runtimes:abi_namespace` |
| `libc++` ABI 宏（`_LIBCPP_ABI_*`） | `XCLANG_LIBCXX_ABI_DEFINES`（分号分隔） | `--@xclang//runtimes:abi_defines`（逗号分隔） |
| 禁用异常的 `libc++` 与 `libc++abi` | `XCLANG_RUNTIMES_EXCEPTIONS=OFF` | `--@xclang//runtimes:exceptions=false` |
| 禁用 RTTI（同时禁用异常）的 `libc++` | `XCLANG_RUNTIMES_RTTI=OFF` | `--@xclang//runtimes:rtti=false` |
| Sanitizer：`address`、`memory`、`thread`、`undefined`、`leak` | `XCLANG_SANITIZER` | `--features=asan`、`msan`、`tsan`、`ubsan`、`lsan` |
| `libc++` 与 `libc++abi` 的额外编译参数 | `XCLANG_RUNTIMES_FLAGS` | 构建的 `--copt` |
| 将 `libc++` 与程序一起执行 ThinLTO | `XCLANG_RUNTIMES_FLAGS=-flto=thin` | 不支持 |
| 传给 LLVM 运行时库构建的额外 CMake 参数 | `XCLANG_RUNTIMES_CMAKE_ARGS` | |
| 存放运行时库变体的目录 | `XCLANG_RUNTIMES_DIR` | Bazel 的 output base 与动作缓存 |

运行时库选项用于配置 `libc++` 与 `libc++abi`；同时请在项目自身的编译参数（`CMAKE_CXX_FLAGS`、`--copt` 或 `--cxxopt`）中传入一致的语言参数（如 `-fno-exceptions` 或 `-fno-rtti`）。完整选项列表见 [CMake API](../reference/cmake-api.md) 与 [Bazel API](../reference/bazel-api.md)。

## 行为说明

- **与预编译运行时库采用相同的构建配置**：CMake 使用构建 xclang 预编译运行时库时的同一套 CMake 缓存变量与目标平台配置文件来构建 LLVM 的 `runtimes/` 目录。在默认选项下，它会生成相同的 `__config_site` 与库代码。Bazel 则使用由 `packages/bazel/runtimes.ts` 从 LLVM 的 CMake 构建中提取出的相同目标平台参数编译同一批源文件。
- **构建产物**：`libc++`（其中 `libc++abi` 已合并进 `libc++.a`）、`libc++experimental.a`，以及 `libunwind.a`（macOS 除外，macOS 使用 `libSystem` 展开栈）。启用 MemorySanitizer 时，还会一并构建 `compiler-rt` 的 MSan 运行时库（`libclang_rt.msan.a` 与 `libclang_rt.msan_cxx.a`）。
- **替换预编译运行时库**：变体的 `__config_site` 目录在头文件搜索路径中排在 `libc++` 共用头文件之前，链接时则会传入 `-nostdlib++` 并链接变体的库文件，替代预编译版本。`import std`（`xclang::std` 与 `@xclang//bazel:std`）也会基于这个变体编译。
- **`libunwind` 保持不插桩**：启用 sanitizer 时，`libunwind` 与预编译 ASan `libc++` 中的配置一样不加 sanitizer 插桩；这是因为 sanitizer 运行时库需要调用它回溯调用栈，若对其插桩，MemorySanitizer 会在栈展开读取未初始化寄存器时报错。
- **MemorySanitizer 面向 glibc Linux 目标平台**（`x86_64` 与 `aarch64`）。其运行时库通过 `--whole-archive` 与 `--export-dynamic` 链接进可执行文件，与 `clang` 链接预编译 sanitizer 运行时库的方式一致。
- **程序中的每个库都必须使用同一变体**：如果程序使用了不同的 ABI 命名空间、ABI 版本、ABI 宏集合或启用了 MemorySanitizer，将基于预编译运行时库编译的库链接进去会导致链接失败或运行时行为异常。
- **Bazel 中仅作用于目标平台配置**：构建期间执行的主机工具（`cfg = "exec"`）始终使用预编译的主机运行时库构建，不受 `@xclang//runtimes:*` 设置影响。运行时库遵循整个构建的 sanitizer 特性（如 `--features=asan`），而非单个 Bazel 目标上设置的 `features` 属性。
- **主机环境要求**：CMake 的运行时库构建会运行 LLVM 的 CMake 脚本，要求主机安装 Python 3；Bazel 则不需要额外的主机工具。
- **不支持 MSVC 目标平台**：CMake 与 Bazel 会在这些目标平台上拒绝从源码构建运行时库（[计划中](../design/roadmap.md#runtimes-msvc)）。
- **只使用一套 C++ 标准库**：`-stdlib=platform`（`XCLANG_STDLIB=platform`、`--@xclang//bazel:stdlib=platform`）使用的是平台的 C++ 标准库，而从源码构建运行时库构建的是 `libc++`；一次构建只能二选一。
- **Bazel 中不对运行时库执行 LTO**：`--features=thin_lto` 会将程序链接到已编译为机器码的运行时库，因为 Bazel 只对 `deps` 中的库运行 ThinLTO 后端，不会处理由工具链链接的库（[考虑中](../design/roadmap.md#runtimes-bazel-lto)）。

### 内置源码

每个工具链压缩包都在 `libc++/include` 同级的 `libc++/src` 目录下附带了一份供所有目标平台共用的运行时库源码：包含 `llvm-project` 的 `runtimes/`、`cmake/`、`llvm/cmake/`、`libcxx/`、`libcxxabi/`、`libunwind/`、`compiler-rt/`，以及 `libc++` 所引用的内部 `libc` 头文件，剔除了测试与文档，并已打上 xclang 的 `libc++` [补丁](../reference/patches.md)。这些源码解压后占 35 MB（在每个压缩包中占 2.3 MB）。
