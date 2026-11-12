# Rust 与 Cargo

`xclang cargo` 会在调用 `cargo` 时将 xclang 的 `clang` 设为各目标平台的 C 与 C++ 编译器，并将 xclang 的 `clang` 或 `lld-link` 设为链接器，无需编写 `.cargo/config.toml`。它可用于任意 `cargo` 命令（`xclang cargo build --target <Rust target>`、`run`、`test`、`check`）。crate 中的 C 与 C++ 代码（`cc`、`cmake`、`bindgen`）以及最终的 Rust 链接步骤都会使用 xclang 的 sysroot 与静态运行时库，使生成的二进制文件只依赖操作系统本身（[封闭性](../design/hermeticity.md)）。

如果外部构建工具直接调用 `cargo` 而非 `xclang cargo`，请直接设置 Cargo 的环境变量或 `.cargo/config.toml`（[不使用 `xclang cargo`](#without-xclang-cargo)）。

## 前置条件

- xclang 的 `bin/` 排在 `PATH` 最前面（`pixi shell` 会自动这样设置；见[安装](../guide/quick-start.md)），或按路径运行 `xclang`：它会根据自身二进制文件的路径定位所属工具链。
- `rustup`。当目标平台的 Rust 标准库尚未安装时，`xclang cargo` 会通过 `rustup target add` 自动添加它。

## 在 Linux 或 macOS 上构建 Windows 目标平台

[examples/cargo](https://github.com/clice-io/xclang/tree/main/examples/cargo) 中的示例是一个通过 `cc` crate 编译并调用 C 函数的 Rust 二进制程序，不含 `.cargo/config.toml`。下列命令在示例目录下进入 `pixi shell`（运行 `pixi install` 之后）执行：

<!-- file: examples/cargo/rust-toolchain.toml -->
```toml
[toolchain]
channel = "1.99.0"
profile = "minimal"
targets = ["x86_64-pc-windows-gnullvm", "aarch64-pc-windows-gnullvm"]
```

`Cargo.toml` 为构建脚本引入了 `cc` crate（用于 `build.rs`）：

<!-- file: examples/cargo/Cargo.toml -->
```toml
[package]
name = "hello"
version = "0.1.0"
edition = "2024"
publish = false

[build-dependencies]
cc = "1"
```

`build.rs` 负责编译 C 源文件：

<!-- file: examples/cargo/build.rs -->
```rust
fn main() {
    cc::Build::new().file("src/hello.c").compile("hello");
}
```

`src/hello.c` 写入一条问候语：

<!-- file: examples/cargo/src/hello.c -->
```c
#include <stdio.h>

#ifndef __clang__
#error "crates' C code is compiled by xclang's clang"
#endif

int hello(char* buffer, int size) {
    return snprintf(buffer, (size_t)size, "hello from C");
}
```

`src/main.rs` 调用上述函数：

<!-- file: examples/cargo/src/main.rs -->
```rust
use std::ffi::{CStr, c_char, c_int};

unsafe extern "C" {
    fn hello(buffer: *mut c_char, size: c_int) -> c_int;
}

fn main() {
    let mut buffer = [0 as c_char; 64];
    let text = unsafe {
        hello(buffer.as_mut_ptr(), buffer.len() as c_int);
        CStr::from_ptr(buffer.as_ptr())
    };
    println!("{}, linked by xclang", text.to_string_lossy());
}
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
rustup toolchain install
xclang cargo build --release --target x86_64-pc-windows-gnullvm
xclang cargo build --release --target aarch64-pc-windows-gnullvm
llvm-readobj --needed-libs target/x86_64-pc-windows-gnullvm/release/hello.exe
```

生成的二进制文件只导入 Windows 系统 DLL 与 UCRT（`api-ms-win-crt-*`），不依赖 `libunwind`、`libc++`、`libgcc` 或 `libwinpthread`。将其拷贝到 Windows 10 及更高版本的系统上运行，会输出：

<!-- file: examples/cargo/expected.txt -->
```
hello from C, linked by xclang
```

配合 xclang 使用的 Rust MinGW 目标平台为 `x86_64-pc-windows-gnullvm` 与 `aarch64-pc-windows-gnullvm`，它们的标准库会链接 `libunwind` 与 UCRT，与 xclang 的 MinGW sysroot 保持一致（[MinGW 目标平台](../guide/cross-compiling.md#mingw-targets)）。Rust 的 `*-pc-windows-gnu` 目标平台则会链接 `libgcc` 与 `msvcrt`；`xclang cargo` 会拒绝它们，并提示改用对应的 `*-pc-windows-gnullvm` 目标平台。

## 目标平台

| Rust 目标平台 | xclang 目标平台 | 可用主机 |
|---|---|---|
| `x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu` | 相同 | 任意主机 |
| `x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl` | 相同，[静态链接](#static-programs-with-musl) | 任意主机 |
| `x86_64-pc-windows-gnullvm`、`aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`、`aarch64-w64-mingw32` | 任意主机 |
| `aarch64-apple-darwin`、`x86_64-apple-darwin` | 相同 | macOS 主机 |
| `aarch64-apple-darwin`、`x86_64-apple-darwin` | 相同 | [Linux 与 Windows 主机](#macos-from-linux-and-windows) |
| `x86_64-pc-windows-msvc`、`aarch64-pc-windows-msvc` | 相同，[MSVC 目标平台](#the-msvc-abi) | 任意主机 |

`xclang cargo` 支持构建这十个目标平台，并会拒绝其他目标平台。

## xclang cargo 设置的环境变量

`xclang cargo` 会在其启动的 `cargo` 子进程环境中设置按目标平台区分的环境变量。对于环境中或 Cargo 配置的 `[env]` 表里已经设置的变量，它会保持原样不作修改，项目或用户的 `.cargo/config.toml` 与 `RUSTFLAGS` 也依然生效。此外，`xclang cargo` 还会读取 `[env]`（来自配置文件与 `--config`）中的 `XCLANG_STDLIB`，以及 `BINDGEN_EXTRA_CLANG_ARGS`、`CFLAGS` 与 `CXXFLAGS` 的现有值并在其后追加参数。

| 变量 | |
|---|---|
| `CARGO_TARGET_<TARGET>_LINKER` | `xclang` 自身（在 xclang 缓存中链接为 `<Rust target>-linker`）：它会调用工具链的 `clang` 并传入 `--target=<triple>`，或在 MSVC 目标平台上配合当前启用的 Windows SDK 调用 `lld-link` |
| `CC_<target>`、`CXX_<target>`、`AR_<target>`、`RANLIB_<target>` | 工具链的 `clang`、`clang++`、`llvm-ar`（MSVC 上为 `llvm-lib`）与 `llvm-ranlib`。`cc` crate 会传入 `--target`，由对应的配置文件选取 sysroot 与运行时库 |
| `CXXSTDLIB_<target>` | 设为 `c++`，使 `cc` crate 链接 `libc++`（在 Linux、musl 与 MinGW 上若设为 `stdc++`，则需配合 `XCLANG_STDLIB=platform`；[见下文](#the-system-s-c-library)） |
| `CMAKE_TOOLCHAIN_FILE_<target>` | xclang 缓存中生成的文件，会设置 `XCLANG_ROOT` 与 `XCLANG_TARGET` 并引入 `lib/cmake/xclang/toolchain.cmake`（[CMake](cmake.md)），供 `cmake` crate 使用 |
| `CMAKE_GENERATOR_<target>` | 在 Windows 主机上面向所有目标平台：设为 `Ninja`（当 `ninja` 在 `PATH` 中时；若没有 Ninja，`cmake` crate 会回退到使用 `cl.exe` 编译的 Visual Studio 生成器）。在非 Windows 主机上面向 MSVC 目标平台：设为 `Ninja`，或设为 `Unix Makefiles`（当 `ninja` 不在 `PATH` 中时） |
| `BINDGEN_EXTRA_CLANG_ARGS_<target>` | `--target=<triple>`、`-nostdlibinc` 以及工具链的 `clang` 针对目标平台的头文件搜索目录（供由 `libclang` 驱动的 `bindgen` 加载使用），随后附上原有的值 |
| `CARGO_TARGET_<TARGET>_RUSTFLAGS` | 在 MSVC 目标平台上：追加 `-Ctarget-feature=+crt-static`（除非已包含 `crt-static`），使构建脚本感知到静态 VC 运行时。当配置中未定义针对目标平台的 `rustflags` 时，变量开头会先带上 `build.rustflags` 与 `CARGO_BUILD_RUSTFLAGS`（否则 Cargo 会忽略这两者） |
| `MACOSX_DEPLOYMENT_TARGET` | 在 macOS 目标平台上：设为 `13.0` |
| `SDKROOT` | 在 Linux 与 Windows 主机上面向 macOS 目标平台：设为当前启用的已下载 macOS SDK |
| `PATH`、`XCLANG_ROOT` | 将工具链的 `bin/` 排在 `PATH` 最前面，供直接调用 `clang` 的构建脚本使用，并为链接器包装程序设置 `XCLANG_ROOT` |

当 `<Rust target>-linker` 运行时，它会调整那些假定使用其他 C 运行时库或栈展开库的参数，再将其余 `rustc` 参数转发给链接器：

- **Linux（`glibc`）**：将 `-lgcc_s`（以及启用 `-lgcc_eh` 时的 `+crt-static` 对应参数）替换为 `-l:libunwind.a`，因为 xclang 的 `libgcc_s.a` 与 `libgcc_eh.a` 是空桩库；同时去掉 `-B<rustlib>/bin/gcc-ld`，防止 `clang` 在 x86_64 上调用 `rustc` 自带的 `rust-lld`。
- **Linux（`musl`）**：去掉 `rustc` 自带的 `self-contained` musl 启动目标文件与 `-L` 目录、`-nostartfiles` 和 `-no-pie`，使二进制文件链接 xclang 的 `musl`，与编译 crate C 代码时所用的头文件保持一致。
- **Windows（`MSVC`）**：链接[混合 CRT](../guide/cross-compiling.md#msvc-targets)，将 `/defaultlib:msvcrt` 替换为 `/defaultlib:libcmt`，并传入 `/nodefaultlib:libucrt.lib /defaultlib:ucrt.lib /ignore:4099`（若存在已下载的 Windows SDK，还会加上 `/winsysroot:<sdk>`）。
- **Windows（`MinGW`）与 macOS**：仅添加 `--target=<triple>`。

在启动 `cargo` 之前，`xclang cargo` 会依次从 `--target`、`build.target`（来自 `--config`、`CARGO_BUILD_TARGET` 或 `.cargo/config.toml`）或 `rustc -vV` 报告的主机目标平台确定本次的目标平台。对于需要编译的子命令，它会通过 `rustup target add` 安装缺失的 Rust 标准库（除非设置了 `-Zbuild-std`），并检查所需的厂商 SDK 是否已下载；对于不执行编译的子命令（如 `metadata`、`tree`、`clean` 等），则会跳过这两项检查。链接器包装程序与生成的 CMake 工具链文件存放在 `$XCLANG_CACHE_DIR/cargo/<hash>` 下，或用户缓存目录下的 `xclang/cargo/<hash>`（对应 `~/.cache`、`~/Library/Caches`、`%LOCALAPPDATA%`）。

## 系统的 C++ 标准库

设置 `XCLANG_STDLIB=platform`，即可基于[平台的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)而非 xclang 的 `libc++` 编译 crate 中的 C++ 代码：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG_STDLIB=platform xclang cargo build --release
```

- 将 `-stdlib=platform` 追加到 `CFLAGS_<target>` 与 `CXXFLAGS_<target>` 末尾（排在原有的 `CFLAGS_<target>`、`TARGET_CFLAGS` 或 `HOST_CFLAGS`，或 `CFLAGS` 之后），并在非 MSVC 目标平台的链接器包装程序中传入 `-stdlib=platform`。
- 在 Linux、musl 与 MinGW 目标平台上将 `CXXSTDLIB_<target>` 设为 `stdc++`，使用主机的 `libstdc++` 或编译器参数中通过 `--sysroot` 指定的库。
- 在 Linux 上保留 `-lgcc_s`，使二进制文件在加载 `libgcc_s.so.1` 的同时配合系统的 `libstdc++.so.6` 运行。
- 在生成的工具链文件中设置 `XCLANG_STDLIB=platform` 供 `cmake` crate 使用（[CMake](cmake.md#use-the-system-s-c-library)）。

## 使用 musl 构建静态程序

Rust 的 `x86_64-unknown-linux-musl` 与 `aarch64-unknown-linux-musl` 目标平台会链接 xclang 的 `musl`（[musl 目标平台](../guide/cross-compiling.md#musl-targets)），不再使用捆绑的 `self-contained` musl 及 `rustc` 自带的启动文件：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-unknown-linux-musl
```

生成的二进制文件不含程序解释器，也不加载任何共享库。`rustc` 在 x86_64 上使用 `-static-pie` 链接，在 aarch64 上使用 `-static` 链接，并自行传入 `-lunwind`。

## 在 Linux 与 Windows 上构建 macOS

在 Linux 或 Windows 主机上构建 `aarch64-apple-darwin` 或 `x86_64-apple-darwin` 需要使用 Apple 的 SDK，可先运行一次 `xclang sdk fetch macos --accept-license` 获取（[Linux 与 Windows 主机上的 macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)）。在 macOS 主机上则直接使用 Xcode 的 SDK：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target aarch64-apple-darwin
```

## MSVC ABI

构建 `x86_64-pc-windows-msvc` 或 `aarch64-pc-windows-msvc` 时，会使用通过 `xclang sdk fetch windows --accept-license` 下载的 Windows SDK（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)），或在 Windows 主机上使用本机安装的 Visual Studio：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-pc-windows-msvc
```

它会链接[混合 CRT](../guide/cross-compiling.md#msvc-targets)：静态链接 VC 运行时，并从 Windows 系统动态加载 UCRT，不依赖 `vcruntime140.dll`。

## 为当前主机构建

运行 `xclang cargo build` 时若不传 `--target`（或将 `--target` 设为主机 triple），会为主机目标平台配置 xclang，包括使用 xclang 链接构建脚本与过程宏（proc macro）。在 Linux 上，生成的二进制文件最高只需 `glibc` 2.17，并静态链接 `libc++` 与 `libunwind`。若仅构建其他目标平台，Cargo 会使用主机的默认链接器（`cc`，或在 Windows 上为 Visual Studio 的 `link.exe`）链接构建脚本与过程宏。

## 程序在运行时加载的库

xclang 自身的命令行工具（`xclang/`，编译了 `ring` 与 `liblzma` 的 C 代码）在所有主机上均以 xclang 作为 C 编译器和链接器构建。它在运行时仅加载：

| 目标平台 | 加载项 |
|---|---|
| Linux | `libc.so.6`、`libdl.so.2`、`libpthread.so.0`、`librt.so.1`（`glibc` 2.17） |
| Windows（MinGW 与 MSVC） | Windows 系统 DLL（`kernel32`、`ntdll`、`advapi32`、`ws2_32`、`bcrypt`、`crypt32`）与 UCRT（`api-ms-win-crt-*`）；不依赖 `libunwind`、`libc++`、`vcruntime140` 或 `libwinpthread` |
| macOS | `libSystem`、`libiconv`，以及 `Security` 与 `CoreFoundation` framework（macOS 13.0） |

## 不使用 xclang cargo

当项目或外层构建系统直接调用 `cargo` 时，请在环境变量或配置文件中设置链接器、链接器的 `--target` 参数，以及 `cc` crate 的编译器变量（写入环境或 `.cargo/config.toml`）。注意，在环境变量中设置 `RUSTFLAGS` 会覆盖 Cargo 配置文件中的所有 `rustflags` 条目。在 Linux x64 或 macOS 主机上构建 `aarch64-unknown-linux-gnu` 的配置如下：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
rustup target add aarch64-unknown-linux-gnu
export CC_aarch64_unknown_linux_gnu=clang CXX_aarch64_unknown_linux_gnu=clang++ AR_aarch64_unknown_linux_gnu=llvm-ar
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-Clink-arg=--target=aarch64-unknown-linux-gnu -Clink-arg=-l:libunwind.a"
cargo build --release --target aarch64-unknown-linux-gnu
```

变量名中的目标平台 triple：在改用 `_` 连接的小写形式下用于 `CC_<target>`，在改用 `_` 连接的大写形式下用于 `CARGO_TARGET_<TARGET>_*`。各目标平台的具体要求如下：

- **Linux（`glibc`）**：传入 `-Clink-arg=--target=<target> -Clink-arg=-l:libunwind.a`。在 `x86_64-unknown-linux-gnu` 上，还需传入 `-Clinker-features=-lld`，防止 `rustc` 调用其自带的 `rust-lld`。
- **Linux（`musl`）**：传入 `-Clink-arg=--target=<target> -Clink-self-contained=no`，不加 `-l:libunwind.a`。
- **Windows（`MinGW`）**：传入 `-Clink-arg=--target=<arch>-w64-mingw32`。
- **macOS**：传入 `-Clink-arg=--target=<target>` 并设置 `MACOSX_DEPLOYMENT_TARGET=13.0`；在 Linux 与 Windows 主机上还需设置 `SDKROOT=$(xclang sdk path macos)`。
- **Windows（`MSVC`）**：将 `lld-link` 设为链接器，传入 `-Ctarget-feature=+crt-static`，并通过 `-Clink-arg=` 分别传入 `/winsysroot:<sdk>`、`/nodefaultlib:libucrt.lib`、`/defaultlib:ucrt.lib` 与 `/ignore:4099`（其中 `<sdk>` 为 `$(xclang sdk path windows)`）；将 `clang` 与 `clang++` 设为 C 与 C++ 编译器，在编译参数中加入 `-Xmicrosoft-windows-sys-root <sdk>`（写入 `CFLAGS_<target>` 与 `CXXFLAGS_<target>`），并将 `llvm-lib` 设为 `AR_<target>`。

只有传入了 `CARGO_TARGET_<TARGET>_RUSTFLAGS` 所对应的 `--target` 时，Cargo 才会将这一变量作用于构建脚本；在不传 `--target` 为主机构建时，请将这些参数写入 `RUSTFLAGS`。

[面向其他 Linux 架构的 Rust 目标平台](../design/roadmap.md#linux-architectures)与[将 `libgcc_s.a` 作为链接器脚本提供](../design/roadmap.md#libgcc-s-script)（使手动配置 Cargo 时 Linux 目标平台不再需要 `-l:libunwind.a`）均已列入路线图。
