# Rust and Cargo

xclang works as the C compiler and the linker of cargo builds: for Linux and
MinGW targets from any host, and for macOS targets from macOS hosts. It
works the way cargo-zigbuild uses zig. Crates' C code (`cc`) and Rust's own
linking go through xclang's clang and lld, with xclang's sysroots and static
runtimes, so the result has xclang's
[hermeticity](../design/hermeticity.md). The setup is the environment
variables below. A helper that sets them, `xclang cargo`, is
[considered](../design/roadmap.md#cargo-helper).

The recipe is what builds xclang's own command (`cli/`, with ring's and
liblzma's C code) for every host: `scripts/cli.ts` builds it from Linux
x64 for both Linux and both Windows hosts, and from macOS arm64 for both
macOS hosts, with a released xclang. The binaries then run their tests on
a machine of each host (cli.yml).

## Targets

| Rust target | xclang target | from | status |
|---|---|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | the same | any host | Supported |
| `x86_64-pc-windows-gnullvm`, `aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | any host | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | macOS hosts | Supported |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | [Linux and Windows hosts](../design/roadmap.md#macos-any-host) | In research |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | [MSVC targets](../design/roadmap.md#msvc) | any host | Planned |

The MinGW targets are Rust's `*-windows-gnullvm` ones, whose std links
libunwind and UCRT as xclang's MinGW sysroots have them, not `*-windows-gnu`
(libgcc, msvcrt).

## Per Target

For a target `<T>` (`CARGO_TARGET_<T>_*` in upper case with `_`,
`CC_<t>` with `_`), with `X` the toolchain:

```sh
# every target: crates' C code
export CC_<t>=$X/bin/clang CXX_<t>=$X/bin/clang++ AR_<t>=$X/bin/llvm-ar
```

**Linux (glibc 2.17)**:

```sh
export CARGO_TARGET_<T>_LINKER=$X/bin/clang
export CARGO_TARGET_<T>_RUSTFLAGS="-Clink-arg=--target=<triple> -Clink-arg=-l:libunwind.a"
# x86_64 only: link with xclang's lld, not the rust-lld rustc brings
#   (it is the default there): add -Clinker-features=-lld
```

Rust's std links with `-nodefaultlibs` and names `-lgcc_s` for its
unwinder; xclang's `libgcc_s.a` is an empty stub (GCC's names, for build
scripts that want them), so libunwind is named by hand.

**Windows (MinGW, UCRT)**:

```sh
export CARGO_TARGET_<T>_LINKER=$X/bin/clang
export CARGO_TARGET_<T>_RUSTFLAGS="-Clink-arg=--target=<arch>-w64-mingw32"
```

**macOS**: on macOS the SDK is Xcode's.

```sh
export CARGO_TARGET_<T>_LINKER=$X/bin/clang
export CARGO_TARGET_<T>_RUSTFLAGS="-Clink-arg=--target=<triple>"
export MACOSX_DEPLOYMENT_TARGET=13.0
```

::: info In research
macOS targets from Linux and Windows hosts are
[in research](../design/roadmap.md#macos-any-host). They need Apple's SDK
from the [unreleased](../design/roadmap.md#xclang-command) `xclang` command;
CI runs this recipe (tests/cargo.ts), and no release supports it:

```sh
export SDKROOT=$(xclang sdk path macos)
```

rustc passes `SDKROOT` to the linker, and the `cc` crate passes it to
clang.
:::

## The Target of the Build Machine

cargo links build scripts with the linker of the host's triple, but gives
them `CARGO_TARGET_<T>_RUSTFLAGS` only without `--target`. So for the
machine's own target, build without `--target` and put the flags in
`RUSTFLAGS`: the build scripts link like the program (on Linux, with
libunwind). Builds for other targets link their build scripts with the
system's `cc`.

## What It Gives

From Linux x64 (Windows and Linux) and macOS arm64 (macOS), `cli/` built
this way loads at run time:

| target | loads |
|---|---|
| Linux | `libc.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`; glibc 2.17 at most |
| Windows (MinGW) | OS DLLs (`kernel32`, `ntdll`, `advapi32`, `ws2_32`, `bcrypt`, `crypt32`) and UCRT (`api-ms-win-crt-*`); no libunwind, libc++ or winpthreads |
| macOS | `libSystem`, `libiconv`, the Security and CoreFoundation frameworks; macOS 13.0 |

## The MSVC ABI

::: info Planned
MSVC targets are [planned](../design/roadmap.md#msvc), and the Windows SDK
comes from the [unreleased](../design/roadmap.md#xclang-command) `xclang`
command. CI runs this recipe from Linux (tests/cargo.ts); no release
supports it. Built this way, `cli/` loads the same Windows DLLs as the MinGW
build, and no vcruntime.
:::

It uses the hybrid CRT: the VC runtime linked statically, and UCRT as a
system DLL. That is the default of the [planned](../design/roadmap.md#msvc)
MSVC targets.

```sh
W=$(xclang sdk path windows)
export CARGO_TARGET_<T>_LINKER=$X/bin/lld-link
export CARGO_TARGET_<T>_RUSTFLAGS="-Ctarget-feature=+crt-static -Clink-arg=/winsysroot:$W \
  -Clink-arg=/nodefaultlib:libucrt.lib -Clink-arg=/defaultlib:ucrt.lib -Clink-arg=/ignore:4099"
export CFLAGS_<t>="-Xmicrosoft-windows-sys-root $W" CXXFLAGS_<t>="-Xmicrosoft-windows-sys-root $W"
export AR_<t>=$X/bin/llvm-lib
export PATH=$X/bin:$PATH
```

`CC_<t>` stays `clang`, not `clang-cl`: ring passes the C compiler GNU
options, and builds its arm64 Windows assembly with a `clang` from `PATH`.
`/ignore:4099`: the VC runtime's objects name PDBs that are not shipped.

## Not Yet Supported

| | status |
|---|---|
| [An `xclang cargo` helper](../design/roadmap.md#cargo-helper) that sets the variables above | Considered |
| [macOS targets from Linux and Windows hosts](../design/roadmap.md#macos-any-host) | In research |
| [MSVC targets](../design/roadmap.md#msvc) | Planned |
| [musl targets](../design/roadmap.md#musl) | Planned |
| [Rust targets for other Linux architectures](../design/roadmap.md#linux-architectures) | Considered |
| [`libgcc_s.a` as a linker script](../design/roadmap.md#libgcc-s-script), so Linux targets need no `-l:libunwind.a` | Considered |
