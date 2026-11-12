# Cross-Compiling

Pass `--target=<triple>` to `clang` or `clang++` to compile and link for
another target. Every host archive contains the compiler, `lld`, and the
sysroots, prebuilt runtimes and config files for all targets, so cross-compiling
needs no external sysroot or wrapper script.

## Build for Another Target

From the [quick start](../guide/quick-start.md) directory (`examples/quickstart`),
compile `hello.cpp` for Windows on Arm:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

## Targets and Hosts

The same `--target` flag builds for any of xclang's ten targets:

| target | other spellings | C library | runs on | builds on | tier |
|---|---|---|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-pc-linux-gnu`, `x86_64-linux-gnu` | glibc 2.17 | [Linux](linux.md) x64, glibc 2.17 or later | every host | 1 |
| `aarch64-unknown-linux-gnu` | `aarch64-pc-linux-gnu`, `aarch64-linux-gnu`, `arm64-linux-gnu`, `arm64-unknown-linux-gnu`, `arm64-pc-linux-gnu` | glibc 2.17 | [Linux](linux.md) arm64, glibc 2.17 or later | every host | 1 |
| `x86_64-unknown-linux-musl` | `x86_64-pc-linux-musl`, `x86_64-linux-musl` | musl 1.2.6, static | any [Linux](linux.md) x64 | every host | 1 |
| `aarch64-unknown-linux-musl` | `aarch64-pc-linux-musl`, `aarch64-linux-musl`, `arm64-linux-musl`, `arm64-unknown-linux-musl`, `arm64-pc-linux-musl` | musl 1.2.6, static | any [Linux](linux.md) arm64 | every host | 1 |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu`, `x86_64-pc-windows-gnu` | mingw-w64 with UCRT | [Windows](windows.md) x64, 10 or later | every host | 1 |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu`, `aarch64-pc-windows-gnu`, `arm64-w64-mingw32`, `arm64-w64-windows-gnu`, `arm64-pc-windows-gnu` | mingw-w64 with UCRT | [Windows](windows.md) arm64, 10 or later | every host | 1 |
| `x86_64-pc-windows-msvc` | `x86_64-unknown-windows-msvc`, `x86_64-windows-msvc` | Microsoft's CRT (hybrid CRT) | [Windows](windows.md) x64, 10 or later | every host with the fetched [SDK](#vendor-sdks); Windows hosts also with Visual Studio | 1 |
| `aarch64-pc-windows-msvc` | `aarch64-unknown-windows-msvc`, `arm64-pc-windows-msvc`, `arm64-unknown-windows-msvc`, `arm64-windows-msvc` | Microsoft's CRT (hybrid CRT) | [Windows](windows.md) arm64, 10 or later | every host with the fetched [SDK](#vendor-sdks); Windows hosts also with Visual Studio | 1 |
| `aarch64-apple-darwin` | `arm64-apple-darwin`, `arm64-apple-macos`, `aarch64-apple-macos`, `aarch64-apple-macosx`, `arm64-apple-macosx` | the SDK's `libSystem` | [macOS](macos.md) arm64, 13.0 or later | macOS hosts; Linux and Windows hosts with the fetched [SDK](#vendor-sdks) | 1 |
| `x86_64-apple-darwin` | `x86_64-apple-macos`, `x86_64-apple-macosx` | the SDK's `libSystem` | [macOS](macos.md) x64, 13.0 or later | macOS hosts; Linux and Windows hosts with the fetched [SDK](#vendor-sdks) | 1 |

Every target links xclang's `libc++` and `compiler-rt` statically by default
and uses `lld` as its linker (`ld.lld`, `lld-link` or `ld64.lld`). Platform
details, sanitizers and limitations are on the [Linux](linux.md),
[Windows](windows.md) and [macOS](macos.md) pages. Fetching additional targets
on demand ([target archives for `xclang target add`](../design/roadmap.md#target-archives))
and targets for [more Linux architectures](../design/roadmap.md#linux-architectures),
[musl on riscv64 and armv7](../design/roadmap.md#musl-architectures),
[WebAssembly](../design/roadmap.md#wasm) and
[Android](../design/roadmap.md#android) are tracked on the
[roadmap](../design/roadmap.md#targets).

A host is a machine the toolchain runs on. Each host has its own archive
([installation](../guide/install.md#archives)), and every archive carries all
targets above:

| host | archive built on | tested on |
|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64 | `ubuntu-24.04` |
| `aarch64-unknown-linux-gnu` | Linux x64, cross-compiled | `ubuntu-24.04-arm` |
| `x86_64-w64-mingw32` | Linux x64, cross-compiled (the toolchain is a MinGW program) | `windows-2025` |
| `aarch64-w64-mingw32` | Linux x64, cross-compiled (the toolchain is a MinGW program) | `windows-11-arm` |
| `aarch64-apple-darwin` | macOS arm64 | `macos-15` |
| `x86_64-apple-darwin` | macOS arm64, cross-compiled | `macos-15-intel` |

## What the Toolchain Needs on the Host

| host | what the toolchain needs |
|---|---|
| Linux x64, arm64 | glibc 2.17 or later; nothing else (`clang` and `lld` link `libc++` statically) |
| macOS arm64, x64 | macOS 13 or later; for macOS targets, Xcode or the Command Line Tools (the SDK) |
| Windows x64, arm64 | Windows 10 or later (UCRT is part of the OS) |

## How Clang Finds a Target's Files

`clang` emits code for every architecture LLVM supports, and `lld` links ELF,
COFF and Mach-O. The compiler and linker are one multicall program for every
target, and xclang supplies the target sysroots, runtimes and configuration
files beside it ([toolchain structure](../design/toolchain.md)).

For each `--target`, `clang` reads `<triple>.cfg` from its own `bin/` directory
(`clang-cl` reads `<triple>-clang-cl.cfg`). The file is named after `clang`'s
normalized triple, with copies for the other spellings in the table above. For
`--target=aarch64-w64-mingw32`, `clang` reads `bin/aarch64-w64-windows-gnu.cfg`,
here without its comments:

```text
--sysroot=<CFGDIR>/../aarch64-w64-mingw32
-stdlib++-isystem <CFGDIR>/../libc++/include/aarch64-w64-windows-gnu/c++/v1
-stdlib++-isystem <CFGDIR>/../libc++/include/c++/v1
-idirafter <CFGDIR>/../mingw-w64/include
-rtlib=compiler-rt
-unwindlib=libunwind
-stdlib=libc++
-fuse-ld=lld
```

`<CFGDIR>` expands to `bin/`, so the config file points `clang` to the target's
sysroot directory, its `__config_site` and the shared `libc++` and `mingw-w64`
headers, `compiler-rt`, `libunwind`, `libc++`, and `lld`
([archive layout](../reference/layout.md)). No wrapper script, environment
variable or external state is involved, so the same command produces the same
compile and link actions on every machine.

The config files apply to native builds as well. Running `clang++ hello.cpp` on
Linux compiles against the bundled glibc 2.17 sysroot rather than the host's
`/usr/include` and `/usr/lib`, so a binary built on a new Linux distribution
runs on an older one.

Pass `--no-default-config` to skip the target config file and run a bare
upstream `clang` that looks for the system's headers, runtime libraries and
linker.

Every target follows the [hermeticity](../design/hermeticity.md) rule: a binary
depends at run time only on the system libraries that every installation of its
OS provides, and links everything else statically.

## The Platform's C++ Library

A program that passes C++ types across an interface to a library built with the
platform's C++ library, such as a Linux distribution's Qt or Boost or a Windows
library built with MSVC, must use that same C++ library. Pass
`-stdlib=platform` (or `-stdlib=libstdc++`; in `clang-cl`,
`/clang:-stdlib=platform`) to every compile and link command, C files included:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 -stdlib=platform hello.cpp -o hello
clang++ -O2 -stdlib=platform --target=x86_64-pc-windows-msvc hello.cpp -o hello.exe
```

The flag selects the target's second config file, `bin/<triple>-system.cfg` (or
`<triple>-clang-cl-system.cfg`, via [patch 0018](../reference/patches.md)).
That file keeps `lld`, the deployment target and the C runtime, and leaves out
xclang's `libc++` and bundled sysroot. The resulting binary then depends on the
platform's C++ runtime where it runs:

| target | C++ library | sysroot or SDK | loaded at run time |
|---|---|---|---|
| [Linux (glibc)](linux.md#the-platform-s-c-library) | GCC's `libstdc++`, shared | the host's, a distribution's cross packages (`g++-aarch64-linux-gnu`), or `--sysroot` | the system's `libstdc++.so.6` and `libgcc_s.so.1`, and the build's glibc (not 2.17) |
| [Linux (musl)](linux.md#the-platform-s-c-library) | the sysroot's `libstdc++` | `--sysroot`, such as an Alpine root | what that sysroot links |
| [Windows (MinGW)](windows.md#mingw-targets) | the sysroot's `libstdc++` | `--sysroot`, such as MSYS2's `ucrt64` or a directory linking a distribution's `mingw-w64` | what that sysroot links |
| [Windows (MSVC)](windows.md#libc-and-microsoft-s-stl) | Microsoft's STL | the fetched Windows SDK, or Visual Studio on Windows | nothing more: the STL is linked statically, with the hybrid CRT |
| [macOS](macos.md#xclang-s-libc-and-stdlib-platform) | the SDK's `libc++` | Xcode's SDK, or the SDK fetched with `xclang sdk fetch macos` | `/usr/lib/libc++.1.dylib` of the OS |

## Vendor SDKs

Two target families build against a vendor SDK that xclang cannot redistribute:

- **[macOS targets](macos.md)**: on macOS hosts, `clang` uses the SDK of Xcode
  or the Command Line Tools. On Linux and Windows hosts, run
  `xclang sdk fetch macos --accept-license` once to fetch the macOS SDK from
  Apple ([macOS on Linux and Windows](macos.md#on-linux-and-windows-hosts)).
- **[Windows MSVC targets](windows.md#msvc-targets)**: on any host, run
  `xclang sdk fetch windows --accept-license` once to fetch Microsoft's CRT,
  STL and Windows SDK. On a Windows host with no SDK fetched, `clang` uses an
  installed Visual Studio.

Every toolchain archive includes the `xclang` command
([the `xclang` command](../reference/xclang-command.md)). `xclang sdk fetch`
unpacks each SDK into `<toolchain>/sdk/` and points `<toolchain>/sdk/macos` or
`<toolchain>/sdk/windows` at the active SDK, so the target config files reference
a fixed path while SDK versions change. In Bazel, `MODULE.bazel` accepts the
license and a repository rule unpacks the SDK as an external repository
([Bazel](../integrations/bazel.md),
[the Bazel module](../design/bazel-module.md)).

### Why Vendor SDKs Are Fetched, Not Shipped

Apple's SDK agreement and Microsoft's Visual Studio license allow use, not
redistribution. A toolchain that bundles the SDKs, or a container image that
holds them, passes them on.

Instead, `xclang sdk fetch` downloads directly from Apple's and Microsoft's
servers so each user receives the SDK from the vendor under the vendor's terms,
and xclang's release archives remain free to redistribute:

- `xclang sdk fetch` prints the vendor's license terms and exits unless you
  pass `--accept-license`.
- Apple's terms allow use of the SDK on Apple hardware.
  Whether to build for macOS on Linux or Windows with it is the user's decision
  under those terms.
- Package URLs, sizes and `sha256` digests (and for Apple's packages, the
  content digest of the SDK inside each package) are pinned in
  `xclang/sdk-versions.json`, compiled into `xclang`. Its presets match
  GitHub's runner images (`macos-latest`, `windows-2025`, `windows-2022`, and
  others), so a cross build uses the same SDK versions as a workflow on that
  runner image.

## Tiers

Each target has a tier that states how it is tested for every release:

- **Tier 1**: built for every release, and its test binaries run on a native
  GitHub-hosted runner of the target without an emulator; a failure stops the
  release. All ten targets in the table above are tier 1.
- **Tier 2**: built for every release, and its tests run under emulation or
  virtualization (QEMU, a virtual machine, Android's emulator, or Apple's
  simulators).
- **Tier 3**: programs are compiled and linked for the target, not run.

## Running What You Built

Inspect the format and architecture of the cross-compiled binary with
`llvm-readobj`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --file-headers hello-windows-arm64.exe
```

Among the headers, it prints `Format: COFF-ARM64` and `Arch: aarch64`.

Copy the binary to a machine of its target and run it; no runtime package needs
to be installed. A glibc [Linux](linux.md) binary runs on any distribution with
glibc 2.17 or later, a musl binary runs on any Linux of its architecture, a
[Windows](windows.md) binary runs on Windows 10 or later, and a
[macOS](macos.md) binary runs on macOS 13.0 or later (signed ad hoc by
`ld64.lld` as Apple silicon requires).

Some hosts also run binaries built for another architecture of the same OS:

- `arm64` macOS runs `x86_64` macOS binaries through Rosetta.
- Windows on Arm runs `x86_64` Windows binaries through emulation.

Building on one runner and running tests on a runner of the target is covered
in [CI](../integrations/ci.md).

## In Your Build System

- [CMake](../integrations/cmake.md): pass the toolchain file with
  `-DXCLANG_TARGET=<target>`.
- [Bazel](../integrations/bazel.md): pass
  `--platforms=@xclang//platforms:<target>`.
- [Plain clang, Make and Meson](../integrations/clang.md): pass
  `--target=<target>` to the compiler, or in a Meson cross file.
- [Rust and Cargo](../integrations/cargo.md): run
  `xclang cargo build --target <rust-target>`.

## Build Tools' Minimum Versions

| tool | minimum version or target | why |
|---|---|---|
| CMake | 3.28 or later | the first version that builds C++20 modules without experimental switches; `find_package(xclang)` rejects older versions ([CMake](../integrations/cmake.md)) |
| Ninja | 1.11 or later | required by CMake for C++20 modules; only the Ninja generators build modules for these targets |
| Bazel | 9, with `rules_cc` 0.2.25 or later | the toolchains build on `rules_cc` 0.2.28's unix config ([the Bazel module](../design/bazel-module.md)); C++20 modules require `--experimental_cpp_modules` |
| Rust | `*-pc-windows-gnullvm` for MinGW (not `*-windows-gnu`); `*-pc-windows-msvc` with the Windows SDK | `*-windows-gnullvm`'s standard library links `libunwind` and UCRT, matching xclang's MinGW sysroots ([Rust and Cargo](../integrations/cargo.md)) |
