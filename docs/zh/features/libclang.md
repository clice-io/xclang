# libclang 与选项表

面向基于 `clang` 与 LLVM 构建的工具，例如 [clice](https://github.com/clice-io/clice) 与 [catter](https://github.com/clice-io/catter)。在本文档中，*libclang* 指 `clang`、`clang-tidy` 与 LLVM 的 C++ 静态库及头文件，而非仅指 `libclang` C API。每个版本都会为全部六个主机平台发布采用与 xclang 自身的 `clang` 同一份 PGO profile 编译的 ThinLTO bitcode 版 `libclang`（配合 `XCLANG_THINLTO_CACHE` 可在几秒内完成增量链接），同时提供面向 Linux `x86_64` 与 macOS `arm64` 的带 ASan 插桩的 `libclang` 构建，以及包含 TableGen 驱动选项表的 `llvm-option-inc`。

## 用法

[examples/libclang](https://github.com/clice-io/xclang/tree/main/examples/libclang) 中的示例使用 `clang` 的 C++ 类对一行 C++ 代码执行词法分析，并输出编译器版本及已启用的压缩库：

<!-- file: examples/libclang/main.cpp -->
```cpp
// Lexes a line of C++ with libclang's own classes, and reports the
// compression the LLVM libraries were built with.
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/FileManager.h"
#include "clang/Basic/LangOptions.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Basic/Version.h"
#include "clang/Lex/Lexer.h"
#include "llvm/Support/Compression.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

int main() {
  clang::FileManager files{clang::FileSystemOptions{}};
  clang::DiagnosticOptions diagOptions;
  clang::DiagnosticsEngine diags(new clang::DiagnosticIDs, diagOptions);
  clang::SourceManager sources(diags, files);
  auto buffer = llvm::MemoryBuffer::getMemBuffer("int main() { return 42; }", "input.cpp");
  clang::FileID file = sources.createFileID(std::move(buffer));
  clang::LangOptions lang;
  lang.CPlusPlus = true;
  clang::Lexer lexer(file, sources.getBufferOrFake(file), sources, lang);
  unsigned tokens = 0;
  clang::Token token;
  do {
    lexer.LexFromRawLexer(token);
    if (token.isNot(clang::tok::eof)) ++tokens;
  } while (token.isNot(clang::tok::eof));
  llvm::outs() << clang::getClangFullVersion() << "\n"
               << "tokens " << tokens << " zlib " << llvm::compression::zlib::isAvailable()
               << " zstd " << llvm::compression::zstd::isAvailable() << "\n";
}
```

程序会输出 `clang` 版本号，随后输出 `tokens 9 zlib 1 zstd 1`。

### CMake

`libclang` 以发布压缩包（`libclang-<version>-<host>.tar.xz`）形式分发，不通过 conda 或 `FetchContent` 提供。在 `examples/libclang` 目录下，运行 `pixi install` 后进入 `pixi shell`，在 Linux `x86_64` 上下载、校验并解压与当前已安装版本一致的压缩包（[安装](../reference/releases.md#assets)页面列出了所有主机 triple；在 macOS 上请使用 `shasum -a 256 -c --ignore-missing SHA256SUMS` 校验）：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
v=$(sed -n "s/^[0-9a-f]*  libclang-\(.*\)-$h\.tar\.xz$/\1/p" SHA256SUMS)
curl -LO https://github.com/clice-io/xclang/releases/download/$v/libclang-$v-$h.tar.xz
sha256sum -c --ignore-missing SHA256SUMS
tar -xf libclang-$v-$h.tar.xz
```

将 `CMAKE_PREFIX_PATH` 指向解压后的 `libclang` 目录，即可通过 `find_package(Clang REQUIRED CONFIG)` 找到 `libclang`。在调用 `find_package(xclang)` 之前设置 `XCLANG_THINLTO_CACHE`（作为 CMake 变量或环境变量），再调用 `find_package(xclang REQUIRED CONFIG)` 即可启用 [ThinLTO 缓存](#the-thinlto-cache)：它会在配置阶段创建缓存目录，并向当前目录及其子目录中的所有链接命令添加缓存参数：

<!-- file: examples/libclang/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(tool LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

add_executable(tool main.cpp)
set_target_properties(tool PROPERTIES CXX_STANDARD 17)
target_compile_options(tool PRIVATE -fno-rtti)
target_include_directories(tool SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(tool PRIVATE clangBasic clangLex LLVMSupport)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$PWD/libclang" -DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
cmake --build build
./build/tool
```

首次链接会编译所需的 `libclang` bitcode 模块并写入 `/var/tmp/xclang-thinlto`。修改 `main.cpp` 后，重新链接会直接复用已缓存的 `libclang` 机器码，在几秒内完成：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
touch main.cpp
cmake --build build
```

### Bazel

`@libclang` 提供目标平台的 `libclang` 压缩包，`@llvm_option_inc` 提供选项表。在 `MODULE.bazel` 中从 `xclang` 模块扩展引入它们：

<!-- file: examples/libclang/MODULE.bazel -->
```python
module(name = "tool")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")

xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

`@libclang` 中的每个库目标都带有 LLVM 与 `clang` 的 CMake 包所导出的链接接口（`deps` 与 `linkopts`）：包括传递依赖库、系统库、`zlib`、`zstd`，以及 MinGW 目标平台上 CMake 默认链接的 Windows 导入库（如 `LLVMWindowsDriver` 所需的 `oleaut32` 等）。Bazel 目标只需列出自身直接使用的库：

<!-- excerpt: examples/libclang/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "tool",
    srcs = ["main.cpp"],
    copts = ["-fno-rtti"],
    deps = [
        "@libclang//:clangBasic",
        "@libclang//:clangLex",
        "@libclang//:LLVMSupport",
    ],
)
```

在项目的 `.bazelrc` 中为每个操作系统配置一个固定路径作为 ThinLTO 缓存（Linux 与 macOS 上为 `/var/tmp/xclang-thinlto`，Windows 上为 `C:/xclang-thinlto`；见[为什么每个系统使用同一固定路径](#why-one-fixed-path)）：

<!-- file: examples/libclang/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
common --enable_platform_specific_config
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
common:windows --enable_runfiles
# The linker's ThinLTO cache: one path per OS, the same on every machine.
common:linux --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:linux --sandbox_writable_path=/var/tmp/xclang-thinlto
common:macos --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:windows --repo_env=XCLANG_THINLTO_CACHE=C:/xclang-thinlto
try-import %workspace%/user.bazelrc
```

如果某台机器需要使用不同的缓存路径，可在 `user.bazelrc` 中覆盖它（使用自定义路径的链接具有不同的动作键，不会与远程缓存共用链接产物）：

```text
common:linux --repo_env=XCLANG_THINLTO_CACHE=/data/xclang-thinlto
common:linux --sandbox_writable_path=/data/xclang-thinlto
```

构建并运行工具：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:tool
```

基于 `libclang` 构建的工具会像 `clang` 自身一样，在相对于可执行文件所在目录的 `../lib/clang` 处查找 `clang` 资源目录（内含 `clang` 的内置头文件）。`xclang_resource_dir` 会将 `@libclang` 的资源目录布置到同一包内 `bin/<name>` 二进制文件对应的位置，同时作用于 `bazel-bin` 与其 runfiles 目录：

```python
load("@xclang//bazel:resource_dir.bzl", "xclang_resource_dir")

cc_binary(
    name = "bin/tool",
    srcs = ["main.cpp"],
    data = [":resource_dir"],
    deps = ["@libclang//:clangOptions"],
)

xclang_resource_dir(name = "resource_dir")
```

### 直接使用 Clang

直接使用 `clang++` 链接 ThinLTO bitcode 时，请传入目标平台链接器的 ThinLTO 缓存参数：

- **Linux 与 MinGW 目标平台**（`ld.lld`）：`-Wl,--thinlto-cache-dir=<dir>`
- **macOS 目标平台**（`ld64.lld`）：`-Wl,-cache_path_lto,<dir>`
- **MSVC 目标平台**（`lld-link`）：`-Wl,/lldltocache:<dir>`

设置 `XCLANG_THINLTO_CACHE` 后，CMake 包与 Bazel 模块传入的正是这些参数。

### 选项表

`llvm-option-inc-<version>.tar.xz` 包含预先由 TableGen 生成的 `clang`、`lld`（`ELF`、`COFF`、`MachO`、`MinGW`、`wasm`）、`llvm-lib` 与 `llvm-dlltool` 选项表，供无需链接 LLVM 即可解析编译器或链接器命令行的工具使用。每个 `.inc` 文件会对每个选项展开一次 `OPTION(...)`。`options.cpp` 统计了 `clang` 的驱动选项数量：

<!-- file: examples/libclang/options.cpp -->
```cpp
#include <cstdio>

int main() {
    int count = 0;
#define OPTION(...) ++count;
#include <llvm-options-td/clang-Driver-Options.inc>
#undef OPTION
    std::printf("clang has %d options\n", count);
}
```

在 Bazel 中，可在 `BUILD.bazel` 里直接依赖 `@llvm_option_inc`：

<!-- excerpt: examples/libclang/BUILD.bazel -->
```python
cc_binary(
    name = "options",
    srcs = ["options.cpp"],
    deps = ["@llvm_option_inc"],
)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:options
```

同一批头文件也发布为 `noarch` 的 conda 软件包 `llvm-option-inc`（安装到 `$PREFIX/include/llvm-options-td` 下）以及发布文件 `llvm-option-inc-<version>.tar.xz`（[安装](../reference/releases.md#assets)）。

## 选项

| | CMake | Bazel | 直接使用 Clang |
|---|---|---|---|
| 链接 `libclang` | 设置 `CMAKE_PREFIX_PATH=<libclang-dir>` 并调用 `find_package(Clang REQUIRED CONFIG)` | `deps = ["@libclang//:<library>"]`（`use_repo(xclang, "libclang")`） | `-I<libclang>/include`、`-L<libclang>/lib` |
| ASan 版 `libclang` | 解压 `libclang-<version>-<host>-asan.tar.xz` | `--features=asan`（自动切换 `@libclang`），或 `@libclang_asan` | 解压 `-asan` 压缩包 + [ASan `libc++`](sanitizers.md) |
| 布置 `clang` 资源目录 | 将 `<libclang>/lib/clang/<major>` 拷贝到 `bin/` 同级目录 | `xclang_resource_dir(name = ...)` | 拷贝 `<libclang>/lib/clang/<major>` |
| 选项表 | `llvm-option-inc` conda 软件包或压缩包 | `deps = ["@llvm_option_inc"]`（`use_repo(xclang, "llvm_option_inc")`） | `-I<prefix>/include` |
| 启用 ThinLTO 缓存 | 在 `find_package(xclang)` 前设置 `-DXCLANG_THINLTO_CACHE=<dir>`（或同名环境变量） | `--repo_env=XCLANG_THINLTO_CACHE=<dir>`（Linux 上还需加 `--sandbox_writable_path=<dir>`） | `-Wl,--thinlto-cache-dir=<dir>`、`-Wl,-cache_path_lto,<dir>` 或 `-Wl,/lldltocache:<dir>` |
| ThinLTO 缓存生效范围 | 调用 `find_package(xclang)` 所在目录及其子目录中的所有链接 | 通过 `thinlto_cache` 特性作用于所有链接 | 带有对应参数的链接 |
| 禁用 ThinLTO 缓存 | 不设置 `XCLANG_THINLTO_CACHE` | 不设置变量、传入 `--features=-thinlto_cache` 或设置 `features = ["-thinlto_cache"]` | 不传对应参数 |

完整选项列表见 [CMake API](../reference/cmake-api.md) 与 [Bazel API](../reference/bazel-api.md)。

## 行为说明

### 链接 libclang 的代码要求

- **使用同一版本的工具链链接**：`libclang` 是 ThinLTO bitcode，只能由相同 LLVM 版本的 `lld` 读取。首次链接会将工具用到的每个 bitcode 模块编译为机器码；后续链接则会通过 [ThinLTO 缓存](#the-thinlto-cache)直接复用这些机器码。
- **使用 `-fno-rtti` 编译**：与压缩包中的 LLVM 和 `clang` 库保持一致。
- **随附资源目录**：如果工具需要解析 C 或 C++ 代码，请将 `lib/clang/<major>` 放在相对于可执行文件所在目录的 `../lib/clang/<major>` 处（在 Bazel 中使用 `xclang_resource_dir`，或从压缩包的 `lib/clang/<major>` 拷贝）。
- **交叉编译时使用目标平台的 `libclang`**：在 Bazel 中，`@libclang` 会自动选择并仅下载与目标平台（`--platforms`）匹配的压缩包。在 CMake 中，请将 `CMAKE_PREFIX_PATH` 设为目标主机对应的 `libclang` 压缩包解压目录。
- **仅限主机平台**：六个主机平台各有对应的 `libclang`，而 musl 与 MSVC 目标平台没有；在 Bazel 中，依赖 `@libclang` 的目标会标记为与这些平台不兼容。面向 MSVC ABI 的 `libclang` [不计划](../design/roadmap.md#libclang-msvc)提供。

### 压缩包内容

`libclang-<version>-<host>.tar.xz` 包含链接对应主机 `clang` 所用的全部库，并省去了前端工具用不到的后端代码生成器：

| | 内容 |
|---|---|
| 库文件 | 以 PGO 与 ThinLTO bitcode 形式构建的 `clang` 与 LLVM 静态库及头文件 |
| CMake 包 | 供 `find_package(Clang)` 与 `find_package(LLVM)` 使用的 LLVM 和 `clang` 配置文件 |
| C++ 标准库 | 基于 xclang 的 `libc++` 编译，与工具链一致 |
| `zlib`、`zstd` | LLVM 链接的静态压缩库，可通过同一个 `CMAKE_PREFIX_PATH` 找到 |
| 资源目录 | `lib/clang/<major>`：`clang` 的内置头文件与 `compiler-rt` 头文件（`sanitizer/`、`fuzzer/` 等） |
| `clang-tidy` | 头文件与 `clang-tidy/clang-tidy-config.h`（配置时未开启静态分析器与基于查询的检查项） |
| 所有目标平台的 MC 层 | 全部 LLVM 目标平台的 `TargetInfo`、MC 描述、汇编解析器与反汇编器 |
| 不含代码生成器 | 不包含 `InitializeAllTargets()`、`InitializeAllAsmPrinters()` 与 `InitializeNativeTarget()` |
| 构建记录 | `lib/cmake/xclang/libclang.cmake`（记录 `XCLANG_LLVM_VERSION`、`XCLANG_LTO`、`XCLANG_PGO`、`XCLANG_PATCHES` 等） |

`clang` 使用 X86 MC 汇编解析器解析微软风格的 `__asm {}` 块，工具则通过 `InitializeAllTargetInfos()`、`InitializeAllTargetMCs()`、`InitializeAllAsmParsers()` 与 `InitializeAllDisassemblers()` 注册 MC 层，以便按 triple 查找目标平台（例如从 `aarch64-linux-gnu-g++` 这样的编译器名称推断目标平台）。在 CMake 中，对应的组件为 `AllTargetsInfos`、`AllTargetsDescs`、`AllTargetsAsmParsers` 与 `AllTargetsDisassemblers`；在 Bazel 中则为 `@libclang//:AllTargetsInfos`、`@libclang//:AllTargetsDescs`、`@libclang//:AllTargetsAsmParsers` 与 `@libclang//:AllTargetsDisassemblers`。

### ASan 构建版本

面向 `x86_64-unknown-linux-gnu` 与 `aarch64-apple-darwin` 主机发布的 `libclang-<version>-<host>-asan.tar.xz` 基于 [ASan `libc++`](sanitizers.md) 构建，开启了断言（assertions）与 AddressSanitizer，优化级别为 `-O1`，不启用 PGO 或 ThinLTO。它包含相同的头文件与库目标，供在 ASan 下调试工具使用。

在 Bazel 中，`@libclang_asan` 直接引用 ASan 压缩包；当命令行传入 `--features=asan` 时，`@libclang` 会自动将其库文件、头文件与资源目录切换到 ASan 构建版本（若目标平台没有 ASan 版 `libclang` 压缩包，则在分析阶段报错停止）。仅在单个 Bazel 目标上设置 `features = ["asan"]` 不会切换 `@libclang`。

### ThinLTO 缓存

- **缓存内容**：`lld` 的 ThinLTO 缓存会对影响每个 bitcode 模块代码生成的全部因素（模块自身的 bitcode、向其内联的其他模块的导入摘要，以及编译器选项）计算哈希，以此为键将编译出的机器码存入缓存目录。后续链接只需重新编译哈希发生变化的 bitcode 模块，其余模块直接从缓存读取。
- **二进制结果完全一致**：由于每个缓存条目都按其输入的精确哈希查找，开启缓存只会加快链接速度，不会改变输出的字节内容。
- **并发构建安全**：缓存条目以原子方式写入（要么写入完整文件，要么不写入），因此多个构建可以安全共用同一个缓存目录。
- **自动清理**：`lld` 最多每 20 分钟清理一次超过一周未被读取的缓存条目（LLVM 的默认策略）。在多次 CI 运行之间持久化缓存的做法见 [CI](../integrations/ci.md)。

### 为什么分发 Bitcode

基于 `clang` 构建的工具（语言服务器、静态检查工具或重构工具）绝大部分运行时间都花在 `clang` 内部：词法分析、语法分析、`Sema` 与 AST 遍历。如果将 `libclang` 作为预编译机器码分发，这些库只能各自独立优化，工具与 `clang` 之间的每次调用都要跨越不透明的库边界。

将 `libclang` 作为采用与 xclang 的 `clang` 同一份 PGO profile 编译的 ThinLTO bitcode 分发，可以让链接器对 `libclang` 与工具代码做跨模块联合优化：函数得以跨边界内联，未使用的代码会被剔除，同时保留 PGO 的冷热代码布局。

相应的代价是链接耗时：在没有缓存的情况下，每次链接时 ThinLTO 都要把工具引用的所有 bitcode 模块编译成机器码，哪怕只改了工具中的一行代码也要花上好几分钟。ThinLTO 缓存可将增量重新链接的时间缩短到几秒。

### 为什么每个系统使用同一固定路径

- **路径是链接动作键的一部分**：缓存目录通过链接器命令行传入，因此在 Bazel 中会参与链接动作缓存键的哈希计算。只有传入完全相同的目录路径时，磁盘缓存或远程缓存才会复用已缓存的链接结果。将缓存放在工作区或 `$HOME` 下会导致路径随代码检出目录和机器而变，使链接缓存无法命中。请为每个操作系统配置一个固定路径（Linux 与 macOS 上为 `/var/tmp/xclang-thinlto`，Windows 上为 `C:/xclang-thinlto`）。
- **Linux 沙盒必须允许写入**：除声明的输出文件与 `--sandbox_writable_path=<dir>` 列出的路径外，Bazel 的 Linux 沙盒会将宿主机文件系统挂载为只读。`--sandbox_writable_path` 不计入动作键，且只挂载动作启动时已存在的路径；因此 `xclang` Bazel 模块会在准备仓库时创建 `XCLANG_THINLTO_CACHE` 目录，并在目录缺失时重新创建它。
- **不要放在 `/tmp` 下**：Bazel 的 Linux 沙盒会为每个动作挂载独立的私有 `/tmp`，放在 `/tmp` 下的缓存只会写入动作的临时挂载点，链接结束即被丢弃。`/var/tmp` 在 Linux 上（配合 `--sandbox_writable_path`）可跨动作共用，在 Bazel 的 macOS 沙盒中也可直接写入；而在 Windows 上，Bazel 默认不使用沙盒运行动作。
- **无需纳入 Bazel 输入追踪也依然安全**：尽管 Bazel 不追踪 ThinLTO 缓存目录内的文件，但缓存本身由 `lld` 按内容寻址，旧条目不会污染构建结果。

### 实测数据

在 GitHub 托管 runner（4 核 Linux `x86_64`、3 核 macOS `arm64`、4 核 Windows `x86_64`）上，[clice](https://github.com/clice-io/clice) 链接 `libclang` bitcode 的耗时如下（仅统计链接动作本身的耗时，数据取自 clice `exp/bazel-lto` 分支运行记录 [37041436235](https://github.com/clice-io/clice/actions/runs/37041436235)、[37047279320](https://github.com/clice-io/clice/actions/runs/37047279320)、[37065094747](https://github.com/clice-io/clice/actions/runs/37065094747) 与 [37075525831](https://github.com/clice-io/clice/actions/runs/37075525831) 的 Bazel profile）：

| | Linux x64 | macOS arm64 | Windows x64 |
|---|---|---|---|
| 不启用缓存 | 353 s | 190 s | 400–506 s |
| 空缓存 | 357 s | 190–200 s | 492 s |
| 完整缓存，无代码改动 | 6.1–6.3 s | 4.8–5.1 s | 7.6–14 s |
| 完整缓存，修改一个源文件 | 6.2 s | 4.7–7.3 s | 14 s |
| 新 runner 恢复缓存后带改动首次链接 | 6.2 s | 15.6 s | 13.7 s |
| 缓存大小 | 352–403 MiB | 414–425 MiB | 394–660 MiB |

在全部六个主机平台上链接一个小型工具（`examples/libclang`），冷启动（不启用缓存或空缓存）耗时 7 至 20 s，热缓存（152 至 155 个缓存条目）耗时 0.6 至 1.7 s，每次运行产出的二进制文件逐字节相同。
