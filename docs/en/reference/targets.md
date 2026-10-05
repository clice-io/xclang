# Targets and Tiers

## Hosts

A host is a machine the toolchain runs on. Each has its own archive, and
every archive carries every target.

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

All six are tier 1. The macOS targets build on macOS hosts only, because
they need Apple's SDK, which comes from Xcode there. macOS from any host,
with the SDK fetched from Apple by the user, is
[in research](../design/roadmap.md#macos-any-host).

What each target has:

| | Linux | Windows | macOS |
|---|---|---|---|
| libc++, libc++abi | static | static | static (not the system's `libc++.dylib`) |
| unwinder | libunwind, static | libunwind, static | the system's (libSystem) |
| compiler-rt builtins, profile | yes | yes | yes |
| ASan, TSan, LSan, UBSan, libFuzzer | yes | no | yes |
| libc++'s ASan build | yes | no | yes |
| linker | ld.lld | ld.lld (MinGW driver) | ld64.lld; `-fuse-ld=ld` for Apple's |

## Tiers

Each target has a tier, as Rust's targets do. The tier says how a target
is tested, and so how much a release promises about it.

- **Tier 1**: built for every release, and its tests run on a
  GitHub-hosted runner of the target itself; a failure stops the release.
- **Tier 2**: built for every release, and its tests run under emulation or
  virtualization: qemu, a virtual machine, Android's emulator, Apple's
  simulators.
- **Tier 3**: programs are compiled and linked for it, not run.

What "its tests run on the target itself" means for today's six:

- tests/smoke.ts builds C and C++ programs for every target on every host,
  and runs those the machine can run (its own target; x86_64 macOS
  programs on arm64 macOS through Rosetta; x86_64 Windows programs on
  Windows on Arm).
- bazel.yml builds tests/bazel on every host for every other target it
  builds for, 22 host-to-target pairs, and runs the tests on a machine of
  the target: Linux-built Windows programs on Windows, Windows-built Linux
  programs on Linux, and so on. No emulator is involved.
- examples.yml runs the quick start on every host.

## Not Yet Supported

| | status |
|---|---|
| [Sanitizers for MSVC targets](../design/roadmap.md#msvc), with the MSVC targets | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [macOS targets from Linux and Windows hosts](../design/roadmap.md#macos-any-host) | In research |

Every other target, with its planned tier and its status, is in the
[roadmap](../design/roadmap.md#targets).
