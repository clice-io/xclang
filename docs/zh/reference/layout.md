# 压缩包目录结构

本页列出解压后的工具链压缩包内容，即文档中记作 `$XCLANG` 的工具链目录。每个主机压缩包都内置了全部目标平台的 sysroot；不同主机压缩包之间的差异仅在于 `bin/`（其中的可执行程序，以及随主机而异的 macOS 与 MSVC 目标平台配置文件）和这些可执行程序所链接组件的许可证声明。为何采用这种目录布局见[工具链结构](../design/toolchain.md)。

```
xclang/
  bin/                     llvm and its names (clang, clang++, clang-cl,
                           clang-scan-deps, ld.lld, ld64.lld, lld-link,
                           llvm-ar, llvm-objcopy, windres, dsymutil,
                           llvm-gsymutil, ...), the tools outside it
                           (llvm-profdata, llvm-cov, llvm-dwarfdump,
                           llvm-strings, FileCheck), the xclang command,
                           and <target>.cfg for every spelling of every
                           target, with <target>-system.cfg beside it for
                           the platform's C++ library (-stdlib=platform),
                           and their clang-cl files, <target>-clang-cl.cfg
                           and <target>-clang-cl-system.cfg;
                           <target>-sdk.cfg and <target>-clang-cl-sdk.cfg,
                           the SDK in use of an MSVC target, which the
                           xclang command writes; on x64 Windows hosts,
                           copies of the x64 MinGW and MSVC targets' ASan
                           DLLs (Windows: ASan's DLL)
  lib/clang/<major>/       clang's resource headers, compiler-rt's headers,
                           and compiler-rt for every target; for the MSVC
                           targets libc++ too
  lib/cmake/xclang/        the CMake package
  libc++/include/c++/v1/   libc++'s headers, the same for every target
  libc++/include/<target>/c++/v1/
                           each target's own __config_site, <target> as
                           clang spells it (x86_64-w64-windows-gnu)
  libc++/src/              the runtimes' sources, the same for every target,
                           in llvm-project's layout, patched (below)
  mingw-w64/include/       mingw-w64's headers, the same for both Windows
                           targets
  share/licenses/          the license notices of everything in the archive
                           (below)
  <target>/                the sysroot of each target (below)
  sdk/                     not in the archive: the vendor SDKs that the
                           xclang command fetches, and sdk/windows,
                           sdk/macos, those in use
  LICENSE                  xclang's license
```

MSVC 目标平台没有内置 sysroot，其 C 标准库来自下载的 SDK。它们的 compiler-rt 与 libc++ 存放在 lld-link 会自动搜索的 `lib/clang/<major>/lib/windows` 目录下，包括 `libc++-<arch>.lib`、`libc++experimental-<arch>.lib` 以及面向 x64 的 `libc++asan-x86_64.lib`；目标平台的 `__config_site` 会在每个包含 libc++ 头文件的目标文件中声明引用对应库文件（[Windows](../design/windows.md#libc-on-vcruntime)）。它们的 `<target>/` 目录下存放了 libc++ 的模块源码（`share/libc++/v1`）、`-print-library-module-manifest-path` 在 MSVC 目标平台上不会报告的模块清单（`lib/libc++.modules.json`），以及 ASan 构建版本的 `__config_site`（`lib/asan/include`）。

## Sysroot

| | Linux | Linux（musl） | Windows（MinGW） | macOS |
|---|---|---|---|---|
| C 标准库 | glibc 2.17：头文件位于 `usr/include`，启动文件与库文件位于 `lib64` 和 `usr/lib64` | musl 1.2.6：头文件位于 `usr/include`，启动文件、`libc.a` 以及空的 `libm.a`、`libpthread.a` 等位于 `usr/lib` | mingw-w64（UCRT）与 winpthreads：库文件位于 `lib`，头文件位于共用的 `mingw-w64/include` | 无内置库：使用 Apple 的 SDK，取自本机 Xcode 或 Linux 与 Windows 主机上的 `sdk/macos`（[macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)） |
| 内核头文件 | Linux 3.10（x64）、4.18（arm64），位于 `usr/include` | Linux 6.18，位于 `usr/include` | | |
| libc++、libc++abi、libunwind | `usr/lib`；头文件位于共用的 `libc++/include/c++/v1` | `usr/lib`；头文件同左 | `lib`；头文件同左 | `lib`（不含 libunwind，使用系统 libSystem 中的实现）；头文件同左 |
| libc++ 模块源码 | `usr/share/libc++/v1` | `usr/share/libc++/v1` | `share/libc++/v1` | `share/libc++/v1` |
| libc++ 模块清单 | `usr/lib/libc++.modules.json` | `usr/lib/libc++.modules.json` | `lib/libc++.modules.json` | `lib/libc++.modules.json` |
| ASan libc++ | `usr/lib/asan` | 无 | x64：`lib/asan` | `lib/asan` |
| GCC 库名兼容 | 空的 `libatomic.a`、`libgcc.a`、`libgcc_eh.a`、`libgcc_s.a` | 同左 | 同左，外加 `libssp.a`、`libssp_nonshared.a` | 无 |


运行 `clang++ --target=<target> -print-library-module-manifest-path` 可输出模块清单的路径。

## 共用头文件

多个目标平台共用的头文件在压缩包中只存放一份，且不使用符号链接。libc++ 的头文件在不同目标平台之间只有各自独立的 `__config_site` 不同，因此 `libc++/include` 采用 LLVM 按目标平台区分的运行时布局：共用头文件放在 `c++/v1` 下，各目标平台的专属文件放在 `<target>/c++/v1` 下。mingw-w64 的头文件在 x64 与 arm64 之间完全相同，统一存放在 `mingw-w64/include` 下。各配置文件会依次指定这些目录：先通过 `-stdlib++-isystem` 引入目标平台的 `__config_site`，再引入共用的 libc++ 头文件；Windows 目标平台还会传入 `-idirafter mingw-w64/include`，使其与普通 sysroot 的 `include` 目录一样排在 clang 内置头文件之后。使用 `--no-default-config` 并自行指定 `--sysroot` 的构建也需要显式传入这些目录。

这些头文件没有放在顶层的 `include/` 下：clang 驱动会自动在 `<toolchain>/include/c++/v1` 中查找 libc++（在 macOS 上甚至优先于 SDK），如果放在那里，传入 `--no-default-config` 时就会找到缺少 `__config_site` 的 xclang 头文件，而非系统的头文件。

## 运行时库源码

`libc++/src` 存放了构建各目标平台运行时库所需的单份源码：包含 llvm-project 的 `runtimes/`、`cmake/`、`llvm/cmake/`、`libcxx/`、`libcxxabi/`、`libunwind/` 与 `compiler-rt/`（剔除了测试与文档），以及 libc++ 所引用的 LLVM libc 内部头文件，并已打上 xclang 的相关补丁。CMake 包与 Bazel 模块会直接像在源码检出目录中一样，基于其中的 LLVM `runtimes/` 构建运行时库（[从源码构建运行时库](../features/runtimes-from-source.md)）。这部分源码解压后为 35 MB。

## 许可证

工具链、libclang、ASan 版 libclang 以及选项表的每个压缩包中都包含 `share/licenses`：

```
share/licenses/
  README.md                each component: what of the archive it is, its
                           version, its license (an SPDX expression) and
                           where its source is
  sbom.spdx.json           the same as an SPDX 2.3 document
  <component>/             the component's license and notice files
```

工具链包含的组件：

| 目录 | 内容 | 许可证 |
|---|---|---|
| `xclang` | xclang 的配置文件、CMake 包与 `xclang` 命令 | Apache-2.0 |
| `llvm-project` | clang、lld、LLVM 工具、libc++、libc++abi、libunwind 与 compiler-rt；各文件保留其在 LLVM 源码树中的相对路径，`<file>.license` 则是从对应文件头部注释中提取出的版权声明 | Apache-2.0 WITH LLVM-exception，以及第三方组件各自的许可证（正则表达式引擎、BLAKE3、xxHash、Unicode 转换与数据、Visual Studio Setup API 声明） |
| `zlib`, `zstd` | 静态链接进可执行程序（macOS 主机仅链接 zstd） | Zlib；BSD-3-Clause OR GPL-2.0-only |
| `glibc` | Linux 目标平台的 C 标准库（2.17） | LGPL-2.1-or-later |
| `musl` | musl 目标平台的 C 标准库（1.2.6） | MIT，以及其 `COPYRIGHT` 中列出的部分：BSD-2-Clause、BSD-3-Clause、ISC、SunPro |
| `linux` | Linux 目标平台（glibc 与 musl）的内核 UAPI 头文件 | GPL-2.0-only WITH Linux-syscall-note |
| `nss` | Linux 目标平台的 `libfreebl3.so`（由 glibc 的 `libcrypt` 加载） | MPL-2.0 |
| `mingw-w64` | Windows 目标平台的头文件、CRT 与 winpthreads（Windows 主机的可执行程序同样链接了它们） | ZPL-2.1 及运行时其余部分的许可证 |
| `rust`, `rust-crates/<crate>-<version>` | Rust 标准库以及 `bin/xclang` 所链接的各个 crate | 各自对应的许可证 |

glibc、glibc 目标平台的内核头文件与 NSS 取自 conda-forge 的 sysroot 软件包所重打包的 CentOS 7 组件：README 中列出了这些软件包、CentOS 源码 RPM 包以及对应的上游版本。musl 与 musl 目标平台的内核头文件则直接基于 musl 官方版本与 kernel.org 源码构建。libclang 压缩包包含 `xclang`、`llvm-project`、`zlib` 与 `zstd`（macOS 主机使用系统自带的库而不含 `zlib`，Windows 主机则额外包含 `mingw-w64`），选项表压缩包包含 `xclang` 与 `llvm-project`。

## 不含符号链接

在 Linux 与 macOS 主机上，`bin/` 下的各个工具名是指向 `llvm` 的符号链接。Windows 压缩包则不包含任何符号链接，因此无需额外权限即可解压，也能直接打包为 conda 软件包；其中的每个工具名都是一个轻量的[启动器](../design/windows.md#the-launchers)。Linux sysroot 同样不含符号链接：soname 链接直接存为普通文件，`libfoo.so` 链接则替换为链接器脚本（[为什么选择 glibc 2.17](../design/hermeticity.md#why-glibc-2-17)）。
