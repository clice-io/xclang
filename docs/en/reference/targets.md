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
| `aarch64-apple-darwin` | `arm64-apple-darwin`, `arm64-apple-macos`, `aarch64-apple-macosx`, ... | the SDK's libSystem | macOS 13.0 or later | macOS hosts |
| `x86_64-apple-darwin` | `x86_64-apple-macos`, `x86_64-apple-macosx` | the SDK's libSystem | macOS 13.0 or later | macOS hosts |
| `x86_64-pc-windows-msvc`, [unreleased](../design/roadmap.md#msvc) | `x86_64-unknown-windows-msvc` | Microsoft's CRT and STL, the hybrid CRT | Windows 10 or later | every host, with the SDK `xclang` fetches |
| `aarch64-pc-windows-msvc`, [unreleased](../design/roadmap.md#msvc) | `aarch64-unknown-windows-msvc` | Microsoft's CRT and STL, the hybrid CRT | Windows 10 or later | every host, with the SDK `xclang` fetches |

All six are tier 1. The macOS targets build on macOS hosts only, because
they need Apple's SDK, which comes from Xcode there
([macOS](../design/macos.md#the-sdk-is-xcode-s)). The MSVC targets are
tier 1 too: CI runs their programs on Windows x64 and arm64 runners
([MSVC targets](../integrations/clang.md#msvc-targets)).

## What Each Target Has

| | Linux | Windows (MinGW) | macOS | Windows (MSVC) |
|---|---|---|---|---|
| C++ library | libc++, libc++abi, static | libc++, libc++abi, static | libc++, libc++abi, static (not the system's `libc++.dylib`) | Microsoft's STL, static |
| unwinder | libunwind, static | libunwind, static | the system's (libSystem) | the VC runtime's, static |
| compiler-rt builtins, profile | Supported | Supported | Supported | Unreleased |
| ASan, TSan, LSan, UBSan, libFuzzer | Supported | Considered | Supported | Unreleased: UBSan; ASan and libFuzzer for x64 |
| ASan libc++ | Supported | Considered | Supported | none: the STL |
| linker | ld.lld | ld.lld (MinGW driver) | ld64.lld; `-fuse-ld=ld` for Apple's | lld-link |

Sanitizers for the MinGW targets are
[considered](../design/roadmap.md#mingw-sanitizers); those of the MSVC
targets are part of the [MSVC targets](../design/roadmap.md#msvc).

## Tiers

Each target has a tier, as Rust's targets do. The tier says how a target
is tested, and so how much a release promises about it.

- **Tier 1**: built for every release, and its tests run on a
  GitHub-hosted runner of the target itself; a failure stops the release.
- **Tier 2**: built for every release, and its tests run under emulation or
  virtualization: qemu, a virtual machine, Android's emulator, Apple's
  simulators.
- **Tier 3**: programs are compiled and linked for it, not run.

For today's six, that means programs built on every host run on a runner of
their target, with no emulator
([testing](../dev/testing.md#cross-compiling)).

## Not Yet Supported

| | status |
|---|---|
| [MSVC targets](../design/roadmap.md#msvc), with their sanitizers | Unreleased |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [macOS targets from Linux and Windows hosts](../design/roadmap.md#macos-any-host) | In research |

Every other target, with its planned tier and its status, is in the
[roadmap](../design/roadmap.md#targets).
