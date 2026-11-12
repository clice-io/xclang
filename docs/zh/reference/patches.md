# LLVM 补丁

xclang 基于 LLVM 官方发布源码包 `llvm-project-<version>.src.tar.xz` 构建编译器、链接器、运行时库与 libclang，并打上了 [`patches/`](https://github.com/clice-io/xclang/tree/main/patches) 目录下的补丁。每个补丁的 README 都说明了未打补丁时的问题表现、具体修改内容、验证方式以及上游推进状态。

## 补丁列表

| 补丁 | 修改内容 |
|---|---|
| [`0001-sema-partial-ordering-depth`](https://github.com/clice-io/xclang/blob/main/patches/0001-sema-partial-ordering-depth/README.md) | 偏序关系按模板自身的嵌套深度推导：在类模板内触发代码补全不再导致 clang 崩溃（[clice#701](https://github.com/clice-io/clice/issues/701)） |
| [`0002-completion-unresolved-member-base`](https://github.com/clice-io/xclang/blob/main/patches/0002-completion-unresolved-member-base/README.md) | 当 Sema 无法解析基表达式的类类型时，成员访问代码补全仍会报告其上下文 |
| [`0003-completion-context-base-expr`](https://github.com/clice-io/xclang/blob/main/patches/0003-completion-context-base-expr/README.md) | 新增 `CodeCompletionContext::getBaseExpr`，返回源码中书写的成员访问基表达式 |
| [`0004-windows-driver-setup-api-mingw`](https://github.com/clice-io/xclang/blob/main/patches/0004-windows-driver-setup-api-mingw/README.md) | 让 MinGW 编译的 clang 与 MSVC 编译版本一样，通过 Setup API 查找 Visual Studio 2017 及更高版本（[clice#714](https://github.com/clice-io/clice/issues/714)） |
| [`0007-lld-macho-empty-section-unwind`](https://github.com/clice-io/xclang/blob/main/patches/0007-lld-macho-empty-section-unwind/README.md) | 当空节中的符号与某个函数共用同一地址时，ld64.lld 仍保留这个函数的栈展开条目：使单条 clang 命令链接的 ThinLTO 程序在 arm64 macOS 上能够正常捕获异常 |
| [`0008-preprocessed-raw-string-lines`](https://github.com/clice-io/xclang/blob/main/patches/0008-preprocessed-raw-string-lines/README.md) | `clang -E` 将原始字符串字面量中的 CRLF 换行符按其实际语义写为 `\n` 并准确统计行数：编译预处理输出时（如 xmake 等构建缓存），能够得到相同的字符串内容与行号 |
| [`0010-windows-stack-trace`](https://github.com/clice-io/xclang/blob/main/patches/0010-windows-stack-trace/README.md) | 在 arm64 Windows 上打印崩溃调用栈时，能够穿过返回地址带指针签名的系统 DLL 栈帧：在 C 标准库回调中崩溃或从信号处理函数打印调用栈时，能够回溯到触发崩溃的代码位置 |
| [`0011-clang-cl-config-pass-through`](https://github.com/clice-io/xclang/blob/main/patches/0011-clang-cl-config-pass-through/README.md) | clang-cl 不再将配置文件中的选项（包括通过 `/clang:` 透传的选项）报为未使用：使 MSVC 目标平台的 C 代码能够在开启 `/WX` 时正常编译 |
| [`0012-msvc-compiler-rt-libpath-first`](https://github.com/clice-io/xclang/blob/main/patches/0012-msvc-compiler-rt-libpath-first/README.md) | clang 链接 MSVC 目标平台时，将自身的 compiler-rt 排在 Visual Studio 的 `clang_rt.*.lib` 之前：未下载 SDK 时，`__int128` 除法、UBSan 与 libFuzzer 也能正常链接 |
| [`0013-runtime-dir-pc-vendor`](https://github.com/clice-io/xclang/blob/main/patches/0013-runtime-dir-pc-vendor/README.md) | 让 GCC 风格的写法 `--target=x86_64-pc-linux-gnu`、`x86_64-pc-windows-gnu` 以及 `arm64-linux-gnu`、`arm64-w64-mingw32` 能够在标准目录名下找到 compiler-rt 并正常链接 |
| [`0014-coff-timestamp-default`](https://github.com/clice-io/xclang/blob/main/patches/0014-coff-timestamp-default/README.md) | 恢复 LLVM 22 及 GNU 工具的行为，不在 MinGW 目标平台的 COFF 目标文件头部写入编译时间戳：相同源码编译出逐字节相同的目标文件（llvm/llvm-project#222099） |
| [`0016-libcxx-vcruntime`](https://github.com/clice-io/xclang/blob/main/patches/0016-libcxx-vcruntime/README.md) | 基于 vcruntime 构建的 libc++ 不再重复定义由 C 运行时提供的 `std::nothrow`，并自行提供原本仅在微软 STL 库中定义的 `std::set_new_handler` 与 `get_new_handler` |
| [`0017-lld-coff-call-graph-order`](https://github.com/clice-io/xclang/blob/main/patches/0017-lld-coff-call-graph-order/README.md) | lld-link 在每次链接开启 PGO 的程序时采用一致的布局：不同目标文件中的同名局部函数不再在多次链接之间发生顺序漂移 |
| [`0018-stdlib-system-config`](https://github.com/clice-io/xclang/blob/main/patches/0018-stdlib-system-config/README.md) | 当 `-stdlib=` 指定 libc++ 以外的标准库（`platform`、`libstdc++`；clang-cl 中为 `/clang:-stdlib=platform`）时，自动切换到目标平台的 `<triple>-system.cfg`：在所有目标平台上改用平台的 C++ 标准库及其 sysroot（[系统的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)） |
| [`0019-msvc-exception-copy-ctor-ast`](https://github.com/clice-io/xclang/blob/main/patches/0019-msvc-exception-copy-ctor-ast/README.md) | MSVC 目标平台上，C++20 模块或 PCH 中抛出的类型，在 import 它的文件生成的 catchable type 里保留拷贝构造函数：`std::exception_ptr` 调用它复制异常对象，而不是逐字节复制（[xclang#27](https://github.com/clice-io/xclang/issues/27)） |

## 补丁应用方式

解压 LLVM 源码后，`toolchain/common.ts` 会立即按目录顺序使用 `patch -p1 -F0 --forward` 应用每个 `patches/NNNN-name/NNNN.patch`：禁用模糊匹配（fuzz），只要补丁位置发生偏移就会直接令构建失败。每个工具链在 `libc++/src` 下随附的运行时库源码也会打上其中涉及自身文件的补丁（[从源码构建运行时库](../features/runtimes-from-source.md)）。libclang 的 `lib/cmake/xclang/libclang.cmake` 则会在 `XCLANG_PATCHES` 中记录已应用的补丁列表（[CMake API](cmake-api.md)）。

## 补丁目录结构

- 一个 `patches/NNNN-short-name/` 目录，内含一份基于 LLVM 发布标签生成的 `git diff` 补丁文件 `NNNN.patch`，以及一份 `README.md`：记录问题现象与触发场景、补丁修改内容、上游状态（`Upstream:`）、补丁来源（`From:`）以及验证方式（`Checked:`）。
- 一项在未打这个补丁时会失败的测试，位于 `tests/toolchain/smoke.ts`（在每个主机的工具链上运行）、`tests/cmake` 或 `tests/bazel` 中。
- 永不复用的补丁编号：已被上游合入的补丁会在升级到包含对应修复的 LLVM 版本时删除。
