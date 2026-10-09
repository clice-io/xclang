# Roadmap

What xclang supports today, and the status of everything it does not. Every
item that no release carries has one row here, with one status word. Other
pages link to that row instead of restating the status. Nothing here has a
date. What each release changed is in the
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

xclang's vision is what rustup, cross-rs and cargo-zigbuild do for Rust,
for clang: one compiler for every target.

- The common targets come with the toolchain, as the six of today do.
- Every other target is an archive of its own, fetched when a build needs
  it: its sysroot, its prebuilt runtimes and its config file.
- Vendor SDKs that no one may redistribute (Apple's, Microsoft's) are
  fetched from the vendor by the user, who accepts their license. xclang
  never redistributes them.
- Runtimes can also be built from source on demand, for options the
  prebuilt ones lack.

Today, the first and the third are in a release: the six targets, and
since 23.1.2.7 Microsoft's and Apple's SDKs, which the user fetches with
the [`xclang` command](#xclang-command). The rest is planned, in research
or considered, item by item, in the tables below.

Every target keeps the [hermeticity](hermeticity.md) rule. A program
depends at run time only on the libraries of its OS that cannot be
redistributed, and links everything else statically.

## Targets

A target's tier says how it is tested
([tiers](../reference/targets.md#tiers)). For the targets here, tier 1 can
also mean a runner that runs the target's programs: Windows x64 runs x86
programs, wasmtime WebAssembly ones. A tier 3 target may get its runtimes
[built on demand](#libc-on-demand) instead of prebuilt. "The user (SDK)"
means the target needs a vendor SDK that the user fetches, accepting its
license.

| target | C runtime | from | tier | status |
|---|---|---|---|---|
| <a id="linux"></a>Linux x64, arm64 | glibc 2.17 | the toolchain | 1 | Supported |
| <a id="mingw"></a>Windows x64, arm64 (MinGW) | mingw-w64, UCRT | the toolchain | 1 | Supported |
| <a id="macos"></a>macOS arm64, x64, from macOS hosts | Apple's SDK | Xcode | 1 | Supported |
| <a id="msvc"></a>Windows x64, arm64 (MSVC), with their sanitizers | Microsoft's CRT, Windows SDK; libc++ or Microsoft's STL | the user (SDK) | 1 | Supported |
| <a id="macos-any-host"></a>macOS arm64, x64, from Linux and Windows hosts | Apple's SDK | the user (SDK) | 1 | Supported |
| <a id="musl"></a>Linux x64, arm64 (musl), in every archive | musl 1.2.6, static | the toolchain | 1 | Unreleased |
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

What sets these targets apart:

- **MSVC targets.** First-class targets, as the MinGW ones are, since
  23.1.2.7. The default C runtime is Microsoft's "hybrid CRT": the VC
  runtime and the C++ library static, UCRT dynamic. xclang builds their
  libc++ ([below](#libcxx-msvc)) and compiler-rt: the builtins, the
  profile runtime and UBSan, and for x64 AddressSanitizer, whose runtime
  is a DLL, and libFuzzer. The MSVC and
  Windows SDK versions are pinned to ones the shipped clang accepts, and
  the user fetches them with the [`xclang` command](#xclang-command),
  which every toolchain archive carries
  ([Windows](windows.md#msvc-targets)). CMake builds them, and so does the
  Bazel module, unreleased ([below](#msvc-bazel)).
- **macOS from any host.** Since 23.1.2.7. Apple's macOS SDK is in the
  Command Line Tools package on Apple's update servers, and needs no
  Apple ID to download. The user fetches it with the
  [`xclang` command](#xclang-command) into the toolchain, whose config
  files then use it on Linux and Windows hosts; on macOS, Xcode's SDK
  stays the one in use. The programs are those of a macOS host: xclang's
  libc++ linked in, ld64.lld, dSYMs, the sanitizers
  ([macOS](macos.md#the-sdk-on-linux-and-windows-hosts)). CMake builds
  them, and so does the Bazel module, unreleased
  ([below](#macos-any-host-bazel)).
- **musl.** Static programs that take nothing from the system they run on,
  in every archive from 23.1.2.10 on, as the six are: musl built by xclang,
  libc++ and every runtime linked in, UBSan the only sanitizer, as the
  others need dynamic linking
  ([targets](../reference/targets.md#musl-targets)). CMake, Bazel and cargo
  build them.
- **A newer glibc.** The same targets for programs that need what glibc
  2.17 lacks, such as `-static-pie` and newer functions, with the same
  runtimes.
- **Other Linux architectures.** Each gets the oldest glibc it has; riscv64
  and loongarch64 have nothing as old as 2.17. Their sanitizers are the
  ones compiler-rt supports on them.
- **WebAssembly.** `wasm32-wasip2` links with `wasm-component-ld`, which
  each host's toolchain needs to carry. C++ exceptions are opt-in.
- **Android.** The NDK's sysroot, with xclang's static libc++ in the NDK's
  ABI namespace (`__ndk1`).
- **iOS and Apple's other devices.** Their SDKs come only with full Xcode,
  downloaded with an Apple ID; xclang cannot remove that limit. Their
  runtimes are likely to be [built on demand](#libc-on-demand).
- **Windows 7 and XP.** The MSVC target with the CRT linked statically, and
  [YY-Thunks](https://github.com/Chuyu-Team/YY-Thunks) for the functions
  the old systems lack. MinGW with libc++ cannot reach XP. The goal is to
  find out how far hermeticity reaches there; Windows 9x is out of scope.
- **msvcrt.** The MinGW targets use UCRT, which is part of Windows 10 and
  later. A MinGW variant on the older msvcrt is not planned.
- **Emscripten.** emsdk is its toolchain, so it is not an xclang target.

## The xclang Command

| item | status |
|---|---|
| <a id="xclang-command"></a>The `xclang` command: `xclang sdk fetch` for the vendor SDKs | Supported |
| <a id="target-archives"></a>Target archives and a release index, for `xclang target add` | Planned |
| <a id="fetched-targets-in-build-systems"></a>Fetched targets and vendor SDKs in the CMake package and the Bazel module | Planned |
| <a id="msvc-bazel"></a>The MSVC targets in the Bazel module, with the Windows SDK fetched by a repository rule | Unreleased |
| <a id="macos-any-host-bazel"></a>macOS targets from Linux and Windows hosts in the Bazel module, with the macOS SDK fetched by a repository rule | Unreleased |

`xclang` is a program in Rust (`cli/`), built for every host with xclang as
its C compiler and linker. Every toolchain archive carries it, as
`bin/xclang`, since 23.1.2.7
([the xclang command](../reference/xclang-command.md)).

- `xclang sdk fetch` downloads a vendor SDK from the vendor, by version and
  sha256, once the user accepts its license. It is in every release since
  23.1.2.7.
- `xclang target add` unpacks a target's archive of the same release into
  the toolchain: its sysroot, its runtimes, compiler-rt, its config files
  and the licenses of its C runtime. No release publishes target archives
  yet, so it has nothing to add.
- Each release gets an index of its target archives, as rustup's channel
  manifests are: archive, sha256, size, tier and the SDK it needs.
- The CMake package and the Bazel module take fetched targets as they
  come. Today their toolchains build for the six targets of the host's
  archive, and the CMake package also for the MSVC targets, and for macOS
  from Linux and Windows hosts, with the fetched SDKs.
- The plan for the MSVC targets in the Bazel module: a repository rule
  fetches the Windows SDK once the user accepts its license in
  `MODULE.bazel`, and the targets build with the GNU-style clang of the
  other toolchains.
- The plan for macOS from Linux and Windows hosts in the Bazel module: the
  same repository rule fetches the macOS SDK, which stands in for the one
  a macOS host's rule finds with `xcrun`, and the macOS toolchains are
  registered on every host.

## Runtimes and Tools

| item | status |
|---|---|
| <a id="libc-on-demand"></a>libc++, libc++abi and libunwind built from source on demand | Planned |
| <a id="msan"></a>MemorySanitizer, through libc++ built on demand | Planned |
| <a id="mingw-sanitizers"></a>Sanitizers for MinGW targets | Considered |
| <a id="musl-sanitizers"></a>ASan, TSan, LSan and libFuzzer for musl targets, with a dynamically linked musl (Alpine's way) | Considered |
| <a id="bazel-gsymutil"></a>`@xclang//bazel:llvm-gsymutil`, the toolchain's llvm-gsymutil for `bazel run` | Supported |
| <a id="cargo-helper"></a>An `xclang cargo` helper that sets cargo's variables | Considered |
| <a id="libgcc-s-script"></a>`libgcc_s.a` as a linker script naming libunwind, for Rust's Linux targets | Considered |
| <a id="libcxx-msvc"></a>libc++ as the C++ library of MSVC targets | Unreleased |
| <a id="openmp"></a>An OpenMP runtime | Not planned |
| <a id="tool-binaries"></a>clang-format, clang-tidy and clangd programs | Not planned |
| <a id="shared-runtime"></a>A shared C++ runtime across shared libraries | Not planned |
| <a id="conda-forge"></a>A compiler for building conda-forge packages | Not planned |
| <a id="libclang-msvc"></a>libclang for programs built with the MSVC ABI | Not planned |

**libc++ built on demand** means libc++, libc++abi and libunwind built from
source inside a CMake or Bazel build, from LLVM's runtime sources of the
release, with its [patches](../reference/patches.md). It covers what the
prebuilt runtimes cannot be:

- **MemorySanitizer**, which needs every library instrumented, libc++ too.
  ThreadSanitizer also reports better through an instrumented libc++.
- **Hardening and ABI options**: a hardening mode checked inside the
  library, libc++'s ABI version 2, bounded iterators, an ABI namespace of
  one's own, and builds without exceptions or RTTI.
- **LTO and PGO** of libc++ together with the program.
- **Targets without prebuilt runtimes**: tier 3 ones and Apple's devices.

The prebuilt runtimes stay the default.

Rust and cargo work with xclang today as a recipe of environment variables
([Rust and Cargo](../integrations/cargo.md)). A helper that sets them, as
cargo-zigbuild's wrapper does, is considered. So is making `libgcc_s.a` a
linker script, `INPUT(-lunwind)`, instead of an empty archive: Rust's
Linux targets then link without `-l:libunwind.a`. A test with 23.1.2.5's
arm64 sysroot linked Rust, and C++ programs and shared libraries that name
`-lgcc_s`.

**Sanitizers for musl targets** beyond UBSan need dynamic linking: ASan,
TSan and LSan find the C library's functions they intercept through
`dlsym`, which a static program has not, and their runtimes do not link
into one. A variant of the musl targets with musl's `libc.so`, as Alpine
links, would have them, and its programs would need musl on the machine
([sanitizers](../features/sanitizers.md#musl-targets)).

**libc++ for MSVC targets** gives them the C++ library of every other
target, its `import std` included, as their default. Microsoft's STL stays
a choice, `-stdlib=platform`: C++ types passed between a program and
libraries built with MSVC need the same library on both sides
([Windows](windows.md#libc-and-the-stl)).

The not-planned items follow from what xclang is. It is a compiler
toolchain, and libclang has the libraries that tools on clang link. Its
runtimes are linked into every program
([one libc++ per shared object](hermeticity.md#one-libc-per-shared-object)).
conda-forge's compilers link packaged runtimes dynamically, which xclang
does not do. libclang is there for clice, which builds for MinGW on
Windows, so no libclang is built with the MSVC ABI.

## Speed

| item | status |
|---|---|
| <a id="pgo-training"></a>A PGO training that covers Objective-C, clang-cl, Mach-O links and clang-tidy's checks | Planned |
| <a id="bolt"></a>BOLT for the Linux hosts' clang and lld, on top of PGO and ThinLTO | In research |

The training is widened between releases, not while one is pending
([PGO](pgo.md#the-training)).

## Reproducibility and Supply Chain

| item | status |
|---|---|
| <a id="cmake-relative-paths"></a>Relative paths in the debug information of CMake builds | Planned |
| <a id="gsym-determinism"></a>The same GSYM file on every run (`xclang_debug_symbols` passing `--num-threads=1`) | Supported |
| <a id="immutable-releases"></a>Immutable GitHub releases | Planned |
| <a id="reproducible-archives"></a>Reproducible release archives | Supported |
| <a id="reproducible-builds"></a>Reproducible toolchain builds: a rebuild of a revision on its profile is the same bytes (the Windows hosts' `llvm.exe` once the bootstrap has patch 0017) | Unreleased |
| <a id="license-notices"></a>Third-party license notices in the archives | Supported |
| <a id="slsa"></a>SLSA provenance attestations | Considered |

- **CMake builds** write the build tree's absolute paths into debug
  information. Bazel builds already use paths relative to the execution
  root ([debugging](../features/debugging.md#paths-in-debug-information)).
- **GSYM files** from llvm-gsymutil's default threads differ run to run,
  with the same lookups. One thread is deterministic, about 1.4 times as
  slow; `xclang_debug_symbols` passes `--num-threads=1` by default since
  23.1.2.7.
- **Immutable releases** keep an archive and its `SHA256SUMS` from being
  replaced together
  ([releases](../reference/releases.md#checking-a-download)).
- **Reproducible archives**, since 23.1.2.7: sorted entries, the commit's
  time and no owner in the `.tar.xz` files, xz in fixed blocks whatever
  its threads; each host's archives are made twice, on two machines, and
  compared ([build](../dev/release-build.md#the-stages)).
- **Reproducible builds**, since 23.1.2.10: a full rebuild of a revision
  with the same profile gives the same archives again, file by file (the
  `xclang` command aside, which each run builds): `clang --version` names
  LLVM's release commit, not xclang's, nothing built for Windows holds a
  time, and the macOS sanitizers' dylibs hold no file times. Two such
  builds of 23.1.2.10 differed only in the Windows hosts' `llvm.exe`,
  which the bootstrap's lld-link links: it lays out PGO-built programs
  differently from one link to the next, which
  [patch 0017](../reference/patches.md) fixes in 23.1.2.10's own
  lld-link, so a bootstrap of 23.1.2.10 or later makes them the same too.
  Each training gives another profile; a release is rebuilt on its own
  (`profile-run`).
- **License notices**, since 23.1.2.7: every archive has `share/licenses`,
  each component's license files and an SPDX document
  ([layout](../reference/layout.md#licenses)).

## Following LLVM

| item | status |
|---|---|
| <a id="llvm-releases"></a>LLVM 23.1.3 and 24.x, each as it is released | Planned |

Each LLVM release is built with the [patches](../reference/patches.md)
checked against it. 23.1.3 has the fix for the macOS 27 SDK's `arm64e.x1`
stubs, which xclang carries as patch 0009 since 23.1.2.6.

## Documentation

| item | status |
|---|---|
| <a id="zh-docs"></a>The docs in Chinese | Planned |

The docs are in English only for now. The README has a Chinese version.

## Open Questions

Questions inside the items above, not items of their own:

- **Android's sysroot**: fetched by the user from Google's NDK (only the
  files it needs), or redistributed by xclang.
- **The runtimes of Apple's devices**: published prebuilt, or only built
  on demand. Apple's license treats libraries for those platforms apart
  from macOS ones.
- **A glibc other than 2.17**: chosen with a named config file
  (`--config=`), or with a spelling of the target.
- **Where fetched targets go**: into the toolchain directory only, or also
  into a directory of the user's.
