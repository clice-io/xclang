# Rust and Cargo

`xclang cargo` runs cargo with xclang as the C and C++ compiler and the
linker of the targets it builds for, the way cargo-zigbuild does it with
zig: `xclang cargo build --target <Rust target>`, and `run`, `test`,
`check` and cargo's other commands, with no cargo config. Crates' C and C++
code (the `cc` and `cmake` crates, bindgen) and the link of Rust programs
go through xclang's clang and lld, with its sysroots and static runtimes.
The program then needs nothing but the OS
([hermeticity](../design/hermeticity.md)).

`xclang cargo` is in no release yet
([Unreleased](../design/roadmap.md#cargo-helper)). With a release, set
cargo up by hand: [without xclang cargo](#without-xclang-cargo).

## Prerequisites

- xclang's `bin/` first in `PATH`, as `pixi shell` has it
  ([installation](../guide/install.md)), or `xclang` run by its path: it
  finds its toolchain by itself.
- rustup. `xclang cargo` adds the standard library of a target that lacks
  it, with `rustup target add`.

## Build for Windows from Linux or macOS

The example is a Rust program that calls a C function, in
[examples/cargo](https://github.com/clice-io/xclang/tree/main/examples/cargo).
Its commands run in that directory, in a `pixi shell` after `pixi install`.
It has no `.cargo/config.toml`.

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

The program needs only Windows DLLs and UCRT (`api-ms-win-crt-*`): no
libunwind, libc++, libgcc or winpthread. Copied to Windows 10 or later, it
prints this:

<!-- file: examples/cargo/expected.txt -->
```
hello from C, linked by xclang
```

The Windows targets of Rust for xclang are the `*-windows-gnullvm` ones.
Their std links libunwind and UCRT, as xclang's MinGW sysroots have them.
The `*-windows-gnu` targets link libgcc and msvcrt instead, and
`xclang cargo` refuses them, naming the `*-windows-gnullvm` target.

## Targets

| Rust target | xclang target | from | status |
|---|---|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | the same | any host | Supported |
| `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl` | the same, [static](#static-programs-with-musl) | any host | Supported |
| `x86_64-pc-windows-gnullvm`, `aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | any host | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | macOS hosts | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | [Linux and Windows hosts](#macos-from-linux-and-windows) | Supported |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | the same, [MSVC targets](#the-msvc-abi) | any host | Supported |

`xclang cargo` builds for these, and refuses another target. CI builds the
example, a crate of C, C++ (exceptions, `std::format`), a CMake project
and bindgen's bindings, and the `xclang` command itself for each of them,
from Linux, macOS and Windows hosts, and runs the programs on a machine of
their target ([testing](../dev/testing.md#the-xclang-command)).

## What xclang cargo Sets

`xclang cargo` sets cargo's variables of each target in the environment
of cargo, which it then runs. A variable the environment has already is
left as it is, and the project's or the user's cargo config, and
`RUSTFLAGS`, stay in effect.

| variable | |
|---|---|
| `CARGO_TARGET_<TARGET>_LINKER` | `xclang` itself, as `<Rust target>-linker` in xclang's cache: it runs the toolchain's clang with the target's `--target`, or for the MSVC targets lld-link with the Windows SDK in use (below) |
| `CC_<target>`, `CXX_<target>`, `AR_<target>`, `RANLIB_<target>` | the toolchain's `clang`, `clang++`, `llvm-ar` (`llvm-lib` for MSVC) and `llvm-ranlib`. The `cc` crate passes them a `--target` of its own, whose config file has the sysroot and the runtimes |
| `CXXSTDLIB_<target>` | `c++`: the `cc` crate links libc++ for C++ code, not libstdc++ |
| `CMAKE_TOOLCHAIN_FILE_<target>` | a file in xclang's cache that includes the toolchain's `lib/cmake/xclang/toolchain.cmake` for the target ([CMake](cmake.md)): the `cmake` crate's builds |
| `CMAKE_GENERATOR_<target>` | MSVC targets, and every target on Windows: Ninja (off Windows, Unix Makefiles without Ninja), where the `cmake` crate would take Visual Studio's generator |
| `BINDGEN_EXTRA_CLANG_ARGS_<target>` | `--target` and the header directories of the toolchain's clang for the target, for the libclang bindgen loads, the system's or another (`LIBCLANG_PATH`); followed by what the variable had |
| `CARGO_TARGET_<TARGET>_RUSTFLAGS` | MSVC targets: `-Ctarget-feature=+crt-static`, joined to the configs' rustflags, so that build scripts see the static VC runtime |
| `MACOSX_DEPLOYMENT_TARGET` | macOS targets: 13.0, that of the toolchain's libc++ |
| `SDKROOT` | macOS targets, on Linux and Windows hosts: the fetched SDK in use |
| `PATH` | the toolchain's `bin/` first, for build scripts that run `clang` (ring, for arm64 Windows) |

The linker passes rustc's arguments on, but for what rustc links of its
own that xclang has in its place:

- **Linux**: `-lgcc_s`, the unwinder Rust's std names, becomes
  `-l:libunwind.a`, as xclang's `libgcc_s.a` is an empty stub; the
  `-B` to rustc's `gcc-ld`, which makes clang link with rustc's rust-lld
  on x86_64, is dropped.
- **musl**: rustc's own musl and startup files (`-Clink-self-contained`)
  are dropped, so that the program links xclang's musl, whose headers
  the crates' C code was compiled with.
- **MSVC**: the hybrid CRT, as xclang's clang links it: the VC runtime
  static, `libcmt` where rustc names `msvcrt`, and UCRT from Windows.
- **MinGW and macOS**: nothing but `--target`.

Before cargo runs, `xclang cargo` checks each target. It adds a missing
standard library with `rustup target add`, and names the
`xclang sdk fetch` of a missing vendor SDK. For cargo's commands that
build nothing (`metadata`, `tree`, `clean`, ...) it checks nothing.

The targets are those of `--target`, else of `build.target` (in
`--config`, `CARGO_BUILD_TARGET` or cargo's config files), else the
host's. xclang's cache is `$XCLANG_CACHE_DIR`, or `xclang` in the user's
cache directory (`~/.cache`, `~/Library/Caches`, `%LOCALAPPDATA%`): the
linkers, which are symbolic links to `xclang` (on Windows hard links, or
copies), and the CMake toolchain files, per toolchain.

## Static Programs with musl

From 23.1.2.10 on, Rust's musl targets link against xclang's musl.
`xclang cargo` drops the musl and the startup files that rustc ships, as
`-Clink-self-contained=no` does: the crates' C code is compiled against
the C library the program links. For `x86_64-unknown-linux-musl`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-unknown-linux-musl
```

The program has no program interpreter and loads nothing. rustc links it
with `-static-pie` for x64 and `-static` for arm64, its defaults for these
targets, and names `-lunwind` itself.

## macOS from Linux and Windows

macOS targets from Linux and Windows hosts need Apple's SDK, which
`xclang sdk fetch macos --accept-license` fetches
([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)). On macOS
hosts, the SDK is Xcode's. For `aarch64-apple-darwin`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target aarch64-apple-darwin
```

## The MSVC ABI

The MSVC targets need the Windows SDK, which
`xclang sdk fetch windows --accept-license` fetches
([MSVC targets](clang.md#msvc-targets)); on Windows hosts, Visual Studio
serves without it. For `x86_64-pc-windows-msvc`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang cargo build --release --target x86_64-pc-windows-msvc
```

It uses the hybrid CRT: the VC runtime linked statically, and UCRT as a
system DLL, the default of the MSVC targets. Built this way, `xclang/`
loads the same Windows DLLs as the MinGW build, and no vcruntime.

## Build for the Machine You Are On

Without `--target`, `xclang cargo build` builds for the host's target,
with xclang as the linker of the build scripts and proc macros too: on
Linux, the program needs glibc 2.17, with libc++ and libunwind linked in.
cargo does the same with a `--target` that is the host's. For other
targets, it links build scripts and proc macros with the host's linker:
the system's `cc`, or on Windows Visual Studio's `link.exe`.

## What the Programs Load

xclang's own command, `xclang/`, with the C code of ring and liblzma, is
built with xclang as its C compiler and linker for every host
([build pipeline](../dev/release-build.md#the-xclang-command)). It loads at
run time:

| target | loads |
|---|---|
| Linux | `libc.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`; glibc 2.17 at most |
| Windows (MinGW) | Windows DLLs (`kernel32`, `ntdll`, `advapi32`, `ws2_32`, `bcrypt`, `crypt32`) and UCRT (`api-ms-win-crt-*`); no libunwind, libc++ or winpthreads |
| macOS | `libSystem`, `libiconv`, the Security and CoreFoundation frameworks; macOS 13.0 |

## Without xclang cargo

Every target needs the linker, the `--target` of the linker, and the C
compiler of its crates, as variables of cargo's environment or of a
`.cargo/config.toml`. `RUSTFLAGS` in the environment replaces the
rustflags of the configs. For Linux arm64, from a Linux x64 or macOS
host:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
rustup target add aarch64-unknown-linux-gnu
export CC_aarch64_unknown_linux_gnu=clang CXX_aarch64_unknown_linux_gnu=clang++ AR_aarch64_unknown_linux_gnu=llvm-ar
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-Clink-arg=--target=aarch64-unknown-linux-gnu -Clink-arg=-l:libunwind.a"
cargo build --release --target aarch64-unknown-linux-gnu
```

The names follow the target: `CC_<target>` in lower case with `_`, and
`CARGO_TARGET_<TARGET>_*` in upper case. What the other targets need:

- **Linux**: `-Clink-arg=-l:libunwind.a`, as above. For
  `x86_64-unknown-linux-gnu`, also `-Clinker-features=-lld`, or rustc
  links with its own rust-lld there.
- **musl**: `-Clink-arg=--target=<target> -Clink-self-contained=no`, and
  no `-l:libunwind.a`.
- **Windows (MinGW)**: `-Clink-arg=--target=<arch>-w64-mingw32`.
- **macOS**: `-Clink-arg=--target=<target>` and
  `MACOSX_DEPLOYMENT_TARGET=13.0`; on Linux and Windows hosts also
  `SDKROOT=$(xclang sdk path macos)`.
- **MSVC**: `lld-link` as the linker, with
  `-Ctarget-feature=+crt-static` and the link arguments
  `/winsysroot:<the SDK, xclang sdk path windows>`,
  `/nodefaultlib:libucrt.lib`, `/defaultlib:ucrt.lib` and `/ignore:4099`;
  `clang` as the C compiler, with `-Xmicrosoft-windows-sys-root <the SDK>`
  in `CFLAGS_<target>` and `CXXFLAGS_<target>`, and `llvm-lib` as the
  archiver.

Build scripts get the rustflags of `CARGO_TARGET_<TARGET>_RUSTFLAGS` only
when no `--target` is given: for the target of the machine itself, build
without `--target`, with the flags in `RUSTFLAGS`.

## Not Yet Supported

| | status |
|---|---|
| [`xclang cargo`](../design/roadmap.md#cargo-helper) | Unreleased |
| [Rust targets for other Linux architectures](../design/roadmap.md#linux-architectures) | Considered |
| [`libgcc_s.a` as a linker script](../design/roadmap.md#libgcc-s-script), so Linux targets need no `-l:libunwind.a` | Considered |
