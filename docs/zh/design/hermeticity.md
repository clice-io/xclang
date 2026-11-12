# 封闭性

xclang 对所有目标平台遵循同一条原则：

> 编译出的程序在运行时只依赖目标操作系统必定自带且不允许二次分发的系统库，其余所有依赖均静态链接进二进制文件中；在构建时，来自工具链外部的唯一输入是厂商 SDK。

所有内置目标平台以及[路线图](roadmap.md#targets)上的每个目标平台均遵循这一原则。编译出的二进制文件作为单个文件即可在满足目标操作系统最低版本要求的任意机器上直接运行，无需安装 C++ 运行时软件包，也无需随附运行时 DLL。

在构建时，来自工具链外部的唯一输入是不允许二次分发的厂商 SDK（[厂商 SDK](../guide/cross-compiling.md#vendor-sdks)）：

- **macOS 目标平台**：在 macOS 主机上，`clang` 基于本机 Xcode 或 Command Line Tools 的 SDK（`xcrun`）构建，xclang 不锁定它的版本。在 Linux 与 Windows 主机上，`xclang sdk fetch macos` 会下载按版本、`sha256` 与内容摘要双重锁定的 Apple SDK（[macOS](macos.md#apple-s-sdk-without-xcode)）。
- **Windows MSVC 目标平台**：`xclang sdk fetch windows` 会下载按版本与 `sha256` 锁定的微软 CRT、STL 与 Windows SDK（[Windows](windows.md#the-sdk-without-visual-studio)）。在未下载 SDK 的 Windows 主机上，`clang` 会回退使用本机安装的 Visual Studio，xclang 不锁定其版本。

## 程序在运行时加载的库

| 目标平台 | 运行时从系统加载 | 静态链接 |
|---|---|---|
| Linux（glibc） | glibc 2.17 及以上：`libc`、`libm`、`libpthread`、`libdl`、`librt` 与动态加载器 | `libc++`、`libc++abi`、`libunwind`、`compiler-rt` builtins |
| Linux（musl） | 无：仅发起 Linux 内核系统调用 | `musl`、`libc++`、`libc++abi`、`libunwind`、`compiler-rt` builtins |
| macOS | `libSystem`（含 C 标准库与栈展开库）及程序所链接的系统 framework | `libc++`、`libc++abi`、`compiler-rt` builtins |
| Windows（MinGW） | Windows 10 及更高版本自带的系统 DLL（`kernel32.dll` 等）与 UCRT（`api-ms-win-crt-*`） | `libc++`、`libc++abi`、`libunwind`、`compiler-rt` builtins、`winpthreads`、`mingw-w64` 运行时 |
| Windows（MSVC） | 与 MinGW 相同，加载 Windows 系统 DLL 与 UCRT（`ucrtbase.dll`） | `libc++`（或微软的 STL）、微软的 VC 运行时（[混合 CRT](windows.md#the-hybrid-crt)）、`compiler-rt` builtins |

中间一列的库无法静态链接进程序，也不能随程序分发：glibc 的动态加载器与 `libc` 共同构成宿主机系统的底层 ABI，`libSystem` 是 macOS 内核唯一受支持的调用接口，而 UCRT 与系统 DLL 则是 Windows 10 及更高版本的操作系统组件。最右一列的所有库均可链接进二进制文件，xclang 默认将它们全部静态链接。

工具链自身的可执行程序也遵循同一规则：在包括 macOS 在内的所有主机上，`clang`、`lld`、LLVM 二进制工具与 `xclang` 均静态链接 xclang 自身的 `libc++`，不会加载 `/usr/lib/libc++.1.dylib`。

唯一的例外是仅供测试使用的动态 sanitizer 运行时库（[sanitizer](../features/sanitizers.md)）。在 macOS 上，sanitizer 运行时库是从工具链或可执行文件所在目录加载的 `.dylib` 文件（[sanitizer 的 dylib](macos.md#the-sanitizers-dylibs)）；在 `x86_64` Windows（MinGW 与 MSVC）上，AddressSanitizer 运行时库是从可执行文件所在目录或 `PATH` 加载的 DLL（[ASan 的 DLL](windows.md#asan-s-dll)）。启用 sanitizer 的构建用于测试，而非对外发布。

## 为什么不使用共享运行时库

大多数工具链默认动态链接共享的 `libc++` 或 `libstdc++`，这会把三项成本转嫁到程序部署阶段：

- **目标机器必须安装对应的运行时库。** 在 Linux 上，操作系统默认不预装 `libc++.so.1`，动态链接它的程序必须额外安装系统软件包、通过 `DT_RUNPATH` 随附库文件副本，或运行在容器中。在 Windows 上，每个可执行文件旁都必须随附 `libc++.dll`、`libunwind.dll` 与 `libwinpthread-1.dll`（或 `vcruntime140.dll` 与 `msvcp140.dll`）。
- **实际运行的库版本取决于目标机器，而非构建环境。** 从操作系统加载的共享库版本取决于目标机器上安装了什么版本，未必是编译和测试程序时使用的版本。在 macOS 上，动态链接 `/usr/lib/libc++.1.dylib` 还会使可用的 C++ 标准库特性受限于目标系统的 macOS 版本，而非取决于工具链版本（[macOS](macos.md#why-xclang-s-libc-and-not-the-system-s)）。
- **构建环境会渗透到产物中。** conda-forge 的编译器会链接 `libcxx` 与 `libstdcxx` conda 软件包，并通过 `run_exports` 将它们记录为产物的运行时依赖。在安装了这些包的 conda 环境内，程序可以正常运行；但一旦脱离 conda 环境，编译出的二进制文件就会因缺少共享库而无法在用户机器上运行。由于 xclang 将运行时库静态链接进每个二进制文件且不使用 `run_exports`，它不用于构建 conda-forge 软件包（[路线图](roadmap.md#conda-forge)）。

静态链接运行时库的代价是二进制文件体积增大（每个可执行文件都包含自身用到的那部分 `libc++` 代码），以及每个共享库内部各自持有一份独立的 `libc++`。

## 每个共享库各自持有一份 libc++

`libc++`、`libc++abi` 与 `libunwind` 均构建为具有隐藏符号可见性（`LIBCXX_HERMETIC_STATIC_LIBRARY=ON`、`LIBCXXABI_HERMETIC_STATIC_LIBRARY=ON`、`LIBUNWIND_HIDE_SYMBOLS=ON`）的位置无关静态库（`CMAKE_POSITION_INDEPENDENT_CODE=ON`）。由 xclang 链接的每个可执行文件和每个共享库（`-shared`）都包含各自私有的一份 `libc++`，不会向其他共享库导出任何符号（[路线图中的共享运行时库说明](roadmap.md#shared-runtime)）。

当应用程序加载多个以这种方式链接的共享库时，需要注意与 [Android NDK 文档](https://developer.android.com/ndk/guides/cpp-support)中静态 `libc++` 相同的限制：

- **C++ 对象与内存分配不得跨越共享库边界。** 在一个共享库中构造 `std::string` 或 `std::vector`，再到另一个共享库中析构或扩容，会混用两份运行时库实例的状态。在某个共享库中分配的内存必须在同一个共享库中释放。
- **跨共享库的异常与 RTTI。** 每份运行时库各自拥有一套 `std::exception` 及其他标准类型的 `std::type_info` 实例。在 Linux 与 macOS 上，`libc++` 按地址比较 `type_info`，因此一个共享库抛出的标准异常在另一个共享库中只能被 `catch (...)` 捕获，而无法被 `catch (const std::exception&)` 捕获。如果在所有平台上都改为按名称字符串比较 `type_info`，不仅每次类型不匹配时都要付出字符串比较开销，还会把不同匿名命名空间中的同名类型误判为同一类型，因此 xclang 保留了上游 `libc++` 的默认行为。在 Windows 上，`type_info` 按名称比较，只要调用双方使用同一种 ABI，即可跨 DLL 正常捕获异常。
- **`libc++` 的全局状态按共享库隔离**：包括 `std::cout` 的缓冲区、`std::locale::global`、`std::set_new_handler` 与 `std::set_terminate`。

将所有 C++ 库静态链接进单个可执行文件的程序不会遇到这些问题，这也是 [Bazel 模块默认静态链接依赖库](bazel-module.md#static-by-default)的原因。跨越共享库或插件边界时，请暴露 C 接口。

## 为什么选择 glibc 2.17

glibc 对符号做了版本管理，链接器会将每个符号绑定到构建时 sysroot 的 `libc.so.6` 中存在的最高版本。因此，Linux 二进制文件只能在链接时所用版本或更高版本的 glibc 上运行，无法在更早的 glibc 版本上运行。

xclang 的 Linux sysroot 包含 glibc 2.17 的头文件、启动目标文件与桩库（通过 conda-forge 的 `sysroot_linux-64` 与 `sysroot_linux-aarch64` 2.17 软件包取自 CentOS 7），与 conda-forge 以及 [Rust 官方 Linux 目标平台](https://github.com/rust-lang/rust/blob/main/src/ci/docker/host-x86_64/dist-x86_64-linux/Dockerfile)采用的最低基线一致。glibc 2.17 缺失的特性（`-static-pie`、PIE 下的 `-pg` 以及 `quadmath.h`）见[交叉编译](../guide/cross-compiling.md#glibc-2-17-floor-static-pie-and-pg)，更高版本的 glibc 目标平台目前在[考虑中](roadmap.md#glibc-newer)。由于 glibc 2.17 早于 glibc 2.18 引入的 `__cxa_thread_atexit_impl`，`libc++abi` 使用 `LIBCXXABI_HAS_CXA_THREAD_ATEXIT_IMPL=OFF` 构建，以弱符号形式引用这个函数，并在 glibc 2.17 上回退使用自带的 `thread_local` 析构函数列表。

`toolchain/sysroot.ts` 对 glibc 2.17 sysroot 做了两项调整，使其适用于所有主机和链接模式：

- **`-static` 链接。** glibc 2.17 的 `libpthread.a` 是单个目标文件，重定义了 `libc.a` 中的 `__libc_sigaction` 与取消点（cancellation point）。由于 `libunwind` 的依赖库记录会在 `libc.a` 之后引入 `libpthread.a`，导致 `-static` 链接因重复符号报错失败。为此，sysroot 将 `libc.a` 重命名为 `libglibc.a`，并把 `libc.a` 替换为链接器脚本 `GROUP ( /usr/lib64/libpthread.a /usr/lib64/libglibc.a )`，使两个静态库按正确的顺序一并搜索并顺利完成链接。
- **无符号链接与大小写冲突。** 在 Windows 上创建符号链接需要管理员权限或开启开发者模式，且 Windows 的 conda 软件包不支持符号链接。因此在 Linux sysroot 中，目录符号链接（`lib -> lib64`）直接在链接器脚本内展开并移除，soname 链接（`libc.so.6 -> libc-2.17.so`）直接替换为目标文件本身，开发期 `.so` 链接（如 `libm.so`）则改写为与 glibc 自身的 `libc.so` 类似的 `INPUT ( ... )` 链接器脚本。对于文件名仅大小写不同的 netfilter 头文件（如并存的 `xt_DSCP.h` 与 `xt_dscp.h`），只保留全小写文件，确保所有压缩包都能在不区分大小写的文件系统上正常解压。

## GCC 库名兼容

面向 GCC 编写的构建脚本常在链接命令行中直接指定 GCC 的运行时库：宽原子操作使用 `-latomic`，栈展开库使用 `-lgcc_s` 与 `-lgcc_eh`，编译器内置函数使用 `-lgcc`，MinGW 上的栈保护使用 `-lssp`。在 xclang 中，这些函数分别由 `compiler-rt`、`libunwind` 与 `mingw-w64` 提供。为此，Linux、musl 与 MinGW 的 sysroot 均以这些名称提供了空静态库桩文件（`!<arch>\n`），使面向 GCC 的链接命令无需修改即可通过：

- **`-latomic`**：针对宽度超出无锁原子操作范围的类型（如结构体，或未启用 `cx16` 时的 `__int128`），其 `__atomic_*` 函数已直接编译进 `compiler-rt` builtins 中（`COMPILER_RT_EXCLUDE_ATOMIC_BUILTIN=OFF`）。
- **`-lgcc`, `-lgcc_s`, `-lgcc_eh`**：编译器辅助函数与栈展开分别由 `compiler-rt` 和 `libunwind` 提供。由于 `libgcc_s.a` 与 `libgcc_eh.a` 是空静态库，像 `rustc` 编译 `*-unknown-linux-gnu` 那样传入 `-nodefaultlibs` 链接时，若不额外传入 `-l:libunwind.a` 就不会链接栈展开库；`xclang cargo` 会自动处理这一替换（[Rust 与 Cargo](../integrations/cargo.md#what-xclang-cargo-sets)，将 `libgcc_s.a` 改为链接器脚本目前在[考虑中](roadmap.md#libgcc-s-script)）。
- **`-lssp`, `-lssp_nonshared`**：启用 `-fstack-protector` 时，`clang` 的 MinGW 驱动会自动添加这两个库，其函数实际由 `mingw-w64` 中的 `libmingwex.a` 提供。
- **`-lstdc++`**：无需提供桩库，因为除非传入了 `-nostdlib`、`-nodefaultlibs` 或 `-nostdlib++`，否则 `clang` 驱动会自动将 `-lstdc++` 替换为 `-lc++`。
- **`windres`**：在 `bin/` 下链接到 `llvm-windres`，这是 CMake 的 MinGW 平台模块在编译 `.rc` 资源文件时查找的工具名。

## 使用 musl 构建静态程序

与 glibc 不同，musl 从设计上就支持静态链接。`x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl` 目标平台会将 musl 1.2.6（使用 `--disable-shared` 并开启异步栈展开表编译）、`libc++`、`libc++abi`、`libunwind` 与 `compiler-rt` 一并静态链接为不含程序解释器（`PT_INTERP`）和动态段的静态可执行文件，连 C 标准库也不再作为运行时外部依赖。

静态 musl 二进制文件的取舍如下：

- **二进制文件体积**：在 Linux x64 上，编译一个使用 `iostream` 的 C++ hello-world 程序时，静态链接 musl 在剥离符号前仅增加 51 KB（1.17 MB 对比 1.12 MB），剥离符号后仅增加 27 KB（826 KB 对比 799 KB）。
- **不支持共享库与动态 sanitizer**：内置 sysroot 不含 `libc.so`，因此不支持调用 `dlopen` 或构建 `-shared` 共享库，且可用的 sanitizer 只有 UBSan（[sanitizer](../features/sanitizers.md#musl-targets)）。
- **与 glibc 的运行时行为差异**：多线程下的内存分配器锁争用、固定按 `C` locale 格式化，以及不经由 NSS 直接发起 DNS 查询等差异见[交叉编译](../guide/cross-compiling.md#musl-targets)。

## 平台的 C++ 标准库

如果程序需要跨接口向使用平台的 C++ 标准库构建的库（例如 Linux 发行版的 `libstdc++` 软件包、使用 `/usr/lib/libc++.1.dylib` 的 macOS 库，或使用 MSVC STL 编译的 Windows 库）传递 C++ 标准库类型，就必须使用相同的 C++ 标准库与 ABI。传入 `-stdlib=platform` 会切换到 `bin/<triple>-system.cfg`，主动退出封闭性规则（[工具链结构](toolchain.md#the-platform-s-c-library)）；具体用法以及生成的二进制文件在各目标平台上运行时加载的库见[交叉编译](../guide/cross-compiling.md#the-platform-s-c-library)。
