# Targets and Tiers

The hosts xclang runs on, the targets it builds for, and how each is tested.
How to build for another target is in
[cross-compiling](../guide/cross-compiling.md).

## Hosts

A host is a machine the toolchain runs on. Each has its own archive, and
every archive carries every target. The "tested on" column names the
GitHub-hosted runner.

| host | archive built on | tested on |
|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64 | ubuntu-24.04 |
| `aarch64-unknown-linux-gnu` | Linux x64, cross-compiled | ubuntu-24.04-arm |
| `x86_64-w64-mingw32` | Linux x64, cross-compiled; the toolchain is a MinGW program | windows-2025 |
| `aarch64-w64-mingw32` | Linux x64, cross-compiled | windows-11-arm |
| `aarch64-apple-darwin` | macOS arm64 | macos-15 |
| `x86_64-apple-darwin` | macOS arm64, cross-compiled | macos-15-intel |

## Targets

| target | also spelled | C runtime | runs on | builds on |
|---|---|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-pc-linux-gnu`, `x86_64-linux-gnu` (Bazel) | glibc 2.17 | glibc 2.17 or later | every host |
| `aarch64-unknown-linux-gnu` | `aarch64-pc-linux-gnu`, `aarch64-linux-gnu` (Bazel) | glibc 2.17 | glibc 2.17 or later | every host |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu`, `x86_64-pc-windows-gnu` | mingw-w64 with UCRT | Windows 10 or later | every host |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu`, `aarch64-pc-windows-gnu` | mingw-w64 with UCRT | Windows 10 or later | every host |
| `aarch64-apple-darwin` | `arm64-apple-darwin`, `arm64-apple-macos`, `aarch64-apple-macosx`, ... | the SDK's libSystem | macOS 13.0 or later | macOS hosts; Linux and Windows hosts with the SDK `xclang` fetches |
| `x86_64-apple-darwin` | `x86_64-apple-macos`, `x86_64-apple-macosx` | the SDK's libSystem | macOS 13.0 or later | macOS hosts; Linux and Windows hosts with the SDK `xclang` fetches |
| `x86_64-pc-windows-msvc` | `x86_64-unknown-windows-msvc` | Microsoft's CRT, the hybrid CRT | Windows 10 or later | every host, with the SDK `xclang` fetches |
| `aarch64-pc-windows-msvc` | `aarch64-unknown-windows-msvc` | Microsoft's CRT, the hybrid CRT | Windows 10 or later | every host, with the SDK `xclang` fetches |
| `x86_64-unknown-linux-musl` | `x86_64-pc-linux-musl`, `x86_64-linux-musl` | musl 1.2.6, linked statically | any Linux x64 | every host, from 23.1.2.10 on |
| `aarch64-unknown-linux-musl` | `aarch64-pc-linux-musl`, `aarch64-linux-musl` | musl 1.2.6, linked statically | any Linux arm64 | every host, from 23.1.2.10 on |

All of them are tier 1. The macOS targets need Apple's SDK, which comes from
Xcode on macOS hosts ([macOS](../design/macos.md#the-sdk-is-xcode-s)). On
Linux and Windows hosts they build with the SDK the user fetches from
Apple ([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)),
and CI runs those programs on arm64 and x64 Macs. The MSVC targets are
tier 1 too: CI
runs their programs on Windows x64 and arm64 runners
([MSVC targets](../integrations/clang.md#msvc-targets)). So are the musl
targets, which every archive carries from 23.1.2.10 on: their programs are
static, need no glibc, and run on the Linux x64 and arm64 runners
([musl](#musl-targets)).

## What Each Target Has

| | Linux | Linux (musl) | Windows (MinGW) | macOS | Windows (MSVC) |
|---|---|---|---|---|---|
| C library | glibc 2.17, the system's | musl, static | UCRT, the system's | libSystem, the system's | UCRT, the system's |
| C++ library | libc++, libc++abi, static | libc++, libc++abi, static | libc++, libc++abi, static | libc++, libc++abi, static (not the system's `libc++.dylib`) | libc++ on the VC runtime, static; Microsoft's STL with `-stdlib=platform` |
| unwinder | libunwind, static | libunwind, static | libunwind, static | the system's (libSystem) | the VC runtime's, static |
| compiler-rt builtins, profile | Supported | Supported | Supported | Supported | Supported |
| ASan, TSan, LSan, UBSan, libFuzzer | Supported | UBSan only | Considered | Supported | Supported: UBSan; ASan and libFuzzer for x64 |
| ASan libc++ | Supported | none | Considered | Supported | Supported, x64 |
| linker | ld.lld | ld.lld | ld.lld (MinGW driver) | ld64.lld; `-fuse-ld=ld` for Apple's, without LTO | lld-link |

Sanitizers for the MinGW targets are
[considered](../design/roadmap.md#mingw-sanitizers); those of the MSVC
targets are in [sanitizers](../features/sanitizers.md#msvc-targets), those
of musl in [sanitizers](../features/sanitizers.md#musl-targets).

## musl Targets

`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl`, from 23.1.2.10
on, link musl and every runtime into the program, as Rust's targets of the
same names do. The program has no program interpreter and no dynamic
section: it takes nothing from the system it runs on, glibc included, and
runs on any Linux distribution of its architecture.

- **musl 1.2.6**, with the patches of musl's security advisories against
  it, built by xclang, and the UAPI headers of Linux 6.18, the newest
  long-term kernel ([layout](layout.md#sysroots)).
- **Static by default**: the config file passes `-static`, so a program is
  an `EXEC` file. `-static-pie` makes it position-independent, for address
  space layout randomization of the program itself; that cost 5% more size and
  2 to 5% more time to start a hello world in C and C++, measured on Linux
  x64. A `-static-pie` in the config file would have made `-no-pie` an
  error, which CMake and rustc pass.
- **No shared libraries**: there is no `libc.so`, so no dynamic linking
  against musl, no `dlopen` of a library, and no `-shared` library for a
  musl system such as Alpine.
- **UBSan only**, of the sanitizers
  ([sanitizers](../features/sanitizers.md#musl-targets)).

How musl behaves apart from glibc (locales, DNS, `malloc`) is in
[compatibility](compatibility.md#known-limitations).

## Tiers

Each target has a tier, as Rust's targets do. The tier says how a target
is tested, and so how much a release promises about it.

- **Tier 1**: built for every release, and its tests run on a
  GitHub-hosted runner of the target itself; a failure stops the release.
- **Tier 2**: built for every release, and its tests run under emulation or
  virtualization: qemu, a virtual machine, Android's emulator, Apple's
  simulators.
- **Tier 3**: programs are compiled and linked for it, not run.

For the targets of every archive, that means programs built on every host
run on a runner of their target, with no emulator
([testing](../dev/testing.md#cross-compiling)).

## Not Yet Supported

| | status |
|---|---|
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |

Every other target, with its planned tier and its status, is in the
[roadmap](../design/roadmap.md#targets).
