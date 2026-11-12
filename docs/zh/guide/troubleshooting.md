# 常见问题排查

使用 xclang 构建与运行时的常见故障现象、原因及解决办法。

## 链接与运行

### 共享库抛出的 `std::exception` 无法被捕获

xclang 链接的每个共享库都包含一份各自独立的 libc++；而在 Linux 和 macOS 上，libc++ 按地址比较 `type_info`，因此一个共享库抛出的标准异常在另一个共享库中只能匹配 `catch (...)`（Windows 按名称比较，可以正常捕获）。请将代码链接为单个程序，或者通过 C 接口隔离各个共享库，把 C++ 类型与异常限制在共享库内部（[封闭性](../design/hermeticity.md)）。

### Bazel 测试在启动时因重复释放（double free）崩溃

当 Bazel 目标开启 `supports_dynamic_linker` 特性时，Bazel 会把测试的每个依赖库链接成独立的共享库，且各自带有一份 libc++。请从目标上移除 `supports_dynamic_linker`（xclang 模块默认已将其关闭），或避免跨这些共享库传递 C++ 对象（[Bazel 模块](../design/bazel-module.md)）。

### 未定义引用 `std::__cxx11::...` 或 `std::__1::...`

用 GCC 的 libstdc++ 或微软的 STL 编译出的 C++ 库与 xclang 的 libc++ 具有不同的 ABI（C 语言库不受影响）。请用 xclang 为同一目标平台重新编译 C++ 依赖库，或者传入 `-stdlib=platform` 改用平台的 C++ 标准库编译和链接：Linux 上是 GCC 的 libstdc++，macOS 上是 SDK 中的 `libc++.1.dylib`，MSVC 目标平台上则是微软的 STL（[直接使用 clang](../integrations/clang.md)）。

### 在旧机器上报错 `version 'GLIBC_2.34' not found`

由 xclang 链接的程序最高只需要 glibc 2.17，除非链接时混入了基于新版 glibc 编译的库，例如主机上的共享库（`-L/usr/lib/...`）或使用了 `-stdlib=platform`、`--no-default-config` 的构建产物。请只链接用 xclang 为这个目标平台编译的库，并用 `llvm-readobj --needed-libs` 和 `llvm-objdump -T` 检查二进制文件的符号版本依赖（[Linux 目标平台](../targets/linux.md)）。

### `-static-pie` 失败，或 `-pg` 无法链接

glibc 2.17 的 sysroot 没有 `-static-pie` 所需的 `rcrt1.o`，且 `-pg` 所需的 `gcrt1.o` 不是位置无关代码。在 glibc 目标平台上请改用 `-static`（或换用支持 `-static-pie` 的 musl 目标平台）；使用 `-pg` 链接时请传入 `-no-pie`（[Linux 目标平台](../targets/linux.md)）。

### 在 Windows 上 `-o hello` 生成了 `hello.exe`

输出文件名不带扩展名时，MinGW 链接会自动补上 `.exe`。请在命令行中显式写出扩展名（如 `-o hello.exe`），使构建脚本在所有主机上看到相同的输出文件名（[Windows 目标平台](../targets/windows.md)）。

### Rust：链接 Linux 目标时出现未定义的 `_Unwind_*` 符号

Rust 标准库链接时会传入 `-nodefaultlibs` 并请求 `-lgcc_s`，而后者在 xclang 的 sysroot 中是一个空库。请使用会自动将其替换为 `libunwind` 的 `xclang cargo` 构建，或在手动配置 cargo 时传入 `-Clink-arg=-l:libunwind.a`（[Rust 与 Cargo](../integrations/cargo.md)）。

### 在 Linux 上找不到 `/usr/include` 中的头文件

xclang 的目标平台配置文件会将 clang 指向内置的 glibc 2.17 sysroot 与 libc++，而非主机系统的 `/usr/include` 与 libstdc++。如需配合 lld 使用系统自带的头文件、glibc 与 libstdc++，请在每次编译和链接时传入 `-stdlib=platform`（[直接使用 clang](../integrations/clang.md)）；如需完全还原为不带默认配置的上游 clang，请传入 `--no-default-config`（[工具链结构](../design/toolchain.md)）。

## 交叉编译

### 在 Linux 上报错 `'Windows.h' file not found`，但在 Windows 上能编译

Windows 文件系统不区分大小写，而在区分大小写的 Linux 文件系统上，MinGW-w64 中的头文件名均为小写（如 `windows.h`、`basetsd.h`）。请统一使用小写文件名包含 Windows 头文件，即可在所有主机上正常编译（[Windows 目标平台](../targets/windows.md)）。

### 在 Linux 或 Windows 上报错 `no such sysroot directory: '.../sdk/macos'`

在 Linux 和 Windows 主机上，macOS 目标平台编译时依赖位于 `sdk/macos` 的 Apple SDK，而这个 SDK 不能随工具链压缩包分发。请运行一次 `xclang sdk fetch macos --accept-license` 从 Apple 下载 SDK（[macOS 目标平台](../targets/macos.md)）。同理，在非 Windows 主机上编译 MSVC 目标平台时，若缺少 Windows SDK 会报错 `'stdio.h' file not found`，运行 `xclang sdk fetch windows --accept-license` 即可解决（[Windows 目标平台](../targets/windows.md)）。

### Windows 发布构建中测试用例注册丢失

在 MinGW 目标平台上，lld 的 `--gc-sections` 会丢弃未被引用的 COMDAT 节中的静态初始化器，导致测试用例注册被裁掉。请不要对 Windows 目标平台传入 `-Wl,--gc-sections`；Bazel 模块在 Windows 上默认已关闭 `gc_sections`（[Windows 目标平台](../targets/windows.md)）。

## Sanitizer 与调试

### ASan 误报不存在的 `container-overflow`

将开启 ASan 的程序与未插桩的 `libc++.a` 链接时，libc++ 内部的容器操作没有插桩，从而引发 `container-overflow` 误报。请使用带 ASan 插桩的 libc++ 编译并链接程序的所有库（传入 `-isystem $asan/include` 与 `-nostdlib++ $asan/libc++.a`），或直接使用 Bazel 的 `--features=asan`、CMake 工具链文件的 `-DXCLANG_SANITIZER=address`（[sanitizer](../features/sanitizers.md)）。

### gdb 或 lldb 找不到 Bazel 构建的源文件

为保证不同目录下的构建可复现，Bazel 模块在编译时将调试路径设为相对于执行根目录的相对路径（`-ffile-compilation-dir=.`）。请在调试器中将 `.` 映射到工作区下的 `bazel-<workspace>` 符号链接（[Bazel](../integrations/bazel.md)）。

### ThinLTO 编译的代码在 macOS dSYM 中没有行号信息

`dsymutil` 需要从目标文件中读取 DWARF 调试信息，而开启 ThinLTO 时链接器会在链接结束时删除临时的 LTO 后端目标文件。请使用 CMake 中的 `xclang_debug_symbols` 或 Bazel 中的 `generate_dsym_file` 特性，在链接过程中直接生成 dSYM（[调试](../features/debugging.md)）。

### 解析 `clang -###` 输出的工具报错

clang 与其他 LLVM 工具打包在同一个多合一程序（`llvm`）中，因此 `clang -###` 打印 `-cc1` 任务时会把工具名放在第一个参数位置，形如 `".../llvm" "clang" "-cc1" ...`。解析 `clang -###` 输出时，请跳过可执行文件路径后面的工具名参数（[工具链结构](../design/toolchain.md)）。

## 构建速度与缓存

### 基于 libclang 的工具每次链接都要好几分钟

libclang 以 ThinLTO bitcode 形式分发，链接器在每次链接时都会把 clang 与 LLVM 库编译为机器码。请将 `XCLANG_THINLTO_CACHE` 设为一个绝对路径目录，让链接器在多次链接之间缓存未发生变化的 ThinLTO 后端目标文件（[libclang](../features/libclang.md)）。

### Linux 下 Bazel 构建中的 ThinLTO 缓存不生效

Bazel 的 Linux 沙盒只允许构建动作写入受许可的路径，并为每个动作分配独立的私有 `/tmp`，链接结束后即被丢弃。请将缓存目录放在 `/var/tmp` 下，并在 `.bazelrc` 中传入 `--sandbox_writable_path=<dir>`，使链接动作能够读写共享缓存（[libclang](../features/libclang.md)）。

### 模块接口变更后 ccache 产出了错误的程序

ccache 4.13 及更早版本不会将被导入的模块文件计入 import 它的文件的缓存键中，因此在接口变更后仍会返回变更前的旧目标文件。请升级到 ccache 4.14 或更高版本；目前所有版本的 ccache 都不会缓存模块接口本身（[C++20 模块](../features/modules.md)）。

### `C++26 was disabled in precompiled file`，或 `import std` 的其他编译选项不匹配

预编译模块文件只能被使用相同语言选项（`-std`、异常、RTTI）编译的翻译单元导入，这个错误说明编译 `std` 模块时的选项与 import 它的文件不一致。请在 CMake 中全局设置语言选项，或在 Bazel 中使用 `--cxxopt` 统一设置；也可以在 CMake 中用 `xclang_add_std` 创建一个选项匹配的 `std` 模块目标（[C++20 模块](../features/modules.md)、[CMake](../integrations/cmake.md)）。

## Windows 主机

### Bazel 因路径过长而失败

Bazel 默认将输出根目录放在用户配置目录下，容易产生超出 Windows 路径长度限制的深层路径。请将 `startup --output_user_root=C:/b` 添加到 `%USERPROFILE%\.bazelrc`（[Bazel](../integrations/bazel.md)）。
