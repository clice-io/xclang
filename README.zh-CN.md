# xclang

[English](README.md)

一个自包含的 clang 工具链。一个目录里装着编译器、链接器、二进制工具，以及它支持的每个目标平台的 sysroot 和运行库，交叉编译只需要一个 `--target`：

```sh
xclang/bin/clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

不用 `--sysroot`，不用 `-L`，也不用装 SDK：clang 针对这个目标会读取 `bin/aarch64-w64-mingw32.cfg`，它把 clang 指向 `xclang/aarch64-w64-mingw32/`，链接的是专为这个目标编译的 libc++、libunwind 和 compiler-rt。可以理解为用原版 clang 做的 `zig cc`。

## 适合谁

想要一套可以锁定版本、随项目分发、可复现的工具链，并且希望编出来的程序拷到哪都能跑的人：

- **默认密封（hermetic）。** libc++、libc++abi、libunwind 和 builtins 都是静态链接的，产物只依赖操作系统本身。
- **每个部分都能单独使用。** sysroot 和运行库都是普通目录，按 clang 驱动期望的方式排布。任何 clang 用 `--sysroot` / `-resource-dir` 指过去就能交叉编译。
- **快。** clang 和 lld 用 PGO 和 ThinLTO 构建，并且在每个主机平台上（包括 macOS）都静态链接 xclang 自己的 libc++，从不使用系统的 libc++.dylib。
- **小。** clang、lld 和大部分工具是同一个程序 `llvm`，其它名字都是启动它；否则每个工具都要各自带一整份 LLVM。

它不是用来构建 conda-forge 包的编译器。conda-forge 自己的 `clang`/`gcc` 动态链接打包好的运行库，并接入 `run_exports`；xclang 有意两样都不做。

## 发布内容

- **工具链**，每个主机平台一个包，80 到 120 MB：clang、lld、LLVM 二进制工具（`llvm-ar`、`llvm-nm`、`llvm-objcopy`、`llvm-rc`、`llvm-profdata` 等），以及给 lit 测试用的 FileCheck。启用了 LLVM 的全部目标平台。不含 clang-tools-extra，也不含 clang-format。
- **libclang**，每个主机平台一个包：clang 和 LLVM 的静态库及头文件，给 clice 这类基于 clang 的工具用。它们就是该平台 clang 链接时用的那些库，出自同一次构建，只去掉了工具用不到的部分。这些库是 PGO 和 ThinLTO 的 bitcode，所以需要同一版本的 lld 来链接。旁边另附一个带断言的 ASan 版本，用于调试。
- **选项表**（`llvm-option-inc`）：clang、lld、llvm-lib 和 llvm-dlltool 的选项表，由同一次构建里的 TableGen 生成，给 catter 这类不链接 LLVM、但要解析这些命令行的工具用。
- **PGO profile**：构建这次发布所用的 profile。

版本标签是 `<llvm 版本>.<修订号>`，例如 LLVM 23.1.2 的第一次构建是 `23.1.2.1`，conda 能正确排序。已发布的内容永不替换，重新构建就用下一个修订号。

## 主机平台与目标平台

| 主机平台 | 在哪构建 |
|---|---|
| `x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu` | Linux x64（arm64 交叉编译） |
| `aarch64-apple-darwin`、`x86_64-apple-darwin` | macOS arm64（x64 交叉编译） |
| `x86_64-w64-mingw32`、`aarch64-w64-mingw32` | Linux x64 交叉编译；Windows 版工具链本身是 mingw 程序 |

每个主机平台的工具链都带着全部目标平台的目录：

| 目标平台 | sysroot 里的 C 运行库 | C++ 运行库 |
|---|---|---|
| Linux x64、arm64 | glibc 2.17 的头文件和启动文件 | libc++、libc++abi、libunwind |
| Windows x64、arm64 | mingw-w64（UCRT）、winpthreads | libc++、libc++abi、libunwind |
| macOS arm64、x64 | 无：Apple 的 SDK 不能再分发，使用 Xcode 自带的 | libc++、libc++abi，静态链接，不用系统的 |

为 Linux 编的程序能在 glibc 2.17 及以上运行，为 macOS 编的能在 13.0 及以上运行；工具链自身的要求相同。

libc++ 的 hardening 模式是 `none`。这个模式是按编译单元生效的宏，调试构建可以用 `-D_LIBCPP_HARDENING_MODE=...` 自行打开。

## 目录结构

```
xclang/
  bin/                     llvm 及其各个名字（clang、clang++、ld.lld、lld-link、
                           llvm-ar、windres 等），不在 llvm 里的工具（llvm-profdata、
                           llvm-cov、llvm-dwarfdump、llvm-strings、FileCheck），
                           <triple>.cfg
  lib/clang/<ver>/         resource 头文件，各目标平台的 compiler-rt
  lib/libLTO.dylib         macOS 主机：给系统 ld 做 LTO 用
  <triple>/                每个目标平台一个目录：它的 sysroot，libc++ 也在里面
                           （Linux：usr/include、usr/lib，glibc 在 lib64 和
                           usr/lib64；Windows 和 macOS：include/、lib/）
```

配置文件对本机构建同样生效，所以在 Linux 上直接 `clang++ main.cpp`，用的是 glibc 2.17 的头文件，除 glibc 外全部静态链接。`--no-default-config` 得到不带配置的裸编译器，用来针对系统自己的头文件和库构建。

compiler-rt 包含 builtins（包括无法无锁实现的宽原子操作所需的 `__atomic_*` 函数）、profile 运行库，Linux 和 macOS 目标上还有 AddressSanitizer、ThreadSanitizer、LeakSanitizer、UBSan 和 libFuzzer。zlib 和 zstd 静态链接进工具链：每个主机平台上 `-gz=zlib`、`-gz=zstd` 和压缩的 profile 都能用。

照着 GCC 写的构建脚本照样能用：`-latomic`、`-lgcc`、`-lgcc_eh`、`-lgcc_s`（Windows 上还有 `-fstack-protector` 会要求的 `-lssp`）都能找到空的静态库，实际函数在 compiler-rt、libunwind 和 mingw-w64 里；`-lstdc++` 会被当作 libc++。`-static` 可以链接出完全静态的 Linux 程序。`windres` 是 CMake 编译 MinGW 项目 `.rc` 文件时找的名字，它就是 `llvm-windres`。

Linux sysroot 里只放编译和链接要读的东西（头文件、启动文件、库），不含 glibc 的程序、locale 和 gconv 模块，也没有符号链接：soname 链接直接换成文件本身，`libfoo.so` 链接换成指向它的链接脚本，和 glibc 自己的 `libc.so` 一样。另外去掉了 8 个只差大小写的 netfilter 头文件（比如和 `xt_dscp.h` 并存的 `xt_DSCP.h`），这样 sysroot 在 Windows 和 macOS 上也能正常解包。

macOS 上的链接器是系统的 `ld`，LTO 用 xclang 自带的 `libLTO.dylib`，和 Apple 自己的工具链做法一样：LLVM 23.1.2 里 ld64.lld 的 ThinLTO 在 arm64 上会丢失异常处理（用它编的程序接不住自己抛出的异常）。ld64.lld 仍然在，用 `-fuse-ld=lld` 可以选它。

所有包都是 `.tar.xz`，Windows 的包里完全没有符号链接，所以解包不需要额外权限，也能打成 conda 包：`llvm.exe` 的各个名字（`clang++.exe`、`ld.lld.exe` 等）是一个小程序（`windows/alias.c`），它以 `llvm.exe <名字> <参数>` 的形式启动 `llvm.exe`。名字要作为子命令传进去，因为 Windows 上的 LLVM 在读取 `argv[0]` 之前会把其中的文件名换成它自己的。

## 构建流程

1. 用一个引导 clang 构建所有目标平台的运行库，以及插桩版的 clang 和 lld。引导 clang 是上一个 xclang 发布版；在还没有发布版之前，用的是 LLVM 官方的发布构建，它同样经过 PGO 和 ThinLTO 优化。
2. 插桩版工具链在 Linux x64 上编译一组固定的训练语料，覆盖 `-O0 -g` 和 `-O2`、x86_64 和 aarch64，用 lld 链接（ELF、COFF、ThinLTO）：
   - C 和 C++ 源码（abseil、sqlite）；
   - 预编译头：一个共享的，以及每个 abseil 源文件各自的 preamble，像编辑器那样在上面做解析和补全；
   - C++20 模块（libc++ 的 `std` 和 `std.compat`、magic_enum 的、Vulkan-Hpp 的、一个包装 nlohmann/json 的模块、一个分区模块）及导入它们的文件，两阶段和一阶段（精简 BMI）都有；
   - clang-scan-deps 的 P1689 依赖扫描；
   - 代码补全请求。

   每次发布得到一份 profile。
3. 每个主机平台的 clang、lld 和工具都用这份 profile 加 ThinLTO 构建；同一棵构建树也产出该平台的 libclang 包。profile 来自前端插桩，函数哈希只取决于源码，所以在 Linux 上录的 profile 适用于所有主机平台；另有一个重映射文件，用来匹配 mangling 不同的名字（`unsigned long` 对 `unsigned long long`）。
4. 发布之前，每个主机平台的包都在该平台的机器上测试：
   - 工具链自己的程序不加载任何 C++ 运行库（Linux 上最多需要 glibc 2.17）；
   - C 和 C++ 程序能为每个目标平台编译，能运行的就运行，覆盖宽原子操作、hardening 选项、GCC 的库名、版本资源，以及 Linux 上的 `-static`；
   - 本机上 `import std`、PCH、ThinLTO、ASan、TSan 和 libFuzzer 都能用；
   - 一个通过 `find_package(Clang)` 找到 libclang 的小工具能编译并运行。

## 限制

- Linux：glibc 2.17 没有 `rcrt1.o`，所以不支持 `-static-pie`；它的 `gcrt1.o` 不是位置无关代码，所以 `-pg` 要加 `-no-pie`。`libquadmath` 是 GCC 独有的：`__float128` 运算可以用，但没有 `quadmath.h`。
- 没有 OpenMP 运行库（`-fopenmp`），Windows 目标平台没有 sanitizer，也没有 MemorySanitizer。
- libc++ 以隐藏符号的方式分别链接进每个程序和动态库，所以在 Linux 和 macOS 上，一个动态库抛出的标准库异常，在另一个动态库里按类型接不住，只有 `catch (...)` 能接住：每个动态库都有自己的一份 `std::exception` 类型信息。Windows 按名字比较类型信息，没有这个问题。
- 不提供 clang-format、clang-tidy 和 clangd 程序。

## 仓库结构

```
cmake/caches/           每种构建是什么：运行库、主机工具链、插桩版、ASan 版 libclang
cmake/toolchain.cmake   用 xclang 目录为某个目标平台构建
config/                 各目标平台的 clang 配置文件
scripts/                TypeScript，用 Node 运行：bootstrap、runtimes（含 sysroot）、
                        toolchain、package
pgo/                    训练脚本（train.ts 及其语料）和 remap.txt
windows/alias.c         llvm.exe 每个名字背后的启动器
tests/                  smoke.ts 和 libclang.ts，各主机平台的检查；bench.ts，
                        和其它编译器比较编译速度
.github/workflows/      main.yml 按上面的阶段运行，手动触发
```

`pixi run <任务>` 以和 CI 相同的方式运行每个阶段（见 pixi.toml）；真正的构建需要 CI 级别的机器。

## 状态

| 部分 | 状态 |
|---|---|
| 全部六个目标平台的运行库和 sysroot | 完成 |
| Linux x64 上的 PGO 训练 | 完成：23 分钟，约 1700 次编译器调用 |
| 全部六个主机平台的 PGO + ThinLTO 工具链和 libclang | 完成：每个平台约 2 小时 |
| ASan 版 libclang（Linux x64、macOS arm64） | 完成 |
| 各主机平台的冒烟测试、libclang 使用测试 | 完成 |
| 用 xclang 构建 catter（Linux、Windows） | 完成，测试全部通过 |
| GitHub 草稿 release | 完成 |
| 针对 LLVM 的补丁集 | 以后 |
| [conda.clice.io](https://conda.clice.io) 上的 conda 包 | 以后 |

xclang 是为 [clice](https://github.com/clice-io/clice) 开发的，clice 的发布构建是它的第一个用户。
