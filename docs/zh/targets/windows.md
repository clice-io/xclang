# Windows

xclang 提供两组 Windows 目标平台：一组是随每个工具链压缩包内置 sysroot 的 MinGW 目标平台（`x86_64-w64-mingw32` 与 `aarch64-w64-mingw32`），另一组是配合 `xclang sdk fetch windows` 下载的 Windows SDK 或本机安装的 Visual Studio 使用的 MSVC 目标平台（`x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc`）。两组目标平台均面向 Windows 10 及以上的通用 C 运行时（UCRT），默认静态链接 xclang 的 `libc++` 与 `compiler-rt`，并使用 `lld` 链接（MinGW 使用 `ld.lld`，MSVC 使用 `lld-link`）。Windows 主机工具链本身是在 Linux x64 上交叉编译出的 MinGW 程序（[交叉编译](cross-compiling.md)）。

## MinGW 目标平台

在任意主机上（或在 Windows 主机上不传 `--target` 原生编译）构建 `x86_64-w64-mingw32` 与 `aarch64-w64-mingw32` 目标平台的程序：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

`x86_64-w64-windows-gnu`、`x86_64-pc-windows-gnu`、`aarch64-w64-windows-gnu`、`aarch64-pc-windows-gnu`、`arm64-w64-mingw32`、`arm64-w64-windows-gnu` 和 `arm64-pc-windows-gnu` 使用相同的配置文件。

- **基于 UCRT 的 MinGW-w64 14.0.0**：内置 sysroot 使用 `--with-default-msvcrt=ucrt` 与 `--with-default-win32-winnt=0x0A00`（Windows 10 及以上）配置。UCRT 随 Windows 10 及更高版本系统自带，提供了 `msvcrt.dll` 所缺少的 C99 及后续标准的库函数。
- **静态链接 C++ 与运行时库**：`libc++`、`libc++abi`、`libunwind`、`winpthreads`（`libpthread.a`）和 `compiler-rt` 均静态链接进可执行文件。生成的二进制文件只加载 Windows 系统 DLL（`KERNEL32.dll` 与 `api-ms-win-crt-*`），无需随附 `libc++.dll`、`libwinpthread-1.dll` 或 `libstdc++-6.dll`（[封闭性](../design/hermeticity.md)）。
- **输出文件名**：在所有主机上，当输出文件名不带扩展名时，MinGW 链接都会自动补上 `.exe`，例如 `-o hello` 会生成 `hello.exe`。
- **GCC 兼容性**：`-latomic`、`-lgcc`、`-lgcc_s`、`-lgcc_eh`、`-lssp` 和 `-lssp_nonshared` 均指向 sysroot 中的空静态库，`-lstdc++` 会链接 `libc++`，`windres` 则对应 `llvm-windres`。
- **Rust 目标平台**：请使用 `x86_64-pc-windows-gnullvm` 与 `aarch64-pc-windows-gnullvm`，而非 `*-pc-windows-gnu`。`-gnullvm` 目标平台会链接 `libunwind` 与 UCRT，与 xclang 的 MinGW sysroot 保持一致（[Rust 与 Cargo](../integrations/cargo.md)）。
- **MinGW 下的 `-stdlib=platform`**：传入 `-stdlib=platform`（或 `-stdlib=libstdc++`）会选用 `bin/<triple>-system.cfg`，保留 `-fuse-ld=lld` 并去掉 xclang 的 sysroot 与 `libc++`。此时需传入 `--sysroot` 指向包含 `libstdc++` 的 MinGW 根目录，例如 MSYS2 的 `ucrt64`；在 Debian 与 Ubuntu 上，则可指向一个包含两个符号链接的目录：将 `x86_64-w64-mingw32` 指向 `/usr/x86_64-w64-mingw32`，并将 `lib/gcc` 指向 `/usr/lib/gcc`（若直接传入 `--sysroot=/usr`，则会引入 Linux 主机自身的 `/usr/include` 与 `/usr/lib`）。

## MSVC 目标平台

`x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc`（以及 `-unknown-windows-msvc`、`-windows-msvc` 和 `arm64-*` 等写法）面向 MSVC ABI 构建；链接由 MSVC 编译的库、重度使用 COM 的代码或 Windows 第三方厂商 SDK 时均需要 MSVC ABI。先运行一次 `xclang sdk fetch windows --accept-license` 获取微软的 CRT、STL 与 Windows SDK，即可在任意主机上使用 `clang++` 或 `clang-cl` 构建：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch windows --accept-license
clang++ -O2 --target=x86_64-pc-windows-msvc hello.cpp -o hello-msvc-x64.exe
clang-cl /O2 /EHsc hello.cpp /Fehello-cl.exe
clang-cl /O2 /EHsc --target=aarch64-pc-windows-msvc hello.cpp /Fehello-cl-arm64.exe
```

- **选择 SDK 版本**：`xclang sdk fetch windows` 默认下载 `windows-latest` 预设（`windows-2025-vs2026`，含 MSVC 14.51 与 Windows SDK 10.0.26100）。如需对应 runner 镜像的工具集（MSVC 14.44），可传入 `--preset windows-2022`，也可手动传入 `--msvc-version`、`--sdk-version` 与 `--arch x86_64,aarch64,x86`。运行 `xclang sdk use <name>` 可切换当前启用的 SDK（`<toolchain>/sdk/windows`）（[`xclang` 命令](../reference/xclang-command.md)）。
- **未下载 SDK 时**：在 Windows 主机上，`clang` 与 `clang-cl` 会像上游 `clang` 一样查找本机安装的 Visual Studio 和 Windows SDK（即使已下载 SDK，传入 `--no-default-config` 也会改用本机的 Visual Studio）。在 Linux 与 macOS 主机上，目标平台配置文件始终将 `clang` 指向 `<toolchain>/sdk/windows`，因此 `clang` 不会从 `INCLUDE`、`LIB` 环境变量或 `PATH` 中的 `cl.exe` 读取宿主机目录；编译包含 CRT 头文件的代码会立即报错停止（`'stdio.h' file not found`，传入 `-v` 可查看 `clang` 搜索的路径），而独立环境（`-ffreestanding`）编译则无需 SDK 即可工作。

### `clang-cl`

直接运行 `clang-cl` 时，它会先读取 `<host-triple>-clang-cl.cfg`，再切换到对应的 MSVC 目标 triple。xclang 将这份文件设为当前主机架构 MSVC 目标平台的 `clang-cl` 配置文件，因此无需传入 `--target`，`clang-cl` 就能直接基于下载的 SDK 为当前主机架构构建程序。

在 macOS 上，`clang-cl` 会将形如 `/Users/me/hello.cpp` 的输入路径当作 `/U` 选项解析：请把输入文件放在 `--` 之后，或使用 `/Tp` 显式指定。

在 [CMake](../integrations/cmake.md) 与 [Bazel](../integrations/bazel.md) 中，xclang 使用 GNU 风格的 `clang++` 驱动而非 `clang-cl` 来编译和链接 MSVC 目标平台。通过 `clang++` 链接每次都会读取目标平台配置文件；而 CMake 配合 `clang-cl` 时会直接调用不读取配置文件的 `lld-link`，还会要求调用 `mt.exe` 处理清单文件（由于 `llvm-mt` 依赖 `libxml2`，xclang 未包含 `mt.exe`）。

### libc++ 与微软的 STL

MSVC 目标平台默认使用 xclang 的 `libc++`（同样支持 `import std`），使所有目标平台共用同一套 C++ 标准库，并在 `std::format`、`<filesystem>` 和容器上保持一致的行为。

当需要跨接口向 MSVC 编译的库传递 C++ 类型时，可传入 `-stdlib=platform`（在 `clang-cl` 中为 `/clang:-stdlib=platform`），改用下载的 SDK 或 Visual Studio 中的微软 STL（[交叉编译](cross-compiling.md#the-platform-s-c-library)）。

与 `cl.exe` 一样，`clang` 在 MSVC 目标平台上默认采用 C++14 标准。微软的 STL 在 C++14 模式下也暴露了 `std::is_integral_v` 等部分 C++17 标准库模板，而 `libc++` 仅在 C++17 及更高版本下提供它们；如果代码用到了这些模板，请传入 `-std=c++17`（`/std:c++17`）或更高标准。

### 混合 CRT 与 C 运行时选项

默认情况下，程序会静态链接 `libc++`（或微软的 STL）以及 VC 运行时库（`libvcruntime.lib` 与 `libcmt.lib`），并将 UCRT 动态链接到 Windows 自带的 `ucrtbase.dll`（`api-ms-win-crt-*`）。微软将这种组合称为混合 CRT（hybrid CRT）：编译出的程序无需安装 `vcruntime140.dll` 或 `msvcp140.dll` 运行库安装包（[封闭性](../design/hermeticity.md)），同时又能与进程内的所有 DLL 共享同一个堆、`errno` 和 `stdio`。

无论使用 `libc++` 还是微软的 STL，都可以通过以下选项切换其他 C 运行时库：

| C 运行时库 | `clang`、`clang++` | `clang-cl` |
|---|---|---|
| 混合 CRT（默认） | （默认） | `/MT`（默认） |
| DLL 运行时（`vcruntime140.dll`，使用 STL 时还包括 `msvcp140.dll`） | `-fms-runtime-lib=dll` | `/MD` |
| 全部静态链接（含 UCRT） | `-Wl,/nodefaultlib:ucrt.lib -llibucrt` | `/link /nodefaultlib:ucrt.lib libucrt.lib` |
| 静态调试版 CRT | `-fms-runtime-lib=static_dbg -Wl,/nodefaultlib:ucrt.lib` | `/MTd /link /nodefaultlib:ucrt.lib` |

调试版 CRT 是仅供开发机使用的 Visual Studio 调试库；其中 `/MDd` 在运行时会加载只有安装 Visual Studio 才会提供的 `ucrtbased.dll`。

## Sanitizer

MinGW 与 MSVC 目标平台均在 `x86_64` 和 `aarch64` 上支持 UndefinedBehaviorSanitizer，并在 `x86_64` 上支持 AddressSanitizer（附带经 ASan 插桩的 `libc++`）；`x86_64` MSVC 目标平台还支持 libFuzzer（[sanitizer](../features/sanitizers.md)）。

## Windows SDK 与 MSVC 运行时库的工作原理

### 无需安装 Visual Studio 获取微软 SDK

`xclang sdk fetch windows` 会根据 `xclang/sdk-versions.json` 中锁定的版本，从 Visual Studio 频道清单列出的 `.vsix` 包下载 MSVC CRT 与 STL，并从 NuGet 的 `Microsoft.Windows.SDK.CPP` 包下载 Windows SDK。Visual Studio 安装程序与 `xwin` 等工具需要解包 MSI 和 CAB 文件（且 `xwin` 不提供 macOS 或 Windows on Arm 预编译程序），而 `.vsix` 与 `.nupkg` 均为 zip 压缩包，`xclang` 使用内置代码即可在所有主机上直接解压。

解压后的目录（`<toolchain>/sdk/windows-msvc<ver>-sdk<ver>`）采用与 Visual Studio 安装目录一致的 `/winsysroot` 目录结构：包含 CRT 与 STL 头文件、STL 的 `std.ixx` 与 `std.compat.ixx` 模块源码、各架构的静态与 DLL 运行时库、静态运行时库的 `.pdb` 文件（调试构建链接时会查找这些文件，缺失则会报 `LNK4099` 警告），以及 Windows SDK 的头文件与导入库（`um`、`ucrt`、`shared`、`winrt`、`cppwinrt`）。下载体积与解压后大小见 [`xclang` 命令](../reference/xclang-command.md)。

### 配置文件与目标文件指令

`clang` 配置文件不支持条件判断，一旦引用的 `@file` 不存在就会加载失败。因此 MSVC 目标平台配置文件会固定引入 `bin/<triple>-sdk.cfg`（以及 `<triple>-clang-cl-sdk.cfg`）：它在发布压缩包中为空文件，运行 `xclang sdk fetch`、`use` 和 `remove` 时会将其改写为引入 `sdk/windows` 内对应架构的配置文件。

MSVC 目标平台配置文件还会在每个编译出的目标文件中写入链接器指令：

- `--dependent-lib=clang_rt.builtins-<arch>.lib`：`clang` 与 `clang-cl` 在 MSVC 目标平台上都不会自动链接 `compiler-rt` builtins，缺少它会导致 `__int128` 除法链接失败。
- `--linker-option=/nodefaultlib:libucrt.lib` 与 `--dependent-lib=ucrt.lib`：在每个目标文件内声明混合 CRT，即使构建系统直接调用 `lld-link` 也能生效。由于 `lld-link` 按顺序读取目标文件中的指令，而目标文件会先指定 `ucrt.lib`，因此在切换到 `/MTd` 或静态 UCRT 时，需要在链接命令行上传入 `/nodefaultlib:ucrt.lib`（`/MD` 本身使用的就是 `ucrt.lib`）。
- `-D_STATIC_INLINE_UCRT_FUNCTIONS=0`：除非将 `_STATIC_INLINE_UCRT_FUNCTIONS` 设为 `0`（MSVC 19.50 默认将其设为 `1`），否则 UCRT 会将 `ctime`、`localtime` 和 `difftime` 等函数声明为 `static inline`。由于 C++ 模块无法导出具有内部链接（internal linkage）的函数，配置文件定义了 `_STATIC_INLINE_UCRT_FUNCTIONS=0`，使 `import std` 能够正常编译。

### 基于 `vcruntime` 的 `libc++`

由于新版 MSVC 工具集可以链接基于旧版构建的库，xclang 使用 `clang-cl` 基于 `windows-2022` SDK（MSVC 14.44）为两个 MSVC 架构构建 `libc++` 与 `compiler-rt`：

- **基于 `vcruntime` 构建**：`libc++` 使用微软的 `vcruntime` 作为 ABI 库，而非 `libc++abi` 与 `libunwind`；异常、RTTI 和 `operator new` 由 `vcruntime` 负责，C 标准库则由 UCRT 提供。[补丁 0016](../reference/patches.md) 为 `libc++` 提供了不依赖微软 STL 库的独立 `std::set_new_handler` 实现，并去掉了重复的 `std::nothrow` 定义。
- **一个库文件通用于所有 CRT**：`libc++` 使用 `/MT /Zl` 编译，不嵌入默认 C 运行时指令，其对 UCRT 与 `vcruntime` 的调用既可解析到静态库，也可解析到 DLL 导入库。同时它使用 `_CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS` 而非 `_CRT_STDIO_ISO_WIDE_SPECIFIERS` 构建，避免与使用微软默认宽字符 `printf` 格式说明符的目标文件一起链接时触发 `/failifmismatch` 错误。因此，同一个 `lib/clang/<major>/lib/windows/libc++-<arch>.lib` 可直接与混合 CRT、`/MT`、`/MD` 以及调试版 CRT 链接。
- **通过 `#pragma comment(lib, ...)` 自动链接**：`libc++-<arch>.lib` 与 `compiler-rt` 一起存放在 `lld-link` 会自动搜索的 `lib/clang/<major>/lib/windows/` 目录下，目标平台的 `__config_site` 则通过 `#pragma comment(lib, ...)` 声明引用它。任何包含 `libc++` 头文件的翻译单元都会自动链接 `libc++-<arch>.lib`（即使 CMake 或 MSBuild 直接调用 `lld-link` 也不例外），而 C 目标文件与启用 `-stdlib=platform` 的目标文件则不会链接它。
- **`-stdlib++-isystem` 与 `import std`**：`clang` 的 MSVC 工具链会忽略 `-stdlib=`，因此默认配置文件通过 `-stdlib++-isystem`（在 `clang-cl` 中为 `/clang:-stdlib++-isystem`，由[补丁 0011](../reference/patches.md) 消除编译 C 代码时的未使用告警）提供 `libc++` 头文件。传入 `-stdlib=platform` 会切换到不含 `-stdlib++-isystem` 的 `<triple>-system.cfg`（[补丁 0018](../reference/patches.md)），让 `clang` 查找 SDK 中的 STL 头文件。在使用 `import std` 时，由于 `clang -print-library-module-manifest-path` 只查找 `libc++.a`，CMake 包会直接从 `<target>/lib/libc++.modules.json` 与 `<target>/share/libc++/v1` 读取 `libc++` 的模块清单；启用 `-stdlib=platform` 时则会编译 STL 的 `std.ixx` 与 `std.compat.ixx`（在 `arm64` 上会先于模块包含 `<malloc.h>`，防止 `_alloca` 重复声明）。

## 启动器（Launcher）

在 Windows 上创建符号链接需要开启开发者模式或拥有管理员权限，且 Windows 的 conda 软件包不支持符号链接，因此 Windows 工具链压缩包不包含任何符号链接。取而代之的是，`bin/` 下的每个工具可执行文件（`clang.exe`、`clang++.exe`、`ld.lld.exe` 等）都是由 [`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c) 编译而成的轻量启动器，负责启动 `llvm.exe <name> <arguments>`：

- **子命令名称**：多合一程序 `llvm` 根据调用名选择具体工具，而在 Windows 上 LLVM 会在检查 `argv[0]` 之前将其替换为自身模块的文件名（`llvm.exe`）。把 `<name>` 作为第一个参数传入即可保留原本的工具名称（区分 `clang++` 与 `clang`、`ld.lld` 与通用 `lld`）。
- **关闭即终止的作业对象（job object）**：启动器通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 直接在配置了「关闭即终止」的 Windows 作业对象内创建 `llvm.exe` 进程。当构建系统超时或杀死启动器时，编译器进程会随之一起终止，不会残留占用文件句柄或工作目录的后台进程。
- **进程创建开销**：每次编译会启动两个进程而非一个。这一开销在几毫秒即可编译完的极小 C 文件上较为明显，但在 C++ 翻译单元上可以忽略不计（[PGO](../design/pgo.md)）。希望省去额外进程启动开销的构建工具可以直接调用 `llvm.exe clang++ ...`。

## `gc-sections` 与静态初始化器

在 MinGW 目标平台上，`ld.lld --gc-sections` 会丢弃没有任何符号引用的 COMDAT 节，包括用于注册内联或模板测试用例的静态初始化器（static initializer）。在 ELF 目标平台上，`.init_array` 会作为垃圾回收的根节点保留这些初始化器；而在 MinGW 上，`[[gnu::used]]` 不会生成链接器的 `/include` 指令。在 clice 中，为 MinGW 开启 `--gc-sections` 曾导致两个测试套件未被注册，Windows 单元测试数量在无报错的情况下从 1,619 降到了 1,551；而关闭它则会使剥离符号后的测试程序体积从 64 MB 增加到 82 MB。

因此，Bazel 模块在优化构建中仅对 Linux 目标平台默认启用 `gc_sections`，对 Windows 目标平台则保持关闭（若目标不依赖未引用的 COMDAT 初始化器，可通过 `--features=gc_sections` 手动开启）。在其他构建系统中，除非确认没有这类依赖，否则同样应避免为 MinGW 目标平台传入 `-Wl,--gc-sections`。

## 头文件大小写敏感问题

Windows 文件系统不区分大小写，因此 Windows 代码常写成 `#include <Windows.h>`、`<BaseTsd.h>` 或 `<WinSock2.h>`，而 MinGW-w64 的头文件名均为全小写（`windows.h`、`basetsd.h`、`winsock2.h`）。xclang 未在 MinGW sysroot 中添加混合大小写的链接；请使用全小写头文件名，以确保 MinGW 构建在区分大小写的 Linux 文件系统上也能通过。

微软自身的 CRT、STL 和 Windows SDK 头文件及导入库在内部混用了不同大小写拼写。当 `xclang sdk fetch windows` 在区分大小写的文件系统上解压 Windows SDK 时，会自动创建约 3,600 个链接（例如 `windows.h`、指向 `WinBase.h` 的 `winbase.h`、指向 `LIBCMT.lib` 的 `libcmt.lib` 等），因此现有的 Windows 代码无需修改即可直接编译。

## Visual Studio 与 `compiler-rt`

- **在 MinGW 编译的 `clang` 中查找 Visual Studio**：上游 LLVM 仅在使用 MSVC 编译时才会构建 Visual Studio Setup API 查找逻辑，导致 MinGW 编译出的 `clang` 回退到仅适用于 Visual Studio 2010 及更早版本的注册表项查找。[补丁 0004](../reference/patches.md)（`llvm/llvm-project#226794`）在 MinGW 下启用了 Setup API 查找，使 `clang` 以及 clice 等基于 `libclang` 的工具能够在 Windows 主机上找到 Visual Studio 2017 及更高版本。
- **优先使用 xclang 的 `compiler-rt`**：在未下载 SDK 的 Windows 主机上，上游 `clang` 会把 Visual Studio 的库目录排在 xclang 的 `compiler-rt` 目录之前传给 `lld-link`，导致 Visual Studio 自带的 `clang_rt.*.lib` 遮蔽了 xclang 的版本，在 Visual Studio 18（MSVC 14.51）上破坏了 `__int128` 除法、UBSan 和 libFuzzer。[补丁 0012](../reference/patches.md) 将 xclang 的 `compiler-rt` 目录排在最前面。

## 每次链接产出逐字节相同的结果

xclang 省略了 PE/COFF 链接时间戳（[补丁 0014](../reference/patches.md)），使重复链接能够生成一致的二进制文件。在大型 PGO 与 ThinLTO 链接（例如 clice 600 MB 的 `clice.exe`）中，`lld-link` 过去按函数名索引调用图 profile 排序，导致不同目标文件里的同名 `static` 函数会根据哈希表内存地址互相覆盖 profile 权重；[补丁 0017](../reference/patches.md) 改为保留首个条目，保证每次链接产出的结果逐字节相同。

## ASan 的 DLL

在 Windows 上，无论是 MinGW 还是 MSVC 目标平台，`compiler-rt` 都只构建动态链接的 AddressSanitizer 运行时库：`libclang_rt.asan_dynamic.dll` 与 `clang_rt.asan_dynamic-x86_64.dll`。作为仅供测试使用的[封闭性](../design/hermeticity.md)例外，每个带 ASan 插桩的程序在启动时都会从自身所在目录或 `PATH` 中加载这个 DLL：

- **MinGW 的 ASan DLL 静态链接 `libc++` 与 `libunwind`**：不同于 `llvm-mingw` 需要加载 `libc++.dll` 的 ASan DLL，xclang 的 ASan DLL 仅依赖 Windows 系统 DLL 与 UCRT，而程序自身则会静态链接经 ASan 插桩的 `libc++`（[sanitizer](../features/sanitizers.md)）。
- **内置于 `x86_64` Windows 主机的 `bin/` 目录**：`x86_64` Windows 工具链压缩包在 `bin/` 下同时存放了 MinGW 与 MSVC 的 ASan DLL 副本，只要工具链在 `PATH` 中，ASan 程序就能直接找到运行时库。将 ASan 程序拷贝到其他机器时，请把对应的 DLL 一并放在它旁边。
- **在 Bazel 中自动拷贝到二进制文件旁**：启用 `--features=asan` 的 Bazel 构建会从 `@bazel_tools//tools/cpp:cc_runtimes_toolchain_type` 获取这个 DLL，并由 `copy_dynamic_libraries_to_binary` 特性将其拷贝到 `bazel-bin` 下的可执行文件旁以及供 `bazel run` 和 `bazel test` 使用的 runfiles 目录中。
- **不支持在 Windows on Arm 的 `x86_64` 模拟器下运行**：`x86_64` ASan 程序在 `arm64` Windows 的 `x86_64` 模拟环境下运行时无法拦截 UCRT 函数。

## 已知限制

- **需要 Windows 10 及以上**：MinGW 与 MSVC 目标平台均使用随 Windows 10 及更高版本提供的 UCRT。[Windows 7 与 XP](../design/roadmap.md#windows-7) 支持目前在研究中，基于 `msvcrt.dll` 的 MinGW 目标平台则[不计划](../design/roadmap.md#msvcrt)支持。
- **其他 Windows 目标平台与运行时库**：32 位 [`i686-pc-windows-msvc`](../design/roadmap.md#windows-x86-msvc) 在研究中，[`i686-w64-mingw32`](../design/roadmap.md#windows-x86-mingw) 与 [`arm64ec-pc-windows-msvc`](../design/roadmap.md#arm64ec) 在考虑中，[为 MSVC 目标平台从源码构建运行时库](../design/roadmap.md#runtimes-msvc)则在计划中。
