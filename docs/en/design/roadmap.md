# Roadmap

Every target and feature that no release carries yet has one row on this page,
with one status word. Other pages link to that row instead of restating the
status. What is already in a release is documented on its own page, and what
each release changed is in the
[CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

| status | meaning |
|---|---|
| Supported | In a release. |
| Unreleased | On `main` and tested by CI, but no release carries it. |
| Planned | Decided, and in no release yet. It may be in progress on a branch. |
| In research | Wanted. Whether it can be done well is still open. |
| Considered | Wanted. Its form or its cost is still open. |
| Not planned | Out of scope by design. |

## The Vision

xclang's goal is to give `clang` what `rustup`, `cross-rs` and
`cargo-zigbuild` give Rust: one compiler for every target. The common targets
ship in every host archive, vendor SDKs that cannot be redistributed are
fetched from the vendor by the user, and C++ runtimes can be built from source
on demand ([what is xclang?](../guide/what-is-xclang.md),
[cross-compiling](../guide/cross-compiling.md)). Additional targets beyond the
bundled set will be published as separate target archives fetched when a build
needs them. Every target follows the [hermeticity](hermeticity.md) rule: a
program depends at run time only on the OS libraries that cannot be
redistributed, and links everything else statically.

## Targets

A target's tier describes how CI tests it
([targets and hosts](../guide/cross-compiling.md#targets-and-hosts)): Tier 1
runs tests natively on a GitHub-hosted runner (including `x86` binaries on
`x86_64` Windows and WebAssembly binaries under `wasmtime`), Tier 2 runs tests
under emulation or virtualization, and Tier 3 compiles and links without
running. A Tier 3 target may build its runtimes
[from source on demand](../features/runtimes-from-source.md) rather than
shipping prebuilt archives. "The user (SDK)" means the target requires a
vendor SDK fetched by the user under the vendor's license.

| target | C runtime | from | tier | status |
|---|---|---|---|---|
| <a id="windows-x86-msvc"></a>Windows x86 (MSVC) | Microsoft's CRT and STL, Windows SDK | the user (SDK) | 1 | In research |
| <a id="windows-7"></a>Windows 7 and XP (MSVC) | Microsoft's CRT, static, with YY-Thunks | the user (SDK) | 3 | In research |
| <a id="windows-x86-mingw"></a>Windows x86 (MinGW) | mingw-w64, UCRT | xclang | 1 | Considered |
| <a id="arm64ec"></a>Windows arm64ec | Microsoft's ARM64EC libraries | the user (SDK) | 3 | Considered |
| <a id="msvcrt"></a>Windows (MinGW) on msvcrt, before Windows 10 | msvcrt | | | Not planned |
| <a id="glibc-newer"></a>Linux x64, arm64 with a newer glibc | glibc 2.28 | xclang | 1 | Considered |
| <a id="linux-architectures"></a>Linux x86 | glibc 2.17 | xclang | 1 | Considered |
| Linux armv7 (hard float) | glibc 2.17 | xclang | 2 | Considered |
| Linux riscv64 | glibc 2.31 | xclang | 2 | Considered |
| Linux ppc64le, s390x | glibc 2.17 | xclang | 2 | Considered |
| Linux loongarch64 | glibc 2.36 | xclang | 2 | Considered |
| <a id="musl-architectures"></a>Linux riscv64, armv7 (musl) | musl | xclang | 2 | Considered |
| <a id="wasm"></a>WebAssembly (`wasm32-wasip1`, `wasm32-wasip2`) | wasi-libc | xclang | 1 | Considered |
| <a id="android"></a>Android arm64, x64, armv7 | bionic | the user, from the NDK (SDK) | 2 | Considered |
| <a id="openharmony"></a>OpenHarmony arm64 | OpenHarmony's musl | xclang | 2 | Considered |
| <a id="freebsd"></a>FreeBSD x64, arm64 | FreeBSD 14's libc | xclang | 2 | Considered |
| <a id="bsd"></a>OpenBSD, NetBSD | their libc | xclang | 3 | Considered |
| <a id="bare-metal"></a>Bare metal: Arm Cortex-M, -R, -A, AArch64, RISC-V | picolibc | xclang | 2 | Considered |
| <a id="ios"></a>iOS, tvOS, watchOS, visionOS, their simulators | Apple's SDKs | the user, from full Xcode (SDK) | 3 | In research |
| <a id="emscripten"></a>Emscripten | Emscripten's own | emsdk | | Not planned |

- **A newer glibc**: `x86_64` and `aarch64` Linux targets for programs that
  need features absent from glibc 2.17, such as `-static-pie` and newer C
  library interfaces, paired with the same static `libc++` and `compiler-rt`.
- **Other Linux architectures**: each uses the oldest glibc version available
  for its architecture (`riscv64` and `loongarch64` have no glibc 2.17), with
  the sanitizers `compiler-rt` supports on that architecture.
- **WebAssembly**: `wasm32-wasip2` links with `wasm-component-ld` bundled in
  each host archive; C++ exceptions are opt-in.
- **Android**: builds against the NDK's sysroot with xclang's static `libc++`
  configured in the NDK's inline ABI namespace (`__ndk1`).
- **iOS and Apple's other device platforms**: their SDKs ship only in full
  Xcode (which requires an Apple ID to download), and their C++ runtimes will
  likely be built [from source on demand](../features/runtimes-from-source.md).
- **Windows 7 and XP**: the MSVC target linked against the static CRT and
  [YY-Thunks](https://github.com/Chuyu-Team/YY-Thunks) for APIs missing on
  older Windows versions (`mingw-w64` with `libc++` cannot target XP; Windows
  9x is out of scope).
- **`msvcrt`**: xclang's MinGW targets use UCRT (Windows 10 and later); a
  MinGW variant targeting the legacy `msvcrt.dll` is not planned.
- **Emscripten**: `emsdk` provides its own complete toolchain, so Emscripten
  is not an xclang target.

## The xclang Command

| item | status |
|---|---|
| <a id="target-archives"></a>Target archives and a release index, for `xclang target add` | Planned |
| <a id="fetched-targets-in-build-systems"></a>Fetched targets in the CMake package and the Bazel module | Planned |

[`xclang target add`](../reference/xclang-command.md#targets) is built to
unpack a per-target archive of the same release into the toolchain directory
(sysroot, prebuilt runtimes, `compiler-rt`, config files and C runtime license
notices) using a release manifest that records each target archive's URL,
`sha256`, size, tier and required vendor SDK. Once releases publish target
archives, the CMake package and the Bazel module will configure and register
fetched targets alongside the bundled ones.

## Runtimes and Tools

| item | status |
|---|---|
| <a id="runtimes-msvc"></a>Runtimes from source for the MSVC targets | Planned |
| <a id="runtimes-bazel-lto"></a>LTO of the runtimes from source with the program, in Bazel | Considered |
| <a id="musl-sanitizers"></a>ASan, TSan, LSan and libFuzzer for musl targets, with a dynamically linked musl (Alpine's way) | Considered |
| <a id="libgcc-s-script"></a>`libgcc_s.a` as a linker script naming libunwind, for Rust's Linux targets | Considered |
| <a id="openmp"></a>An OpenMP runtime | Not planned |
| <a id="tool-binaries"></a>clang-format, clang-tidy and clangd programs | Not planned |
| <a id="shared-runtime"></a>A shared C++ runtime across shared libraries | Not planned |
| <a id="conda-forge"></a>A compiler for building conda-forge packages | Not planned |
| <a id="libclang-msvc"></a>libclang for programs built with the MSVC ABI | Not planned |

- **Runtimes from source for MSVC targets, and ThinLTO in Bazel**: extending
  [runtimes from source](../features/runtimes-from-source.md) to compile
  `libc++` on `vcruntime` with `clang-cl` against the fetched Windows SDK; and
  exposing source-built runtimes in Bazel as `cc_library` dependencies so
  Bazel runs ThinLTO backend actions on their bitcode objects.
- **Sanitizers for musl targets**: ASan, TSan and LSan intercept C library
  functions through `dlsym`, which static musl executables do not have
  ([sanitizers](../features/sanitizers.md#musl-targets)). Supporting them
  requires a musl target variant that links dynamically against `libc.so` as
  Alpine Linux does.
- **`libgcc_s.a` as a linker script**: replacing the empty `libgcc_s.a` archive
  in the Linux sysroots with `INPUT(-lunwind)` so manual Cargo configurations
  for `*-unknown-linux-gnu` link without adding `-Clink-arg=-l:libunwind.a`
  ([without `xclang cargo`](../integrations/cargo.md#without-xclang-cargo)).
- **Not planned**: xclang is a compiler toolchain, and editor or linter tools
  link [`libclang`](../features/libclang.md) directly; `libc++` is linked
  statically into each binary rather than shared across dynamic libraries
  ([one `libc++` per shared object](hermeticity.md#one-libc-per-shared-object));
  conda-forge recipes use conda-forge's dynamically linked compiler packages;
  and `libclang` is built for the six hosts (MinGW on Windows, for clice)
  rather than the MSVC ABI.

## Speed

| item | status |
|---|---|
| <a id="pgo-training"></a>A PGO training that covers Objective-C, clang-cl, Mach-O links and libclang's clang-tidy checks | Planned |
| <a id="bolt"></a>BOLT for the Linux hosts' clang and lld, on top of PGO and ThinLTO | In research |

The [PGO training corpus](pgo.md#the-training) is widened between releases.

## Reproducibility and Supply Chain

| item | status |
|---|---|
| <a id="cmake-relative-paths"></a>Relative paths in the debug information of CMake builds | Planned |
| <a id="immutable-releases"></a>Immutable GitHub releases | Planned |
| <a id="slsa"></a>SLSA provenance attestations | Planned |

- **Relative debug paths in CMake**: CMake builds currently record the build
  directory's absolute paths in DWARF and Mach-O debug maps, whereas Bazel
  builds record paths relative to the execution root
  ([paths in debug information](../features/debugging.md#paths-in-debug-information)).
- **Immutable GitHub releases and SLSA provenance**: preventing a published
  archive and `SHA256SUMS` from being replaced together on GitHub
  ([checking a download](../reference/releases.md#checking-a-download)), and
  attaching verifiable build provenance attestations tying each release asset
  to its commit and GitHub Actions workflow run.

## Following LLVM

| item | status |
|---|---|
| <a id="llvm-releases"></a>LLVM 24.x, and every 23.1 release still to come, each as it is released | Planned |

Each upstream LLVM release is built with the
[patch series](../reference/patches.md) checked against it, dropping patches
that upstream has merged.

## Open Questions

Design choices inside the items above:

- **Android's sysroot**: whether `xclang sdk fetch` downloads only the needed
  files from Google's NDK or xclang redistributes the sysroot directly.
- **The runtimes of Apple's device platforms**: whether to publish prebuilt
  archives or build them only from source on demand, since Apple's license
  treats device platform libraries separately from macOS libraries.
- **A glibc newer than 2.17**: whether a build selects it with a named config
  file (`--config=`) or a distinct target triple spelling.
- **Where fetched targets are stored**: inside the toolchain directory only,
  or also in a user-selected directory.
