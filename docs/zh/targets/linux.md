# Linux

xclang 在每个主机压缩包中内置了两组 Linux 目标平台：基于 glibc 2.17 的 `x86_64-unknown-linux-gnu` 与 `aarch64-unknown-linux-gnu`，以及静态链接 musl 1.2.6 的 `x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl`。两组目标平台都会使用 `ld.lld` 将 xclang 的 `libc++`、`libc++abi`、`libunwind` 和 `compiler-rt` 内置函数库（builtins）静态链接进可执行文件（[交叉编译](cross-compiling.md)）。

## glibc 目标平台

在任意主机上（或在 Linux 主机上不传 `--target` 原生编译）构建 glibc 目标平台的程序：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
```

`x86_64-pc-linux-gnu`、`x86_64-linux-gnu`、`aarch64-pc-linux-gnu`、`aarch64-linux-gnu`、`arm64-linux-gnu`、`arm64-unknown-linux-gnu` 和 `arm64-pc-linux-gnu` 使用相同的配置文件。

### glibc 2.17 sysroot

无论是本机编译还是交叉编译，都会使用 `<toolchain>/<triple>/` 下内置的 glibc 2.17 sysroot（取自 conda-forge 的 `sysroot_linux-64` 与 `sysroot_linux-aarch64` 软件包），而非宿主机上的 `/usr/include` 和 `/usr/lib`。由于 glibc 对符号做了版本管理，且链接器会选取构建 sysroot 中存在的最高符号版本，因此构建时链接的 glibc 版本就决定了产物运行时所需的最低 glibc 版本。xclang 构建出的程序可在 CentOS 7、Debian 8、Ubuntu 14.04 及之后的所有 glibc 发行版上运行，运行时只从系统加载 `libc`、`libm`、`libpthread`、`libdl`、`librt` 和动态链接器（[封闭性](../design/hermeticity.md)）。

### GCC 库名兼容

面向 GCC 编写的构建脚本无需修改即可链接。由于宽原子操作（`__atomic_*`）已内置在 `compiler-rt` 中，且栈展开库（unwinder）使用的是 `libunwind`，sysroot 中的 `-latomic`、`-lgcc`、`-lgcc_s` 和 `-lgcc_eh` 均指向空静态库，而 `clang` 驱动会将 `-lstdc++` 转换为 `libc++`（[封闭性](../design/hermeticity.md)）。

像 `rustc` 编译 `*-unknown-linux-gnu` 那样使用 `-nodefaultlibs` 链接时，空的 `libgcc_s.a` 不会提供栈展开实现；构建 Rust 项目请使用 `xclang cargo`，或手动传入 `-Clink-arg=-l:libunwind.a`（[Rust 与 Cargo](../integrations/cargo.md)）。

### `-static-pie`、`-pg` 与 `quadmath.h`

- **不支持 `-static-pie`**：glibc 2.17 没有 `rcrt1.o`。如需静态链接 glibc 程序请使用 `-static`，或改用支持 `-static-pie` 的 [musl 目标平台](#musl-targets)。
- **`-pg` 需要配合 `-no-pie`**：glibc 2.17 的 `gcrt1.o` 未编译为位置无关代码（PIC）。
- **不含 `quadmath.h`**：`libquadmath` 是 GCC 的库；不过 `__float128` 运算本身可通过 `clang` 与 `compiler-rt` 正常使用。

面向需要更高版本 glibc 特性的程序提供新版 glibc 目标平台目前在[考虑中](../design/roadmap.md#glibc-newer)。

## musl 目标平台

`x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl`（以及 `-pc-linux-musl`、`-linux-musl` 和 `arm64-*` 等写法）会将 musl 及所有运行时库静态链接进可执行文件：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=x86_64-unknown-linux-musl hello.cpp -o hello-static-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-musl hello.cpp -o hello-static-arm64
pixi run llvm-readelf --program-headers hello-static-x64
```

生成的二进制文件不含 `INTERP` 程序头与动态段（dynamic section），直接向 Linux 内核发起系统调用，可在同架构的任意 Linux 发行版上运行（无论系统是否安装 glibc）。在 Linux x64 上，一个使用 `<iostream>` 的 C++ hello world 体积为 1.17 MB（比 glibc 版本大 51 KB），剥离符号（strip）后为 826 KB（大 27 KB）。

- **带安全补丁的 musl 1.2.6**：xclang 从源码构建 musl 1.2.6，并合入了上游针对 1.2.6 安全公告发布的四个补丁（修复 `iconv` GB18030 解码器的 `CVE-2026-6042` 与修复 `qsort` 的 `CVE-2026-40200`）。musl 在编译时启用了 `-funwind-tables -fasynchronous-unwind-tables`，因此 C++ 异常可以穿过 `qsort` 与 `bsearch` 回调正常展开，调用栈回溯也能穿过 C 标准库函数。
- **Linux 6.18 UAPI 头文件**：sysroot 内置最新长期支持（LTS）内核 Linux 6.18 的 UAPI 头文件，并同 glibc sysroot 一样移除了仅大小写不同的重名 netfilter 头文件（[压缩包目录结构](../reference/layout.md)）。
- **默认 `-static`，可按需启用 `-static-pie`**：目标平台配置文件默认传入 `-static` 并生成 `ET_EXEC` 可执行文件（若在配置文件中写入 `-static-pie`，会导致 CMake 和 `rustc` 传入的 `-no-pie` 报错）。由于 musl 的 `libc.a` 已编译为位置无关代码且 sysroot 包含 `rcrt1.o`，在命令行传入 `-static-pie` 即可构建支持 ASLR 的位置无关静态可执行文件。在 Linux x64 上，对 C 与 C++ hello world 启用 `-static-pie` 会增加约 5% 的二进制体积与 2% 至 5% 的启动耗时。
- **不支持共享库**：内置 sysroot 使用 `--disable-shared` 构建，不包含 `libc.so`。内置 sysroot 不支持动态链接 musl、通过 `dlopen` 加载共享库，或为 Alpine 等 musl 发行版构建 `-shared` 共享库（如需构建动态链接的 musl 程序，请配合 `--sysroot` 使用 [`-stdlib=platform`](#the-platform-s-c-library)）。

### musl 与 glibc 的行为差异

以下是 musl 与 glibc 在运行时行为上的主要差异（性能数据测自 4 核 GitHub Linux x64 runner）：

- **多线程下的 `malloc`**：musl 的内存分配器使用一把多线程争用的锁。单线程执行 400 万次 16 至 528 字节的 `malloc` 与 `free` 耗时 0.21 s（glibc 为 0.07 s）；4 个线程同时各自执行 400 万次分配耗时 4.8 s（glibc 为 0.12 s）。若程序在多线程下频繁分配内存，建议链接自定义的内存分配器。
- **区域设置（locale）**：musl 不包含区域设置数据。它接受任意 locale 名称，但始终按 `C` locale 格式化：在 `en_US.UTF-8` 下，`printf("%'.1f", 1234567.5)` 会输出 `1234567.5`（glibc 则输出 `1,234,567.5`），`libc++` 的 `std::locale` 表现相同。
- **名称解析**：musl 直接读取 `/etc/hosts` 与 `/etc/resolv.conf` 并发起 DNS 查询。它不支持 NSS（`nsswitch.conf` 模块），因此无法解析 mDNS 的 `.local` 域名以及 LDAP 或 SSSD 的用户和组。普通 DNS 域名的 `getaddrinfo` 与本地用户的 `getpwuid` 则与 glibc 一致。

## 平台的 C++ 标准库

向所有编译和链接命令传入 `-stdlib=platform`（或 `-stdlib=libstdc++`）即可切换至 `<triple>-system.cfg`；它会保留 `-fuse-ld=lld`，同时去掉 xclang 的 `--sysroot` 与 `libc++`（[交叉编译](cross-compiling.md#the-platform-s-c-library)）：

- **在 glibc 目标平台上**：`clang` 会使用 GCC 的共享库版 `libstdc++`，以及宿主机、发行版交叉编译包（如 `g++-aarch64-linux-gnu`）或 `--sysroot` 指定目录中的 glibc。编译出的程序在运行时需要 `libstdc++.so.6`、`libgcc_s.so.1` 以及不低于构建 sysroot 版本的 glibc。
- **在 musl 目标平台上**：`clang` 会去掉 `-static` 与内置 sysroot，改用 `--sysroot` 所指定 sysroot（例如 Alpine Linux 根目录）中的头文件、C 标准库与 `libstdc++`。

## Sanitizer

glibc 目标平台支持 AddressSanitizer（附带经 ASan 插桩的 `libc++`）、ThreadSanitizer、LeakSanitizer、UndefinedBehaviorSanitizer 与 libFuzzer，并可通过[从源码构建运行时库](../features/runtimes-from-source.md)支持 MemorySanitizer；musl 目标平台支持 UBSan（[sanitizer](../features/sanitizers.md)）。

## 已知限制

- **glibc 2.17 基线限制**：不支持 `-static-pie`（请改用 `-static` 或 musl 目标平台），`-pg` 需配合 `-no-pie`，且不含 `quadmath.h`（[见上文](#glibc-targets)）。更高版本的 glibc 目标平台目前在[考虑中](../design/roadmap.md#glibc-newer)。
- **musl 目标平台仅支持静态链接**：使用内置 sysroot 时不支持 `libc.so`、`-shared` 或 `dlopen`，sanitizer 中目前仅支持 UBSan（[面向 musl 的 ASan、TSan、LSan 与 libFuzzer](../design/roadmap.md#musl-sanitizers)），且在多线程 `malloc`、locale 与 DNS 解析上遵循 musl 自身的行为（[见上文](#musl-targets)）。
- **每个共享库各自持有一份 `libc++`**：xclang 链接的每个共享库都包含各自独立的 `libc++` 副本，而在 Linux 上 `libc++` 按地址比较 `type_info`，因此一个共享库抛出的标准异常在另一个共享库中只能被 `catch (...)` 捕获（[封闭性](../design/hermeticity.md)）。
- **其他 Linux 架构**：面向 `x86`、`armv7`、`riscv64`、`ppc64le`、`s390x` 和 `loongarch64` 的 glibc 目标平台（[路线图](../design/roadmap.md#linux-architectures)）以及面向 `riscv64` 和 `armv7` 的 musl 目标平台（[路线图](../design/roadmap.md#musl-architectures)）均在考虑中。
