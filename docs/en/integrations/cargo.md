# Rust and cargo

xclang can be the C compiler and the linker of cargo builds for other
targets, the way cargo-zigbuild uses zig: crates' C code (`cc`) and Rust's
own linking go through xclang's clang and lld, with xclang's sysroots and
static runtimes, so the result has xclang's [hermeticity](../design/hermeticity.md).
What follows is what builds xclang's own command (`cli/`, with ring's and
liblzma's C code) for every host; `scripts/cli.ts` and `tests/cargo.ts` do
exactly this. This is a seed: no `xclang cargo` helper exists yet.

What is tested, and where (cli.yml):

- Linux and MinGW targets: `scripts/cli.ts` builds `cli/` this way from
  Linux x64 for both Linux and both Windows hosts, and from macOS arm64 for
  both macOS hosts, with a released xclang, and checks what each binary
  loads; the binaries then run their tests on a machine of each host.
- macOS and MSVC targets from Linux: `tests/cargo.ts`, with the SDKs
  fetched by `xclang sdk fetch`. That command is built from `cli/` and is
  in no release yet ([the xclang command](../reference/xclang-command.md)),
  so the `xclang sdk` lines below need a build of it.

## Targets

| Rust target | xclang target | from | linker |
|---|---|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | the same | any host | `clang` |
| `x86_64-pc-windows-gnullvm`, `aarch64-pc-windows-gnullvm` | `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | any host | `clang` |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | the same | macOS; any host with `xclang sdk fetch macos` | `clang` |
| `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | — | any host with `xclang sdk fetch windows` | `lld-link` |

The MinGW targets are Rust's `*-windows-gnullvm` ones, whose std links
libunwind and UCRT as xclang's MinGW sysroots have them, not `*-windows-gnu`
(libgcc, msvcrt).

## Per target

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

**macOS**: on macOS the SDK is Xcode's; elsewhere, the fetched one:

```sh
export CARGO_TARGET_<T>_LINKER=$X/bin/clang
export CARGO_TARGET_<T>_RUSTFLAGS="-Clink-arg=--target=<triple>"
export MACOSX_DEPLOYMENT_TARGET=13.0
export SDKROOT=$(xclang sdk path macos)      # not on macOS
```

rustc passes `SDKROOT` to the linker and the `cc` crate to clang.

**Windows (MSVC ABI)**, with the hybrid CRT (the VC runtime linked
statically, UCRT a system DLL, as xclang's MSVC targets are to default
to):

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

## The target of the build machine

cargo links build scripts with the linker of the host's triple, but gives
them `CARGO_TARGET_<T>_RUSTFLAGS` only without `--target`. So for the
machine's own target, build without `--target` and put the flags in
`RUSTFLAGS`: the build scripts link like the program (on Linux, with
libunwind). Builds for other targets link their build scripts with the
system's `cc`.

## What it gives

From Linux x64 (Windows and Linux), macOS arm64 (macOS), and with the
fetched SDKs from Linux (macOS, MSVC), `cli/` built this way loads at run
time:

| target | loads |
|---|---|
| Linux | `libc.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`; glibc 2.17 at most |
| Windows (MinGW, MSVC) | OS DLLs (`kernel32`, `ntdll`, `advapi32`, `ws2_32`, `bcrypt`, `crypt32`) and UCRT (`api-ms-win-crt-*`); no libunwind, libc++, winpthreads, vcruntime |
| macOS | `libSystem`, `libiconv`, the Security and CoreFoundation frameworks; macOS 13.0 |

## Open

- An `xclang cargo` (or `xclang env <target>`) that sets the above, as
  cargo-zigbuild's wrapper does.
- `libgcc_s.a` as a linker script, `INPUT(-lunwind)`, instead of an empty
  archive would make `-l:libunwind.a` unneeded on Linux: tried with
  23.1.2.5's aarch64 sysroot, Rust links without it and C++ programs and
  shared libraries naming `-lgcc_s` still link.
- Rust targets xclang has no target for yet (musl, other architectures)
  follow with the targets of the [roadmap](../design/roadmap.md).
