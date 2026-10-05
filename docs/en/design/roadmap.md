# Roadmap

Where xclang is going. Nothing here has a date or is a commitment. Each
item is

- **planned**: decided, waiting for the work;
- **being considered**: wanted, its form or its cost still open;
- **in research**: whether it can be done well is still being found out.

What each release changed is in the [CHANGELOG](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md).

## The aim

What rustup, cross-rs and cargo-zigbuild do for Rust, for clang: one
compiler for every target. The common targets come with the toolchain, as
the six of today do; every other target is an archive of its own, fetched
when a build needs it, with its sysroot, its prebuilt runtimes and its
config file. Vendor SDKs that cannot be redistributed (Apple's, Microsoft's)
are fetched from the vendor by the user, who accepts their license; xclang
never redistributes them. Partly like `zig cc`, without bundling
everything: what a host's toolchain does not carry is fetched, not built
from bundled sources.

Every target keeps the [hermeticity](hermeticity.md) rule: a program
depends at run time only on the libraries of its OS that cannot be
redistributed, and links everything else statically.

## Tiers

Each target has a tier, as Rust's do: tier 1 is tested on a machine of the
target itself, tier 2 under emulation, tier 3 compiled and linked only
([tiers](../reference/targets.md#tiers)). A target marked **SDK** needs a
vendor SDK that the user fetches and accepts the license of; xclang's tests
fetch it the same way.

## Targets

| target | C runtime | from | tier | status |
|---|---|---|---|---|
| Linux x64, arm64 | glibc 2.17 | xclang | 1 | shipped, in every toolchain |
| Windows x64, arm64 (MinGW) | mingw-w64, UCRT | xclang | 1 | shipped, in every toolchain |
| macOS arm64, x64, on macOS hosts | Apple's SDK | Xcode | 1 | shipped, in every toolchain |
| macOS arm64, x64, from any host | Apple's SDK | the user (SDK) | 1 | in research |
| Windows x64, arm64 (MSVC) | Microsoft's CRT and STL, Windows SDK | the user (SDK) | 1 | in research |
| Windows x86 (MSVC) | Microsoft's CRT and STL, Windows SDK | the user (SDK) | 1 | in research |
| Windows x86 (MinGW) | mingw-w64, UCRT | xclang | 1 | being considered |
| Windows arm64ec | Microsoft's ARM64EC libraries | the user (SDK) | 3 | being considered |
| Windows 7, XP | Microsoft's CRT, linked statically, with YY-Thunks | the user (SDK) | 3 | in research |
| Linux x64, arm64 (musl) | musl | xclang | 1 | planned |
| Linux riscv64, armv7 (musl) | musl | xclang | 2 | being considered |
| Linux x64, arm64 with a newer glibc | glibc 2.28 | xclang | 1 | being considered |
| Linux x86 | glibc 2.17 | xclang | 1 | being considered |
| Linux armv7 (hard float) | glibc 2.17 | xclang | 2 | being considered |
| Linux riscv64 | glibc 2.31 | xclang | 2 | being considered |
| Linux ppc64le, s390x | glibc 2.17 | xclang | 2 | being considered |
| Linux loongarch64 | glibc 2.36 | xclang | 2 | being considered |
| WebAssembly (`wasm32-wasip1`, `wasm32-wasip2`) | wasi-libc | xclang | 1 | being considered |
| Android arm64, x64, armv7 | bionic | the user, from the NDK (SDK) | 2 | being considered |
| OpenHarmony arm64 | OpenHarmony's musl | xclang | 2 | being considered |
| FreeBSD x64, arm64 | FreeBSD 14's libc | xclang | 2 | being considered |
| OpenBSD, NetBSD | their libc | xclang | 3 | being considered |
| Bare metal: Arm Cortex-M, -R, -A, AArch64, RISC-V | picolibc | xclang | 2 | being considered |
| iOS, tvOS, watchOS, visionOS, their simulators | Apple's SDKs | the user, from full Xcode (SDK) | 3 | in research |
| Emscripten | Emscripten's own | emsdk | | not a target: emsdk is its toolchain |

What sets the targets apart:

- **macOS from any host**: Apple's macOS SDK comes from the Command Line
  Tools package on Apple's update servers, no Apple ID needed. The SDK of
  macOS 27 needs LLVM 23.1.3 (below).
- **MSVC targets** are to be first-class, as the MinGW ones are. The
  default: the VC runtime and the STL linked statically, UCRT, an OS
  library, dynamically (Microsoft's "hybrid CRT"). xclang adds compiler-rt
  for them: the builtins, the profile runtime and AddressSanitizer, whose
  runtime on Windows is a DLL. The MSVC and Windows SDK versions are
  pinned, and only ones the shipped clang accepts.
- **musl**: static programs that take nothing from the system they run on.
- **A newer glibc**: the same targets for programs that need what glibc
  2.17 lacks (`-static-pie`, newer functions), with the same runtimes.
- **Other Linux architectures**: the oldest glibc each has; riscv64 and
  loongarch64 have nothing as old as 2.17. Their sanitizers are those
  compiler-rt supports on them.
- **WebAssembly**: `wasm32-wasip2` links with `wasm-component-ld`, a tool
  each host's toolchain would carry; C++ exceptions are opt-in.
- **Android**: the NDK's sysroot, with xclang's static libc++ in the NDK's
  ABI namespace (`__ndk1`).
- **iOS and the rest of Apple's devices**: their SDKs come only with full
  Xcode, downloaded with an Apple ID; that is a limit xclang cannot
  remove. Building their runtimes from source on demand (below) is the
  likely route.
- **Windows 7 and XP**: the MSVC target with the CRT linked statically
  and [YY-Thunks](https://github.com/Chuyu-Team/YY-Thunks) for the
  functions the old systems lack; MinGW with libc++ cannot reach XP. To
  find out how far hermeticity reaches there, not to support Windows 9x.

## The xclang command

Planned: `xclang`, a program in every toolchain archive that fetches what
the toolchain does not carry.

```sh
xclang target add x86_64-unknown-linux-musl
xclang sdk fetch macos --accept-license
xclang sdk fetch windows --accept-license
```

- `xclang target add` downloads the target's archive of the same release
  (its sysroot, its runtimes and compiler-rt, its config file, the
  licenses of its C runtime) and unpacks it into the toolchain.
- `xclang sdk fetch` downloads a vendor SDK from the vendor, by version and
  sha256, once the user accepts its license.
- Each release has an index of its target archives, as rustup's channel
  manifests are: archive, sha256, size, tier and the SDK it needs.

It is written in Rust (ureq, rustls with ring) and built for every host
with xclang as its C compiler and linker, so it is xclang's first user for
cargo (below). It exists, `cli/` ([the xclang command](../reference/xclang-command.md)), and is
built and tested by CI, not yet in a release.

## xclang for cargo

Planned: xclang as the C and C++ toolchain of cargo builds for other
targets, the C compiler and the linker of crates with C code and of Rust's
own targets, as cargo-zigbuild does with zig, with stock clang and the
runtimes xclang ships.
[Rust and cargo](../integrations/cargo.md) says how, from building the xclang command for every
host, and for macOS and the MSVC ABI from Linux with the fetched SDKs.

## libc++ built on demand

Planned: libc++, libc++abi and libunwind built from source inside a CMake
or Bazel build, from LLVM's runtime sources of the release (with its
[patches](patches.md)), for what the prebuilt runtimes cannot be:

- **MemorySanitizer**, which needs every library instrumented, libc++ too;
  ThreadSanitizer reports better through an instrumented libc++.
- **Hardening and ABI options**: the library's own checks of a hardening
  mode, libc++'s ABI version 2, bounded iterators, an ABI namespace of
  one's own; builds without exceptions or RTTI.
- **LTO and PGO** of libc++ together with the program.
- **Targets without prebuilt runtimes**: tier 3 ones, Apple's devices.

The prebuilt runtimes stay the default.

## Build systems

- **A ThinLTO link cache**, shipped in 23.1.2.6: `XCLANG_THINLTO_CACHE`
  in the Bazel module and the CMake package keeps the code ThinLTO links
  generate, so a relink after a small change redoes only what changed
  ([the ThinLTO cache](../features/thinlto-cache.md)).
- **More targets from CMake and Bazel**, planned: both build systems
  would take fetched targets as they come, and the Bazel module the vendor
  SDKs. Its toolchains build for every target of the host's archive today
  (`--platforms=@xclang//platforms:<triple>`), the macOS ones from macOS
  hosts.

## Reproducibility

- **Reproducible links**, shipped for Bazel in 23.1.2.6: the same inputs
  link to the same binary wherever they are linked, debug information
  relative to the execution root (`-ffile-compilation-dir=.`), on macOS
  debug maps without the build's directory (`-oso_prefix`), on Windows no
  link timestamps ([debugging](../features/debugging.md)). Planned: the same for
  CMake builds, whose paths are the build tree's own.
- **Immutable releases**, planned: GitHub releases whose assets cannot
  change once published, so neither can the `SHA256SUMS` that
  [CMake](../integrations/cmake.md)'s download checks archives against.

## Following LLVM

- **LLVM 23.1.3 and 24.x**, planned: each as it is released, with the
  [patches](patches.md) checked against it. 23.1.3 has the fix for the
  `arm64e.x1` architecture in the `.tbd` files of the macOS 27 SDK, which
  ld64.lld 23.1.2 rejects; patches/0009 carries it until then.
- **BOLT**, in research: clang and lld of the Linux hosts optimized by BOLT
  on top of PGO and ThinLTO.

## Open questions

- **Android's sysroot**: fetched by the user from Google's NDK (only the
  files it needs), or redistributed by xclang.
- **The runtimes of Apple's devices**: published prebuilt, or only built
  on demand; Apple's license treats libraries for those platforms apart
  from macOS ones.
- **A glibc other than 2.17**: chosen with a named config file
  (`--config=`), or with a spelling of the target.
- **Where fetched targets go**: into the toolchain's directory only, or
  also into a directory of the user's.
- **musl and the sanitizers**: none, or a dynamically linked variant
  (Alpine's way) that has them.
