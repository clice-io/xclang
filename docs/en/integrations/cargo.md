# Rust and Cargo

xclang works as the C compiler and the linker of cargo builds, the way
cargo-zigbuild uses zig. Crates' C code (the `cc` crate) and the link of
Rust programs go through xclang's clang and lld, with its sysroots and
static runtimes. The program then needs nothing but the OS
([hermeticity](../design/hermeticity.md)).

It is a recipe of cargo settings per target. A helper that sets them,
`xclang cargo`, is [considered](../design/roadmap.md#cargo-helper).

## Prerequisites

- xclang's `bin/` first in `PATH`, as `pixi shell` has it
  ([installation](../guide/install.md)).
- rustup, with the standard library of each target. In the example,
  `rustup toolchain install` installs what `rust-toolchain.toml` names;
  elsewhere, `rustup target add <Rust target>` adds one.

## Build for Windows from Linux or macOS

The example is a Rust program that calls a C function, in
[examples/cargo](https://github.com/clice-io/xclang/tree/main/examples/cargo).
Its commands run in that directory, in a `pixi shell` after `pixi install`.
`.cargo/config.toml` makes xclang the linker of the Windows targets, and the
C compiler of their crates:

<!-- file: examples/cargo/.cargo/config.toml -->
```toml
# xclang's clang, first in PATH (pixi shell, or an unpacked xclang/bin), links
# Rust's MinGW targets and compiles crates' C code for them. Build scripts,
# built for this machine, are linked by the system's cc. RUSTFLAGS in the
# environment would replace the rustflags here.
[target.x86_64-pc-windows-gnullvm]
linker = "clang"
rustflags = ["-Clink-arg=--target=x86_64-w64-mingw32"]

[target.aarch64-pc-windows-gnullvm]
linker = "clang"
rustflags = ["-Clink-arg=--target=aarch64-w64-mingw32"]

[env]
CC_x86_64_pc_windows_gnullvm = "clang"
AR_x86_64_pc_windows_gnullvm = "llvm-ar"
CC_aarch64_pc_windows_gnullvm = "clang"
AR_aarch64_pc_windows_gnullvm = "llvm-ar"
```

`rust-toolchain.toml` pins the Rust release and adds both targets:

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
cargo build --release --target x86_64-pc-windows-gnullvm
cargo build --release --target aarch64-pc-windows-gnullvm
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
The `*-windows-gnu` targets link libgcc and msvcrt instead.

## Targets

| Rust target | xclang target | from | status |
|---|---|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | the same | any host | Supported |
| `x86_64-pc-windows-gnullvm`, `aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | any host | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | macOS hosts | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | [Linux and Windows hosts](../design/roadmap.md#macos-any-host) | Unreleased |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | [MSVC targets](../design/roadmap.md#msvc) | any host | Unreleased |

## Settings per Target

Every target needs the linker, the `--target` of the linker, and the C
compiler of its crates. These are environment variables; the
`.cargo/config.toml` above is the same for the Windows targets. For Linux
arm64, from a Linux x64 or macOS host:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
rustup target add aarch64-unknown-linux-gnu
export CC_aarch64_unknown_linux_gnu=clang CXX_aarch64_unknown_linux_gnu=clang++ AR_aarch64_unknown_linux_gnu=llvm-ar
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-Clink-arg=--target=aarch64-unknown-linux-gnu -Clink-arg=-l:libunwind.a"
cargo build --release --target aarch64-unknown-linux-gnu
```

The names follow the target: `CC_<target>` in lower case with `_`, and
`CARGO_TARGET_<TARGET>_*` in upper case.

- **Linux** needs `-Clink-arg=-l:libunwind.a`. Rust's std links with
  `-nodefaultlibs` and names `-lgcc_s` for its unwinder, and xclang's
  `libgcc_s.a` is an empty stub. For `x86_64-unknown-linux-gnu`, also add
  `-Clinker-features=-lld`, or rustc links with its own rust-lld there.
- **Windows** needs `-Clink-arg=--target=<arch>-w64-mingw32`, as above.
- **macOS**, on a macOS host, needs `-Clink-arg=--target=<target>` and
  `MACOSX_DEPLOYMENT_TARGET=13.0`. The SDK is Xcode's.

## Build for the Machine You Are On

cargo links build scripts with the linker of the host, but gives them
`CARGO_TARGET_<TARGET>_RUSTFLAGS` only when no `--target` is given. So for
the target of the machine itself, build without `--target`, and put the
flags in `RUSTFLAGS`. The build scripts then link like the program, on
Linux with libunwind. Builds for other targets link their build scripts
with the `cc` of the system.

## What the Programs Load

xclang's own command, `cli/`, with the C code of ring and liblzma, is built
this way for every host
([build pipeline](../dev/release-build.md#the-xclang-command)). It loads at
run time:

| target | loads |
|---|---|
| Linux | `libc.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`; glibc 2.17 at most |
| Windows (MinGW) | Windows DLLs (`kernel32`, `ntdll`, `advapi32`, `ws2_32`, `bcrypt`, `crypt32`) and UCRT (`api-ms-win-crt-*`); no libunwind, libc++ or winpthreads |
| macOS | `libSystem`, `libiconv`, the Security and CoreFoundation frameworks; macOS 13.0 |

## macOS from Linux and Windows

::: warning Unreleased
macOS targets from Linux and Windows hosts are
[unreleased](../design/roadmap.md#macos-any-host). They need Apple's SDK
from the [unreleased](../design/roadmap.md#xclang-command) `xclang` command.
CI runs this recipe from Linux; no release supports it.
:::

Use the macOS settings above, and name the fetched SDK. rustc passes
`SDKROOT` to the linker, and the `cc` crate passes it to clang:

<!-- not run: unreleased, as is the xclang command; cli.yml runs this recipe through tests/cargo.ts -->
```sh
export SDKROOT=$(xclang sdk path macos)
```

## The MSVC ABI

::: warning Unreleased
MSVC targets are [unreleased](../design/roadmap.md#msvc), and the Windows
SDK comes from the [unreleased](../design/roadmap.md#xclang-command)
`xclang` command. CI runs this recipe from Linux; no release supports it. Built this
way, `cli/` loads the same Windows DLLs as the MinGW build, and no
vcruntime.
:::

It uses the hybrid CRT: the VC runtime linked statically, and UCRT as a
system DLL. That is the default of the MSVC targets. For
`x86_64-pc-windows-msvc`:

<!-- not run: unreleased, as is the xclang command; cli.yml runs this recipe through tests/cargo.ts -->
```sh
W=$(xclang sdk path windows)
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-Ctarget-feature=+crt-static -Clink-arg=/winsysroot:$W \
  -Clink-arg=/nodefaultlib:libucrt.lib -Clink-arg=/defaultlib:ucrt.lib -Clink-arg=/ignore:4099"
export CC_x86_64_pc_windows_msvc=clang CFLAGS_x86_64_pc_windows_msvc="-Xmicrosoft-windows-sys-root $W"
export CXX_x86_64_pc_windows_msvc=clang++ CXXFLAGS_x86_64_pc_windows_msvc="-Xmicrosoft-windows-sys-root $W"
export AR_x86_64_pc_windows_msvc=llvm-lib
```

The C compiler stays `clang`, not `clang-cl`: ring passes it GNU options,
and builds its arm64 Windows assembly with a `clang` from `PATH`.
`/ignore:4099` silences the warning about the PDBs that the objects of the
VC runtime name, which are not shipped.

## Not Yet Supported

| | status |
|---|---|
| [An `xclang cargo` helper](../design/roadmap.md#cargo-helper) that sets the settings above | Considered |
| [macOS targets from Linux and Windows hosts](../design/roadmap.md#macos-any-host) | Unreleased |
| [MSVC targets](../design/roadmap.md#msvc) | Unreleased |
| [musl targets](../design/roadmap.md#musl) | Planned |
| [Rust targets for other Linux architectures](../design/roadmap.md#linux-architectures) | Considered |
| [`libgcc_s.a` as a linker script](../design/roadmap.md#libgcc-s-script), so Linux targets need no `-l:libunwind.a` | Considered |
