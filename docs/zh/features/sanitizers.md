# Sanitizer

`compiler-rt` 为各目标平台随附了相应的 sanitizer 运行时库；支持 ASan 的目标平台还配有一份供 ASan 程序链接的 ASan 版 `libc++` 构建（以下简称 *ASan `libc++`*）。MemorySanitizer 通过[从源码构建运行时库](runtimes-from-source.md)提供。glibc Linux、macOS 与 x64 MSVC 目标平台还提供了 libFuzzer。

<!-- BEGIN GENERATED: sanitizers -->

| 目标平台 | ASan | LSan | TSan | UBSan | MSan |
| --- | --- | --- | --- | --- | --- |
| `x86_64-unknown-linux-gnu` | 支持 | 支持 | 支持 | 支持 | 需从源码构建运行时库 |
| `aarch64-unknown-linux-gnu` | 支持 | 支持 | 支持 | 支持 | 需从源码构建运行时库 |
| `x86_64-w64-mingw32` | 支持 |  |  | 支持 |  |
| `aarch64-w64-mingw32` |  |  |  | 支持 |  |
| `aarch64-apple-darwin` | 支持 | 支持 | 支持 | 支持 |  |
| `x86_64-apple-darwin` | 支持 | 支持 | 支持 | 支持 |  |
| `x86_64-unknown-linux-musl` |  |  |  | 支持 |  |
| `aarch64-unknown-linux-musl` |  |  |  | 支持 |  |
| `x86_64-pc-windows-msvc` | 支持 |  |  | 支持 |  |
| `aarch64-pc-windows-msvc` |  |  |  | 支持 |  |

<!-- END GENERATED -->

各目标平台系列的具体差异见：[MinGW 目标平台](#mingw-targets)、[MSVC 目标平台](#msvc-targets)、[musl 目标平台](#musl-targets)、[MemorySanitizer](#memorysanitizer)。

## 用法

示例位于 [examples/sanitizers](https://github.com/clice-io/xclang/tree/main/examples/sanitizers)。下文的 CMake 与直接使用 `clang++` 的命令均在 Linux 或 macOS 主机上运行 `pixi install` 后进入 `pixi shell`，并在示例目录中执行。

`overflow.cpp` 在 `std::string` 已分配的容量范围内越过其末尾读取数据：

<!-- file: examples/sanitizers/overflow.cpp -->
```cpp
#include <cstdio>
#include <string>

int main(int argc, char**) {
    std::string s(40, 'x');
    s.reserve(100);
    // Past size(), within capacity(): only an instrumented libc++ annotates it.
    volatile char c = s.data()[40 + argc];
    (void)c;
    std::puts("no report");
}
```

`race.cpp` 在两个线程之间存在数据竞争（data race）：

<!-- file: examples/sanitizers/race.cpp -->
```cpp
#include <chrono>
#include <thread>

int shared;

int main() {
    std::thread t([] { shared++; });
    // The thread's write first, then the main thread's, which races with
    // it: in this order TSan reports the race every time.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    shared++;
    t.join();
}
```

`fuzz.cpp` 是一个 libFuzzer 模糊测试目标：

<!-- file: examples/sanitizers/fuzz.cpp -->
```cpp
#include <cstddef>
#include <cstdint>

#include <fuzzer/FuzzedDataProvider.h>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    FuzzedDataProvider input(data, size);
    if (input.ConsumeIntegral<char>() == 'x') {
        volatile int sum = input.ConsumeIntegral<int>();
        (void)sum;
    }
    return 0;
}
```

### CMake

使用 xclang 的工具链文件（`--toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake`）时，可传入 `-DXCLANG_SANITIZER=address`、`thread`、`undefined` 或 `leak`（或配合 `-DXCLANG_RUNTIMES=source` 传入 `memory`；见 [MemorySanitizer](#memorysanitizer)）。`XCLANG_SANITIZER` 会向构建中的每次编译和链接添加对应的 `-fsanitize=` 参数，并在设为 `address` 时自动切换到预编译的 ASan `libc++`（若设置了 `XCLANG_RUNTIMES=source`，则会从源码构建带插桩的 `libc++`）。

不使用工具链文件时，可通过 `CMAKE_CXX_FLAGS` 与 `CMAKE_EXE_LINKER_FLAGS` 传入 `-fsanitize=address` 及 ASan `libc++` 参数，其中 `asan=$(dirname "$(clang++ -print-library-module-manifest-path)")/asan`（[直接使用 Clang](#plain-clang)）：

<!-- file: examples/sanitizers/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(sanitizers LANGUAGES CXX)

add_executable(overflow overflow.cpp)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-asan -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    "-DCMAKE_CXX_FLAGS=-fsanitize=address -isystem $asan/include" \
    "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address -nostdlib++ $asan/libc++.a"
cmake --build build-asan
```

`./build-asan/overflow` 会报告 `container-overflow`。由于 `xclang::std` 使用 `CMAKE_CXX_FLAGS` 编译，使用 `import std` 的项目会以一致的 sanitizer 参数编译 `std` 模块（[C++20 模块](modules.md#cmake)）。

### Bazel

使用 `--features=asan`、`--features=tsan`、`--features=ubsan` 或 `--features=lsan` 即可在整个构建中启用对应的 sanitizer：

<!-- file: examples/sanitizers/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "overflow",
    srcs = ["overflow.cpp"],
)

cc_binary(
    name = "race",
    srcs = ["race.cpp"],
)
```

::: details MODULE.bazel 与 .bazelrc

<!-- file: examples/sanitizers/MODULE.bazel -->
```python
module(name = "sanitizers")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.3.4")
```

<!-- file: examples/sanitizers/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
```

:::

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run -c dbg --features=asan //:overflow
bazel run -c dbg --features=tsan //:race
```

第一条命令会报告 `container-overflow`，第二条命令会报告数据竞争；两者都会以 sanitizer 的非零退出码退出。

- `--features=asan` 会使每个 C++ 目标基于 ASan `libc++` 编译并链接。
- 请求目标平台不支持的 sanitizer 时，构建会在分析阶段（analysis time）立即停止，并报错指出目标平台与 sanitizer 名称。
- 在 `x86_64` Windows 目标平台上，`--features=asan` 会将 ASan 运行时 DLL 拷贝到 `bazel-bin` 下每个二进制文件旁及其 runfiles 目录中，以便 `bazel run` 与 `bazel test` 直接启动程序（[MinGW 目标平台](#mingw-targets)）。
- 加上 `--@xclang//runtimes:source` 会根据当前构建的 sanitizer 特性从源码编译 `libc++`、`libc++abi` 与 `libunwind`，并在 glibc Linux 目标平台上启用 `--features=msan` 支持（[MemorySanitizer](#memorysanitizer)、[从源码构建运行时库](runtimes-from-source.md#bazel)）。

### 直接使用 Clang

在 Linux、macOS 与 MinGW 目标平台上，ASan `libc++` 位于 `libc++.modules.json` 同级的 `asan` 目录下（在 Linux sysroot 中为 `usr/lib/asan`，在 macOS 与 MinGW 上为 `lib/asan`）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
asan=$(dirname "$(clang++ -print-library-module-manifest-path)")/asan
clang++ -fsanitize=address -g -O1 overflow.cpp -o overflow-plain
clang++ -fsanitize=address -isystem "$asan/include" -nostdlib++ "$asan/libc++.a" -g -O1 overflow.cpp -o overflow
clang++ -fsanitize=thread -g -O1 race.cpp -o race
clang++ -fsanitize=fuzzer -g -O1 fuzz.cpp -o fuzz
```

| 命令 | 输出 | 退出码 |
|---|---|---|
| `./overflow-plain` | `no report` | 0 |
| `./overflow` | `main`（`overflow.cpp:8`）处的 `ERROR: AddressSanitizer: container-overflow` | 1 |
| `./race` | `WARNING: ThreadSanitizer: data race` | 66 |
| `./fuzz -runs=1000` | `Done 1000 runs` | 0 |

`overflow-plain` 链接的是未对 `std::string` 缓冲区添加容器标记（annotation）的常规 `libc++`，因此 ASan 不会检出这次越界读取。在 macOS 上，sanitizer 报错会调用 abort 终止进程，因此 shell 报告的退出码为 `134`。

## 选项

| | 直接使用 Clang | CMake（工具链文件） | Bazel |
|---|---|---|---|
| AddressSanitizer | `-fsanitize=address` + ASan `libc++` | `-DXCLANG_SANITIZER=address` | `--features=asan` |
| ThreadSanitizer | `-fsanitize=thread` | `-DXCLANG_SANITIZER=thread` | `--features=tsan` |
| UBSan | `-fsanitize=undefined` | `-DXCLANG_SANITIZER=undefined` | `--features=ubsan` |
| LeakSanitizer | `-fsanitize=leak` | `-DXCLANG_SANITIZER=leak` | `--features=lsan` |
| libFuzzer | `-fsanitize=fuzzer` | 在编译与链接参数中传入 `-fsanitize=fuzzer` | |
| MemorySanitizer | | `-DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory` | `--@xclang//runtimes:source --features=msan` |
| ASan `libc++` 参数 | 编译：`-isystem $asan/include`；链接：`-nostdlib++ $asan/libc++.a`（MSVC 仅需编译参数） | 已包含在 `XCLANG_SANITIZER=address` 中 | 已包含在 `--features=asan` 中 |

完整选项列表见 [CMake API](../reference/cmake-api.md) 与 [Bazel API](../reference/bazel-api.md)。

## 行为说明

- **ASan 程序中的每个 C++ 库都必须使用 ASan `libc++`**：`libc++` 会对容器（`std::vector`、`std::string`）添加标记，使 ASan 知道已分配缓冲区中哪一部分在 `size()` 范围内，并将 `size()` 与 `capacity()` 之间的访问报告为 `container-overflow`。混用基于 ASan `libc++` 与未插桩 `libc++` 编译的代码会产生 `container-overflow` 误报（[见下文](#why-an-asan-libc)）。
- **其他 sanitizer 使用常规 `libc++`**：除非启用了[从源码构建运行时库](runtimes-from-source.md)，否则 TSan、UBSan 与 LSan 构建均链接标准预编译 `libc++`。
- **macOS 与 Windows 上的动态 sanitizer 运行时库**：在 macOS 上，sanitizer 运行时库是形如 `libclang_rt.asan_osx_dynamic.dylib` 的 `.dylib` 文件，从工具链的资源目录或二进制文件所在目录加载。在 Windows 上，`x86_64` ASan 运行时库是一个 DLL。由于 sanitizer 构建用于测试而非对外发布，加载这些动态运行时库属于[封闭性](../design/hermeticity.md)的例外。在 macOS 主机上的 Bazel 构建中，sanitizer 特性会将工具链的资源目录加入 `rpath`；在 Linux 或 Windows 上交叉编译出的二进制文件则会在自身所在目录中查找 `.dylib`。
- **带 ASan 插桩的 `libclang` 构建**：面向 Linux `x86_64` 与 macOS `arm64` 主机，xclang 提供了基于 ASan `libc++` 编译并开启 ASan 插桩的 `libclang` 构建（[libclang](libclang.md#the-asan-build)）。
- **不随附平台 C++ 标准库的 ASan 构建**：设置 `XCLANG_STDLIB=platform` 时，`XCLANG_SANITIZER=address` 不会链接 ASan 版 C++ 标准库；而在 MSVC 目标平台上，开启 ASan 的 STL 容器需要 `stl_asan.lib`，`xclang sdk fetch windows` 不会下载它。

### 为什么需要 ASan libc++

容器标记由实际运行的容器方法写入，并在每次访问元素时检查。当使用 `-fsanitize=address` 编译的程序链接了未插桩的 `libc++.a` 时，二进制文件中会同时存在同一容器方法的两个版本：程序中的内联函数开启了 ASan 编译并会更新容器标记，而预编译进 `libc++.a` 的函数与模板实例化则不会。

当链接器对两处都实例化的模板去重，并选中了来自 `libc++.a` 的未插桩版本时，vector 扩容便不再更新 ASan 影子内存（shadow memory），后续读取就会误报 `container-overflow`。catter 的 macOS 测试就曾因 `std::filesystem::relative` 内部的 `std::vector<std::string_view>::push_back` 遇到这一问题。

因此，xclang 在常规 `libc++` 旁额外随附了一份经 ASan 插桩的 `libc++`。它由使用 `-fsanitize=address` 编译的 `libc++.a`（在 MSVC 上为 `libc++asan-x86_64.lib`）以及定义了 `_LIBCPP_INSTRUMENTED_WITH_ASAN` 的 `__config_site` 头文件组成，同时还会开启 `std::string` 的容器标记。编译时传入 `-isystem $asan/include` 并链接 ASan `libc++`，即可使程序与标准库保持一致的插桩状态。

## MinGW 目标平台

MinGW 目标平台在 `x86_64` 与 `aarch64` 上提供 UBSan，并在 `x86_64` 上提供 ASan 与 ASan `libc++`，与 `compiler-rt` 和 `llvm-mingw` 在 Windows 上的支持范围一致。传入 `-fsanitize=` 时，`clang` 会从 `lib/clang/<major>/lib/<arch>-w64-windows-gnu` 选取运行时库。

- **ASan 运行时库是 DLL**：Windows 上没有静态 ASan 运行时库，因此 ASan 程序在链接时使用 `libclang_rt.asan_dynamic.dll.a`，并在启动时从自身所在目录或 `PATH` 加载 `libclang_rt.asan_dynamic.dll`。在 `x86_64` Windows 主机上，工具链的 `bin/` 目录下存有一份 DLL 副本，激活 `pixi` 或 `conda` 环境后会将其加入 `PATH`；在其他机器上，请将 DLL 拷贝到 `.exe` 同级目录。在 Bazel 中，`--features=asan` 会将 DLL 放在 `bazel-bin` 下每个二进制文件旁及其 runfiles 目录中。不同于 `llvm-mingw` 的 ASan DLL，xclang 将 `libc++` 与 `libunwind` 静态链接进了这个 DLL，使其仅依赖 Windows 系统 DLL 与 UCRT。
- **ASan `libc++`** 位于 `x86_64-w64-mingw32/lib/asan`（即下文的 `$asan`）：编译时传入 `-isystem $asan/include`，链接时传入 `-nostdlib++ $asan/libc++.a`，或直接使用 CMake 的 `-DXCLANG_SANITIZER=address` 与 Bazel 的 `--features=asan`。
- **仅限原生 `x86_64` Windows**：`x86_64` ASan 程序必须在 `x86_64` Windows 上运行；在 `arm64` Windows 的 `x86_64` 模拟器下，ASan 无法拦截 C 运行时库的函数。
- **不支持的 sanitizer**：`compiler-rt` 在 MinGW 上不支持 TSan、LeakSanitizer、MemorySanitizer 或 libFuzzer，在 `aarch64` Windows 上也不支持 ASan。CMake 与 Bazel 会在 MinGW 目标平台上拒绝这些 sanitizer。

`examples/sanitizers` 中的 `ubsan.cpp` 会触发有符号整数溢出：

<!-- file: examples/sanitizers/ubsan.cpp -->
```cpp
#include <climits>
#include <cstdio>

int main(int argc, char**) {
    int n = INT_MAX;
    // A signed overflow: UBSan reports it, and the program goes on.
    n += argc;
    std::printf("%d\n", n);
}
```

在任意主机上交叉编译这两个示例：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
asan=$(dirname "$(clang++ --target=x86_64-w64-mingw32 -print-library-module-manifest-path)")/asan
clang++ --target=x86_64-w64-mingw32 -fsanitize=address -isystem "$asan/include" -nostdlib++ "$asan/libc++.a" \
    -g -O1 overflow.cpp -o overflow.exe
clang++ --target=aarch64-w64-mingw32 -fsanitize=undefined -O1 ubsan.cpp -o ubsan.exe
```

在将 `libclang_rt.asan_dynamic.dll` 放在同级目录或加入 `PATH` 的 `x86_64` Windows 机器上，`overflow.exe` 会报告 `container-overflow`。在 `arm64` Windows 上，`ubsan.exe` 会报告 `runtime error: signed integer overflow` 并输出 `-2147483648`。

在 `x86_64` Windows 主机上使用 [Bazel](#bazel) 时，`--features=asan` 会将 DLL 放在可执行文件旁并直接运行它：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run -c dbg --features=asan //:overflow
```

程序会报告 `container-overflow` 并以退出码 `1` 退出。

## MSVC 目标平台

[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)在 `x86_64` 与 `aarch64` 上提供 UBSan，并在 `x86_64` 上提供 ASan 与 libFuzzer。传入 `-fsanitize=` 时，`clang` 会从 `lib/clang/<major>/lib/windows` 选取对应的库文件。

- **`x86_64` ASan `libc++`** 位于 `lib/clang/<major>/lib/windows/libc++asan-x86_64.lib`，其 `__config_site` 位于 `$XCLANG/x86_64-pc-windows-msvc/lib/asan/include`。编译时传入 `-isystem $XCLANG/x86_64-pc-windows-msvc/lib/asan/include`：其中的 `__config_site` 会在每个目标文件中嵌入 `#pragma comment(lib, "libc++asan-x86_64.lib")` 来替代 `libc++-x86_64.lib`，因此链接步骤无需额外库参数，且同样适用于混合 CRT、`/MD` 与静态 CRT。CMake 的 `-DXCLANG_SANITIZER=address` 与 Bazel 的 `--features=asan` 会自动传入这一头文件搜索路径。
- **ASan 运行时库是 DLL**（`clang_rt.asan_dynamic-x86_64.dll`），即使链接静态 CRT 也是如此。`x86_64` Windows 主机工具链在 `bin/` 下存有一份副本；在其他机器上，请将其拷贝到可执行文件同级目录（Bazel 的 `--features=asan` 会自动完成拷贝）。由于 `compiler-rt` 将这个 DLL 链接到了动态 VC 运行时，它在运行时会加载 `vcruntime140.dll`。
- **不兼容 `-stdlib=platform` 的容器**：基于微软的 STL（`-stdlib=platform`）编译时，开启 ASan 的 STL 容器会引用 `stl_asan.lib`，而 `xclang sdk fetch windows` 不会下载这个库文件。
- **不支持 `aarch64` ASan 或 libFuzzer**：LLVM 23 在 `arm64` Windows 上不支持 ASan 或 libFuzzer。

下载好 Windows SDK 后，可在任意主机上使用 [MinGW 目标平台](#mingw-targets)中的 `ubsan.cpp` 交叉编译：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-pc-windows-msvc -fsanitize=address -isystem "$XCLANG/x86_64-pc-windows-msvc/lib/asan/include" \
    -g -O1 overflow.cpp -o overflow.exe
clang++ --target=aarch64-pc-windows-msvc -fsanitize=undefined -O1 ubsan.cpp -o ubsan.exe
```

将 `clang_rt.asan_dynamic-x86_64.dll` 放在同级目录下时，`overflow.exe` 会报告 `container-overflow`；`ubsan.exe` 则会报告 `runtime error: signed integer overflow` 并输出 `-2147483648`。

## musl 目标平台

[musl 目标平台](../guide/cross-compiling.md#musl-targets)采用静态链接，而静态链接的可执行文件中只有 UBSan 可以工作：可使用其独立运行时（`-fsanitize=undefined`，CMake 中为 `-DXCLANG_SANITIZER=undefined`，Bazel 中为 `--features=ubsan`）、最小运行时（`-fsanitize-minimal-runtime`）或陷阱模式（`-fsanitize-trap=undefined`）。

ASan、TSan 与 LSan 会拦截 C 标准库函数并通过 `dlsym` 查找底层符号，而静态 musl 二进制文件没有动态符号表；将它们的运行时库链接进静态二进制文件会报错 `undefined hidden symbol: _DYNAMIC`，libFuzzer 则会在首次调用 `sigaction` 时失败。因此 xclang 未面向 musl 构建这些运行时库。如需运行 ASan、TSan、LSan 或 libFuzzer，请为同架构的 glibc 目标平台构建；面向这些工具提供动态链接的 musl 目标平台变体目前在[考虑中](../design/roadmap.md#musl-sanitizers)。

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-unknown-linux-musl -fsanitize=undefined -O1 ubsan.cpp -o ubsan
```

`ubsan` 是一个可在任意 Linux `x86_64` 机器上运行的静态可执行文件。

## MemorySanitizer

MemorySanitizer（MSan）要求程序中的每个库（包括 `libc++` 与 `libc++abi`）都使用 `-fsanitize=memory` 编译，并配合 `compiler-rt` 的 MSan 运行时库。由于预编译压缩包不含经 MSan 插桩的 `libc++` 或 MSan 运行时库，启用[从源码构建运行时库](runtimes-from-source.md)后，xclang 会在 glibc Linux 目标平台（`x86_64` 与 `aarch64`）上按需构建这两者：

- **CMake**：配合工具链文件传入 `-DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory`。
- **Bazel**：传入 `--@xclang//runtimes:source --features=msan`。

在使用 TSan 或 ASan 时启用[从源码构建运行时库](runtimes-from-source.md)，同样会从源码编译带对应 sanitizer 插桩的 `libc++` 与 `libc++abi`。
