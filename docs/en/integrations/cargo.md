# Rust and Cargo

`xclang cargo` runs `cargo` with xclang's `clang` as the C and C++ compiler and xclang's `clang` or `lld-link` as the linker for each target, without a `.cargo/config.toml`. Use it with any `cargo` command (`xclang cargo build --target <Rust target>`, `run`, `test`, `check`). C and C++ code in crates (`cc`, `cmake`, `bindgen`) and the final Rust link use xclang's sysroots and static runtimes, so the resulting binaries depend only on the OS ([Hermeticity](../design/hermeticity.md)).

When another build tool invokes `cargo` directly instead of `xclang cargo`, set Cargo's environment variables or `.cargo/config.toml` directly ([without `xclang cargo`](#without-xclang-cargo)).

## Prerequisites

- xclang's `bin/` first in `PATH`, as `pixi shell` sets it ([Install](../guide/quick-start.md)), or `xclang` run by its path: it locates its toolchain from its own binary path.
- `rustup`. When a target's Rust standard library is not installed, `xclang cargo` adds it with `rustup target add`.

## Build for Windows from Linux or macOS

The example in [examples/cargo](https://github.com/clice-io/xclang/tree/main/examples/cargo) is a Rust binary that compiles and calls a C function through the `cc` crate, with no `.cargo/config.toml`. Its commands run in that directory inside `pixi shell` after `pixi install`:

<!-- file: examples/cargo/rust-toolchain.toml -->
```toml
[toolchain]
channel = "1.99.0"
profile = "minimal"
targets = ["x86_64-pc-windows-gnullvm", "aarch64-pc-windows-gnullvm"]
```

`Cargo.toml` uses the `cc` crate in `build.rs`:

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

`build.rs` compiles the C file:

<!-- file: examples/cargo/build.rs -->
```rust
fn main() {
    cc::Build::new().file("src/hello.c").compile("hello");
}
```

`src/hello.c` writes a greeting:

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

`src/main.rs` calls it:

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

The binary imports only Windows system DLLs and UCRT (`api-ms-win-crt-*`), no `libunwind`, `libc++`, `libgcc` or `libwinpthread`. Copied to Windows 10 or later, it prints:

<!-- file: examples/cargo/expected.txt -->
```
hello from C, linked by xclang
```

Rust's MinGW targets for xclang are `x86_64-pc-windows-gnullvm` and `aarch64-pc-windows-gnullvm`, whose standard library links `libunwind` and UCRT to match xclang's MinGW sysroots ([MinGW targets](../guide/cross-compiling.md#mingw-targets)). Rust's `*-pc-windows-gnu` targets link `libgcc` and `msvcrt` instead; `xclang cargo` rejects them and names the `*-pc-windows-gnullvm` target.

## Targets

| Rust target | xclang target | from |
|---|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | the same | any host |
| `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl` | the same, [static](#static-programs-with-musl) | any host |
| `x86_64-pc-windows-gnullvm`, `aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | any host |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | macOS hosts |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | [Linux and Windows hosts](#macos-from-linux-and-windows) |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | the same, [MSVC targets](#the-msvc-abi) | any host |

`xclang cargo` builds for these ten targets and rejects others.

## What xclang cargo Sets

`xclang cargo` sets per-target variables in the environment of the `cargo` process it spawns. Any variable already set in the environment or in a Cargo config's `[env]` table is left unchanged, and the project's or user's `.cargo/config.toml` and `RUSTFLAGS` stay in effect. `xclang cargo` also reads `[env]` (from config files and `--config`) for `XCLANG_STDLIB`, and for existing values of `BINDGEN_EXTRA_CLANG_ARGS`, `CFLAGS` and `CXXFLAGS` that it appends to.

| variable | |
|---|---|
| `CARGO_TARGET_<TARGET>_LINKER` | `xclang` itself, linked as `<Rust target>-linker` in xclang's cache: it runs the toolchain's `clang` with `--target=<triple>`, or `lld-link` with the Windows SDK in use for MSVC targets |
| `CC_<target>`, `CXX_<target>`, `AR_<target>`, `RANLIB_<target>` | the toolchain's `clang`, `clang++`, `llvm-ar` (`llvm-lib` for MSVC) and `llvm-ranlib`. The `cc` crate passes `--target`, whose config file selects the sysroot and runtimes |
| `CXXSTDLIB_<target>` | `c++` so the `cc` crate links `libc++` (`stdc++` with `XCLANG_STDLIB=platform` for Linux, musl and MinGW, [below](#the-system-s-c-library)) |
| `CMAKE_TOOLCHAIN_FILE_<target>` | a generated file in xclang's cache that sets `XCLANG_ROOT` and `XCLANG_TARGET` and includes `lib/cmake/xclang/toolchain.cmake` ([CMake](cmake.md)) for the `cmake` crate |
| `CMAKE_GENERATOR_<target>` | on Windows hosts for every target: `Ninja` when `ninja` is in `PATH` (without Ninja, the `cmake` crate falls back to Visual Studio's generator, which compiles with `cl.exe`). Off Windows for MSVC targets: `Ninja`, or `Unix Makefiles` when `ninja` is not in `PATH` |
| `BINDGEN_EXTRA_CLANG_ARGS_<target>` | `--target=<triple>`, `-nostdlibinc` and the header search directories of the toolchain's `clang` for the target, for the `libclang` that `bindgen` loads, followed by any existing value |
| `CARGO_TARGET_<TARGET>_RUSTFLAGS` | for MSVC targets: appends `-Ctarget-feature=+crt-static` (unless `crt-static` is already named) so build scripts see the static VC runtime. When no config defines target-specific `rustflags`, the variable starts with `build.rustflags` and `CARGO_BUILD_RUSTFLAGS`, which Cargo would otherwise ignore |
| `MACOSX_DEPLOYMENT_TARGET` | for macOS targets: `13.0` |
| `SDKROOT` | for macOS targets on Linux and Windows hosts: the fetched macOS SDK in use |
| `PATH`, `XCLANG_ROOT` | puts the toolchain's `bin/` first in `PATH` for build scripts that invoke `clang` directly, and sets `XCLANG_ROOT` for the linker wrapper |

When `<Rust target>-linker` runs, it forwards `rustc`'s arguments after adjusting flags that assume another C runtime or unwinder:

- **Linux (`glibc`)**: replaces `-lgcc_s` (and `-lgcc_eh` with `+crt-static`) with `-l:libunwind.a`, because xclang's `libgcc_s.a` and `libgcc_eh.a` are empty stubs; drops `-B<rustlib>/bin/gcc-ld` so `clang` does not invoke `rustc`'s `rust-lld` on x86_64.
- **Linux (`musl`)**: drops `rustc`'s `self-contained` musl startup objects and `-L` directories, `-nostartfiles` and `-no-pie`, so the binary links xclang's `musl`, matching the headers that crates' C code compiled against.
- **Windows (`MSVC`)**: links the [hybrid CRT](../guide/cross-compiling.md#msvc-targets) by replacing `/defaultlib:msvcrt` with `/defaultlib:libcmt` and passing `/nodefaultlib:libucrt.lib /defaultlib:ucrt.lib /ignore:4099` (plus `/winsysroot:<sdk>` when a fetched Windows SDK is present).
- **Windows (`MinGW`) and macOS**: adds only `--target=<triple>`.

Before spawning `cargo`, `xclang cargo` determines the targets from `--target`, else `build.target` (from `--config`, `CARGO_BUILD_TARGET` or `.cargo/config.toml`), else `rustc -vV`'s host target. For compiling subcommands, it adds any missing Rust standard library with `rustup target add` (unless `-Zbuild-std` is set) and checks that any required vendor SDK has been fetched; for non-compiling subcommands (`metadata`, `tree`, `clean`, and so on) it skips both checks. Linker wrappers and generated CMake toolchain files are stored under `$XCLANG_CACHE_DIR/cargo/<hash>`, or `xclang/cargo/<hash>` in the user's cache directory (`~/.cache`, `~/Library/Caches`, `%LOCALAPPDATA%`).

## The System's C++ Library

Set `XCLANG_STDLIB=platform` to build C++ code in crates against the [platform's C++ library](../guide/cross-compiling.md#the-platform-s-c-library) instead of xclang's `libc++`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG_STDLIB=platform xclang cargo build --release
```

- Appends `-stdlib=platform` to `CFLAGS_<target>` and `CXXFLAGS_<target>` (after any existing `CFLAGS_<target>`, `TARGET_CFLAGS` or `HOST_CFLAGS`, or `CFLAGS`), and passes `-stdlib=platform` in the linker wrapper for every non-MSVC target.
- Sets `CXXSTDLIB_<target>` to `stdc++` for Linux, musl and MinGW targets, using the host's `libstdc++` or the `--sysroot` given in compiler flags.
- Keeps `-lgcc_s` on Linux so the binary loads the system's `libgcc_s.so.1` alongside `libstdc++.so.6`.
- Sets `XCLANG_STDLIB=platform` in the `cmake` crate's generated toolchain file ([CMake](cmake.md#use-the-system-s-c-library)).

## Static Programs with musl

Rust's `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` targets link against xclang's `musl` ([musl targets](../guide/cross-compiling.md#musl-targets)), dropping the bundled `self-contained` musl and startup files that `rustc` ships:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-unknown-linux-musl
```

The resulting binary has no program interpreter and loads no shared libraries. `rustc` links it with `-static-pie` on x86_64 and `-static` on aarch64, and passes `-lunwind` itself.

## macOS from Linux and Windows

Building for `aarch64-apple-darwin` or `x86_64-apple-darwin` from a Linux or Windows host requires Apple's SDK, fetched once with `xclang sdk fetch macos --accept-license` ([macOS on Linux and Windows hosts](../guide/cross-compiling.md#on-linux-and-windows-hosts)). On macOS hosts, Xcode's SDK is used:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target aarch64-apple-darwin
```

## The MSVC ABI

Building for `x86_64-pc-windows-msvc` or `aarch64-pc-windows-msvc` uses the Windows SDK fetched with `xclang sdk fetch windows --accept-license` ([MSVC targets](../guide/cross-compiling.md#msvc-targets)), or an installed Visual Studio on Windows hosts:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-pc-windows-msvc
```

It links the [hybrid CRT](../guide/cross-compiling.md#msvc-targets): the VC runtime linked statically and UCRT loaded from Windows, with no `vcruntime140.dll` dependency.

## Build for the Machine You Are On

Running `xclang cargo build` without `--target` (or with `--target` set to the host's triple) configures xclang for the host target, including linking build scripts and proc macros with xclang. On Linux, the resulting binary requires `glibc` 2.17 at most, with `libc++` and `libunwind` linked statically. When building only for another target, Cargo links build scripts and proc macros with the host's default linker (`cc`, or Visual Studio's `link.exe` on Windows).

## What the Programs Load

xclang's own CLI (`xclang/`, which compiles the C code of `ring` and `liblzma`) is built with xclang as its C compiler and linker for every host. At runtime it loads only:

| target | loads |
|---|---|
| Linux | `libc.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1` (`glibc` 2.17) |
| Windows (MinGW and MSVC) | Windows system DLLs (`kernel32`, `ntdll`, `advapi32`, `ws2_32`, `bcrypt`, `crypt32`) and UCRT (`api-ms-win-crt-*`); no `libunwind`, `libc++`, `vcruntime140` or `libwinpthread` |
| macOS | `libSystem`, `libiconv`, and the `Security` and `CoreFoundation` frameworks (macOS 13.0) |

## Without xclang cargo

When a project or outer build system invokes `cargo` directly, set the linker, its `--target` flag and the `cc` crate's compiler variables in the environment or in `.cargo/config.toml`. Note that setting `RUSTFLAGS` in the environment overrides all `rustflags` entries in Cargo config files. For `aarch64-unknown-linux-gnu` from a Linux x64 or macOS host:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
rustup target add aarch64-unknown-linux-gnu
export CC_aarch64_unknown_linux_gnu=clang CXX_aarch64_unknown_linux_gnu=clang++ AR_aarch64_unknown_linux_gnu=llvm-ar
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-Clink-arg=--target=aarch64-unknown-linux-gnu -Clink-arg=-l:libunwind.a"
cargo build --release --target aarch64-unknown-linux-gnu
```

Variable names use the target triple in lowercase with `_` for `CC_<target>`, and in uppercase with `_` for `CARGO_TARGET_<TARGET>_*`. Per-target requirements:

- **Linux (`glibc`)**: `-Clink-arg=--target=<target> -Clink-arg=-l:libunwind.a`. On `x86_64-unknown-linux-gnu`, also pass `-Clinker-features=-lld` so `rustc` does not invoke its bundled `rust-lld`.
- **Linux (`musl`)**: `-Clink-arg=--target=<target> -Clink-self-contained=no`, without `-l:libunwind.a`.
- **Windows (`MinGW`)**: `-Clink-arg=--target=<arch>-w64-mingw32`.
- **macOS**: `-Clink-arg=--target=<target>` and `MACOSX_DEPLOYMENT_TARGET=13.0`; on Linux and Windows hosts also set `SDKROOT=$(xclang sdk path macos)`.
- **Windows (`MSVC`)**: `lld-link` as the linker, `-Ctarget-feature=+crt-static`, and `-Clink-arg=` for `/winsysroot:<sdk>`, `/nodefaultlib:libucrt.lib`, `/defaultlib:ucrt.lib` and `/ignore:4099` (where `<sdk>` is `$(xclang sdk path windows)`); `clang` and `clang++` as the C and C++ compilers with `-Xmicrosoft-windows-sys-root <sdk>` in `CFLAGS_<target>` and `CXXFLAGS_<target>`, and `llvm-lib` as `AR_<target>`.

Cargo applies `CARGO_TARGET_<TARGET>_RUSTFLAGS` to build scripts only when `--target` is passed; when building for the host without `--target`, pass those flags in `RUSTFLAGS`.

[Rust targets for other Linux architectures](../design/roadmap.md#linux-architectures) and [shipping `libgcc_s.a` as a linker script](../design/roadmap.md#libgcc-s-script) (so Linux targets do not need `-l:libunwind.a` when configuring Cargo by hand) are on the roadmap.
