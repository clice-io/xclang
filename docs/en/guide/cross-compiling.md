# Cross-Compiling

Add `--target`. The sysroot, the runtimes and the linker of every target
come with xclang, so nothing else is needed.

## Build for Another Target

From the [quick start](quick-start.md) directory, with `hello.cpp` from
there, build for Windows on Arm:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

The same command builds for any of the six targets:

| target | runs on | builds on |
|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64, glibc 2.17 or later | every host |
| `aarch64-unknown-linux-gnu` | Linux arm64, glibc 2.17 or later | every host |
| `x86_64-w64-mingw32` | Windows x64, 10 or later | every host |
| `aarch64-w64-mingw32` | Windows arm64, 10 or later | every host |
| `aarch64-apple-darwin` | macOS arm64, 13 or later | macOS hosts |
| `x86_64-apple-darwin` | macOS x64, 13 or later | macOS hosts |

The macOS targets build against Xcode's SDK, which xclang cannot
redistribute, so they build on macOS hosts only. clang's other spellings
of the targets, such as `x86_64-pc-linux-gnu` or `arm64-apple-macos`, work
too ([targets](../reference/targets.md#targets)).

## In Your Build System

- CMake: the toolchain file with `-DXCLANG_TARGET=<target>`
  ([CMake](../integrations/cmake.md#build-for-another-target)).
- Bazel: `--platforms=@xclang//platforms:<target>`
  ([Bazel](../integrations/bazel.md#build-for-another-target)).
- Meson, Make and others: the compiler with `--target`
  ([Make and Meson](../integrations/clang.md)).
- cargo: xclang as the C compiler and linker of a Rust target
  ([Rust and Cargo](../integrations/cargo.md)).

## Run the Result

Check what was built:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --file-headers hello-windows-arm64.exe
```

It prints, among the headers, `Format: COFF-ARM64` and `Arch: aarch64`.

Copy the program to a machine of its target and run it there; nothing has
to be installed. A Linux program runs on any distribution with glibc 2.17
or later, and a Windows program on Windows 10 or later. Some hosts also
run other targets:

- arm64 macOS runs x86_64 macOS programs, through Rosetta.
- Windows on Arm runs x86_64 Windows programs, through emulation.

`hello-windows-arm64.exe` prints `hello from xclang`. Running tests for
another target on its own runner is in
[CI](../integrations/ci.md#build-on-one-runner-run-on-another).

## How Clang Finds the Target's Files

Cross-compiling C++ needs, for the target, a compiler that emits its
code, its C library (the sysroot), a C++ standard library and the
low-level runtimes, and a linker for its object format. clang emits code
for every architecture LLVM supports, and lld links ELF, COFF and Mach-O.
So the compiler and linker are one program for every target, and xclang
adds the rest.

For each `--target`, clang reads a config file from its own `bin/`
directory. The file is named after clang's normalized spelling of the
triple: `aarch64-w64-windows-gnu.cfg` for `--target=aarch64-w64-mingw32`.
It names the sysroot of the target, `xclang/aarch64-w64-mingw32/`, and its
runtimes:

```
--sysroot=<CFGDIR>/../aarch64-w64-mingw32
-rtlib=compiler-rt
-unwindlib=libunwind
-stdlib=libc++
-fuse-ld=lld
```

The rest follows from the MinGW driver of clang. There is no wrapper
script, no environment variable and no state outside the toolchain
directory. The same command means the same thing on every machine.

The config files apply to native builds too. `clang++ hello.cpp` on Linux
compiles against glibc 2.17, not the glibc of the machine. So a program
built on a new distribution runs on an old one. `--no-default-config` skips
the config file, and gives a bare compiler that uses the system's own
headers and libraries
([config files](../design/toolchain.md#a-config-file-per-target)).

Every target follows one rule: a program needs nothing but the system
libraries of its OS ([hermeticity](../design/hermeticity.md)). Each target
also has a tier, which says how it is tested
([tiers](../reference/targets.md#tiers)).

## Not Yet Supported

The toolchain has the six targets above, and no others. xclang's vision is
what rustup and cross-rs do for Rust. Every other target is an archive of
its own, fetched when a build needs it. Vendor SDKs are fetched from the
vendor by the user. None of it is in a release:

| | status |
|---|---|
| [The `xclang` command](../design/roadmap.md#xclang-command), which fetches vendor SDKs | Unreleased |
| [Target archives for `xclang target add`](../design/roadmap.md#target-archives) | Planned |
| [MSVC-ABI targets](../design/roadmap.md#msvc) | Planned |
| [musl targets](../design/roadmap.md#musl) | Planned |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) | In research |
| [WebAssembly](../design/roadmap.md#wasm), [more Linux architectures](../design/roadmap.md#linux-architectures), [Android](../design/roadmap.md#android) | Considered |

The [roadmap](../design/roadmap.md#targets) lists every target, with its
tier and status.
