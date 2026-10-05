# Cross-Compiling


What a target is in xclang, how clang finds everything for it, and what
rule every target follows.

## A Target Is a Directory and a Config File

Cross-compiling C++ needs four things for the target: a compiler that can
emit its code, its C library's headers and libraries (the sysroot), a C++
standard library and the low-level runtimes (builtins, unwinder) built for
it, and a linker for its object format. clang emits code for every
architecture LLVM supports, and lld links ELF, COFF and Mach-O, so the
compiler and linker are one program for every target. What is left differs
per target, and that is what an xclang target is:

- **a directory**, `xclang/<triple>/`: the sysroot with libc++, libc++abi
  and libunwind in it, built for that target;
- **compiler-rt**, in clang's resource directory, built for that target;
- **a config file**, `xclang/bin/<triple>.cfg`, that tells clang where they
  are.

So `clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe` is all a
cross-compile takes: clang reads `aarch64-w64-windows-gnu.cfg` from its own
directory, which says

```
--sysroot=<CFGDIR>/../aarch64-w64-mingw32
-rtlib=compiler-rt
-unwindlib=libunwind
-stdlib=libc++
-fuse-ld=lld
```

and the rest follows from clang's MinGW driver. There is no wrapper script,
no environment variable and no state outside the toolchain's directory: the
same command means the same thing on every machine. The config files are why
xclang needs no patched driver, and why they, not built-in defaults, carry
the choices is in
[toolchain structure](../design/toolchain.md#a-config-file-per-target).

The config files apply to native builds too. `clang++ main.cpp` on Linux
reads the host target's file and compiles against glibc 2.17, not the
machine's glibc, so a program built on a new distribution runs on an old
one. `--no-default-config` gives the bare compiler, for building against
the system's own headers and libraries as upstream clang would.

## The Six Targets

Every archive carries every target:

| target | for |
|---|---|
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Linux, glibc 2.17 and later |
| `x86_64-w64-mingw32`, `aarch64-w64-mingw32` | Windows 10 and later, MinGW-w64 with UCRT |
| `aarch64-apple-darwin`, `x86_64-apple-darwin` | macOS 13 and later, from macOS hosts |

clang's other spellings of them (`x86_64-pc-linux-gnu`,
`aarch64-pc-windows-gnu`, `arm64-apple-macos`, ...) reach the same config
files ([targets](../reference/targets.md)). The macOS targets build against
Xcode's SDK, which xclang cannot redistribute, so they build on macOS hosts
only; everything else builds from every host.

## The Hermeticity Rule

Every target follows one rule: a program depends at run time only on the
system libraries every installation of its OS has and no one may
redistribute, and links everything else statically. For today's targets that
is glibc, libSystem, or the OS's DLLs and UCRT. The rule is why a program
built by xclang is one file that runs where it is copied, and it has
consequences for shared libraries ([hermeticity](../design/hermeticity.md)).

## Tiers

A target's tier says how it is tested, as Rust's tiers do. Tier 1 targets
are built for every release and tested on a machine of the target itself;
tier 2 under emulation; tier 3 compiled and linked, not run. Today's six
are tier 1 ([tiers](../reference/targets.md#tiers)).

## In Build Systems

- CMake: `-DXCLANG_TARGET=<triple>` with xclang's toolchain file
  ([CMake](../integrations/cmake.md#other-targets)).
- Bazel: `--platforms=@xclang//platforms:<triple>`
  ([Bazel](../integrations/bazel.md#cross-compiling)).
- Meson, Make and others: the compiler with `--target`
  ([Make and Meson](../integrations/clang.md)).
- cargo: xclang as the C compiler and linker of a Rust target
  ([Rust and Cargo](../integrations/cargo.md)).

## Not Yet Supported

The toolchain has the six targets above and no others. xclang's vision is
what rustup and cross-rs do for Rust: every other target an archive of its
own, fetched when a build needs it, and vendor SDKs fetched from the
vendor by the user. None of it is in a release:

| | status |
|---|---|
| [The `xclang` command](../design/roadmap.md#xclang-command), which fetches vendor SDKs | Unreleased |
| [Target archives for `xclang target add`](../design/roadmap.md#target-archives) | Planned |
| [MSVC-ABI targets](../design/roadmap.md#msvc) | Planned |
| [musl targets](../design/roadmap.md#musl) | Planned |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) | In research |
| [WebAssembly](../design/roadmap.md#wasm), [more Linux architectures](../design/roadmap.md#linux-architectures), [Android](../design/roadmap.md#android) | Considered |

The [roadmap](../design/roadmap.md#targets) lists every target with its tier
and status.
