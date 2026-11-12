# C++20 模块与 `import std`

xclang 支持在 CMake、Bazel 以及直接使用 `clang++` 时为主机或任意交叉编译目标构建 C++20 具名模块（named modules）与标准库模块（`import std` 和 `import std.compat`），且无需开启 CMake 的实验性开关。每个模块接口都会编译为一个预编译*模块文件*（BMI，在 `clang` 中为 `.pcm`），供所有 import 它的文件读取。

## 用法

[examples/modules](https://github.com/clice-io/xclang/tree/main/examples/modules) 中的示例定义了一个包含分区 `math:ops` 的模块 `math`，以及一个同时 import `math` 与 `std` 的可执行程序。下文的 CMake 与直接使用 `clang++` 的命令均在运行 `pixi install` 后进入 `pixi shell`，并在示例目录中执行；这会把 xclang 的 `bin/` 排在 `PATH` 最前面。

`math-ops.cppm` 是模块分区：

<!-- file: examples/modules/math-ops.cppm -->
```cpp
export module math:ops;

import std;

export int perimeter(std::span<const int> sides) {
    return std::accumulate(sides.begin(), sides.end(), 0);
}
```

`math.cppm` 是主模块接口（primary module interface），负责重新导出 `:ops`：

<!-- file: examples/modules/math.cppm -->
```cpp
export module math;

export import :ops;
import std;

export std::string describe(std::string_view name, std::span<const int> sides) {
    return std::format("{}: {} sides, perimeter {}", name, sides.size(), perimeter(sides));
}
```

`main.cpp` 同时 import 这两个模块：

<!-- file: examples/modules/main.cpp -->
```cpp
import std;
import math;

int main() {
    std::vector<int> triangle{3, 4, 5};
    std::println("{}", describe("triangle", triangle));
}
```

下文的每种构建方式都会生成输出如下内容的程序：

<!-- file: examples/modules/expected.txt -->
```
triangle: 3 sides, perimeter 12
```

### CMake

`xclang::std` 是包含 `libc++` 的 `std` 与 `std.compat` 模块的静态库，由编译器针对当前目标平台的模块清单（module manifest）中列出的模块源码编译而成。链接 `xclang::std` 即可使用 `import std` 与 `import std.compat`，项目自身的模块接口则列在 `FILE_SET CXX_MODULES` 中。`cmake_minimum_required(VERSION 3.28)` 会为 C++20 及更高版本的目标启用 `clang-scan-deps` 模块依赖扫描（`CMP0155`）：

<!-- file: examples/modules/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(shapes LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(xclang REQUIRED CONFIG)

add_library(math STATIC)
target_sources(math PUBLIC FILE_SET CXX_MODULES FILES math.cppm math-ops.cppm)
target_link_libraries(math PUBLIC xclang::std)

add_executable(shapes main.cpp)
target_link_libraries(shapes PRIVATE math xclang::std)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++
cmake --build build
./build/shapes
```

由于 `clang` 会拒绝与 import 它的文件采用不同语言选项编译出的模块文件（[行为说明](#behavior)）：

- `xclang::std` 使用调用 `find_package(xclang)` 所在目录的设置编译，这些设置会在对应目录的 `CMakeLists.txt` 末尾求值，包括 `CMAKE_CXX_STANDARD`、`CMAKE_CXX_EXTENSIONS`、`CMAKE_CXX_FLAGS` 和 `add_compile_options()`。请在整个项目层面统一设置语言选项，不要单独设置在某个 CMake 目标上。
- `xclang::std` 默认按 C++23 编译（若所在目录的 `CMAKE_CXX_STANDARD` 为 20 或更高，则采用对应的标准），并要求所有 import 它的目标使用相同的语言标准。
- 如果某个目标需要使用不同的语言选项，可用 `xclang_add_std(<name>)` 创建一个独立的 `std` 模块目标，并为其加上 `PUBLIC` 编译选项，使这个 `std` 库及所有 import 它的目标共用同一组选项：

  <!-- excerpt: tests/cmake/noexcept/CMakeLists.txt -->
  ```cmake
  xclang_add_std(std_noexcept)
  target_compile_options(std_noexcept PUBLIC -fno-exceptions)
  ```

交叉编译其他目标平台时，传入工具链文件与 `XCLANG_TARGET`（[CMake](../integrations/cmake.md)），`xclang::std` 也会随之针对目标平台构建：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
cmake -G Ninja -B build-x86_64-w64-mingw32 --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

### Bazel

`@xclang//bazel:std` 提供 `std` 与 `std.compat` 模块。将库的模块接口列在 `module_interfaces` 中，并在每个编译或 import C++20 模块的目标上启用 `features = ["cpp_modules"]`：

<!-- file: examples/modules/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")
load("@rules_cc//cc:cc_library.bzl", "cc_library")

cc_library(
    name = "math",
    features = ["cpp_modules"],
    module_interfaces = [
        "math.cppm",
        "math-ops.cppm",
    ],
    deps = ["@xclang//bazel:std"],
)

cc_binary(
    name = "shapes",
    srcs = ["main.cpp"],
    features = ["cpp_modules"],
    deps = [
        ":math",
        "@xclang//bazel:std",
    ],
)
```

::: details MODULE.bazel 与 .bazelrc

<!-- file: examples/modules/MODULE.bazel -->
```python
module(name = "shapes")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")
```

`.bazelrc` 配置了 registry（[Bazel](../integrations/bazel.md)）、`--experimental_cpp_modules`，以及由 `@xclang//bazel:std` 和所有 import 它的目标共用的 `--cxxopt` 参数：

<!-- file: examples/modules/.bazelrc -->
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

:::

`@xclang//bazel:std` 使用当前构建的 `--cxxopt` 编译。由于 `clang` 要求模块文件与 import 它的文件使用一致的语言选项（[行为说明](#behavior)），请将 `-std=c++23`、`-fno-exceptions` 和 `-fno-rtti` 等语言参数放在 `--cxxopt` 中，不要写在单个目标的 `copts` 里。

在主机上直接运行程序，或传入 `--platforms` 交叉编译（此处编译为 Windows x64 目标，输出 `bazel-bin/shapes.exe`）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:shapes
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:shapes
```

### 直接使用 Clang

每个模块接口在单步编译中会同时生成目标文件与 `.pcm` 模块文件（`-fmodule-output=<file>.pcm`）。传入 `-fprebuilt-module-path=.`，让 import 它们的文件能够找到 `std.pcm`、`math.pcm` 以及对应分区 `math:ops` 的 `math-ops.pcm`：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
std=$(dirname "$(clang++ -print-library-module-manifest-path)")/../share/libc++/v1/std.cppm
clang++ -std=c++23 -O2 -Wno-reserved-module-identifier -c "$std" -fmodule-output=std.pcm -o std.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c math-ops.cppm -fmodule-output=math-ops.pcm -o math-ops.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c math.cppm -fmodule-output=math.pcm -o math.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c main.cpp -o main.o
clang++ main.o math.o math-ops.o std.o -o shapes
./shapes
```

`clang++ -print-library-module-manifest-path` 会打印 `libc++.modules.json` 的路径，其中将 `std` 的 `source-path` 记录为 `../share/libc++/v1/std.cppm`。交叉编译其他目标平台时，向包括清单查询在内的每条命令都加上 `--target=<target>` 即可。由于 `clang` 在打印清单路径时查找的是 `libc++.a`，它在 MSVC 目标平台（库文件名为 `libc++-<arch>.lib`）上不会输出路径；这些目标平台的模块源码位于 `$XCLANG/<target>/share/libc++/v1/std.cppm`（[压缩包目录结构](../reference/layout.md)）。

## 选项

| | CMake | Bazel | 直接使用 Clang |
|---|---|---|---|
| `import std` 与 `import std.compat` | `target_link_libraries(<target> PRIVATE xclang::std)` | `deps = ["@xclang//bazel:std"]` | 使用 `-fmodule-output=` 编译 `std.cppm` 与 `std.compat.cppm` |
| 库的 C++20 模块 | `target_sources(<lib> PUBLIC FILE_SET CXX_MODULES FILES ...)` | `module_interfaces = [...]`、`features = ["cpp_modules"]` | `-fmodule-output=<name>.pcm`、`-fprebuilt-module-path=<dir>` |
| `std` 的语言选项 | 调用 `find_package(xclang)` 所在目录的选项 | 构建的 `--cxxopt` | 编译 `std.cppm` 时传入的参数 |
| 带自定义选项的额外 `std` 目标 | `xclang_add_std(<name>)` | | |
| 要求 | CMake 3.28+、Ninja 1.11+，使用 `Ninja` 或 `Ninja Multi-Config` 生成器 | Bazel 9、`rules_cc` 0.2.25+、`--experimental_cpp_modules` | |

完整选项列表见 [CMake API](../reference/cmake-api.md) 与 [Bazel API](../reference/bazel-api.md)。

## 行为说明

- **依赖扫描**：import 模块的源文件必须在所 import 模块的 `.pcm` 文件生成之后编译。CMake 与 Bazel 会运行 `clang-scan-deps`，按 P1689 格式写出每个源文件的模块依赖关系。
- **语言选项必须一致**：如果 `.pcm` 与 import 它的文件在编译时使用了不同的语言选项（包括 `-std`、GNU 扩展、`-fno-exceptions`、`-fno-rtti` 等改变语言语义的参数），`clang` 会拒绝使用这个模块文件。宏定义（`-D`）、头文件搜索路径与优化级别则可以不同。若在使用 `-std=c++26` 编译的目标中 import 按 C++23 编译的 `std` 模块，编译会报错 `C++26 was disabled in precompiled file`。
- **`std` 随每次构建编译**：由于预编译的 `.pcm` 只能供采用相同语言选项编译的文件 import，xclang 以源码形式附带 `std.cppm` 与 `std.compat.cppm`，并在每次构建内部将它们编译为静态库目标。启用[从源码构建运行时库](runtimes-from-source.md)时，`xclang::std` 与 `@xclang//bazel:std` 会基于对应的运行时库变体编译。
- **无需实验性 CMake 开关**：CMake 内置的 `import std` 受 `CMAKE_EXPERIMENTAL_CXX_IMPORT_STD` 控制，其 UUID 会随 CMake 版本更新而变化。`xclang::std` 则是一个带有 `CXX_MODULES` 文件集的普通 `STATIC` 库，只需 CMake 3.28 的模块支持即可工作。
- **Bazel 中模块文件内嵌源码**：模块文件会内嵌其源文件（通过默认开启的 `modules_embed_all_files` 特性）。带 `-g` 编译且 import 它的文件需要读取这些源码，而在沙盒中只有模块文件、没有模块源文件本身。
- **不支持头文件单元**：CMake 与 Bazel 均不支持构建头文件单元（header unit，`import <vector>;`）。

### 构建缓存与模块

如果编译缓存只根据源文件、编译器命令行和 `#include` 的头文件计算键，就会漏掉所 import 的 `.pcm` 文件。命令行只按路径指定模块文件（在 CMake 中位于 `@<source>.modmap` 响应文件内）。如果缓存不对 `.pcm` 文件的内容计算哈希，当被 import 的模块接口发生变化后，缓存就会返回过期的目标文件。

xclang 的 CI 在两个 `ccache` 版本下对模块接口及 import 它的文件（`-fmodule-output=a.pcm`，以及 `@b.modmap` 内的 `-fmodule-file=a=a.pcm`）连续运行三次 CMake 编译命令：首次构建、直接重新构建，以及将导出的常量从 `1` 改为 `2` 后重新构建：

| | 模块接口 | import 它的文件（未改动） | import 它的文件（接口改动后） |
|---|---|---|---|
| ccache 4.13.6 | 不缓存（`unsupported_source_language`） | 命中缓存 | **命中缓存：返回过期目标文件，程序返回 1** |
| ccache 4.14.1 | 不缓存 | 命中缓存 | 未命中缓存，重新编译：程序返回 2 |

使用 `ccache` 4.13 及更早版本时，C++20 模块构建可能会在无提示的情况下链接过期的代码。使用 `ccache` 4.14 及更高版本时，一旦 `.pcm` 文件发生变化，import 它的文件的缓存就会失效，不过模块接口本身仍不会被缓存。

Bazel 的动作缓存（action cache）会对动作声明的每个输入计算哈希，其中包括被读取的 `.pcm` 文件。修改模块接口会生成新的 `.pcm`，并使 import 它的目标缓存失效。由于 xclang 的 Bazel 工具链传入了 `-fmodule-file-home-is-cwd`，`.pcm` 文件记录的是相对于执行根目录（execution root）的路径，可通过远程缓存或磁盘缓存在不同代码检出目录和机器之间共用。

## 平台说明

启用 `-stdlib=platform`（在 CMake 中为 `-DXCLANG_STDLIB=platform`，在 Bazel 中为 `--@xclang//bazel:stdlib=platform`）时，`xclang::std` 与 `@xclang//bazel:std` 会使用平台的 C++ 标准库模块源码，而非 xclang 的 `libc++`（[交叉编译](../guide/cross-compiling.md#the-platform-s-c-library)）：

- **MSVC 目标平台**：`xclang::std` 与 `@xclang//bazel:std` 会编译微软 STL 的模块源码（取自已下载的 Windows SDK 或 Visual Studio 中的 `std.ixx` 与 `std.compat.ixx`；在 `arm64` 上会先于模块包含 `<malloc.h>`，防止 `_alloca` 重复声明）。
- **Linux 与 MinGW 目标平台**：在 CMake 中，如果系统 C++ 标准库带有模块清单（例如 GCC 15 的 `libstdc++`），`xclang::std` 会使用 `clang++ -stdlib=platform -print-library-module-manifest-path` 报告的模块清单；若没有模块清单，`find_package(xclang)` 会报错停止。Bazel 模块则在这些目标平台上拒绝 `-stdlib=platform`，因为它们的标准库来自工具链外部的 sysroot。
- **macOS 目标平台**：Apple 的 macOS SDK 未随附其 `libc++` 的模块清单或模块源码，因此在 `-stdlib=platform` 下无法使用 `import std`（CMake 中 `find_package(xclang)` 会报错失败，Bazel 中 `@xclang//bazel:std` 会标记为不兼容）。
