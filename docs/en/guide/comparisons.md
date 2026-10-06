# Comparisons

The toolchains people use for the jobs xclang does, what each does, and
where xclang differs, in both directions. Facts are as of 2026-10-06, from
the documentation of each project, linked. Corrections are welcome as
[issues](https://github.com/clice-io/xclang/issues).

## In One Table

| | what it is | targets out of the box | sysroots and SDKs | C++ runtime in programs | Linux programs run on | build systems | compiler built with PGO |
|---|---|---|---|---|---|---|---|
| **xclang** | clang, lld and six targets' runtimes, prebuilt | Linux x64/arm64, Windows x64/arm64 (MinGW), macOS from macOS hosts | bundled; macOS SDK from Xcode | libc++, static | glibc 2.17+ | CMake package, Bazel module, conda | yes, PGO + ThinLTO, every host |
| **zig cc** 0.17 | Zig's driver around its clang | dozens: glibc, musl, MinGW, macOS, BSDs, WASI | libc sources and stubs bundled, built on first use | libc++, static | any glibc version chosen per target; 2.31 by default | `zig build`; `CC="zig cc"` | not stated |
| **cargo-zigbuild** | zig cc as cargo's linker | Linux, macOS, as its README lists | through zig; macOS SDK from the user | through zig | glibc version chosen per target | cargo | as zig |
| **cross-rs** | cargo in Docker images with GCC cross toolchains | most of Rust's Linux, Windows and other targets | per-target images; Apple and MSVC images built by the user | libstdc++ | 2.31; 2.17 in `:centos` images | cargo | no; GCC |
| **llvm-mingw** | clang, lld, mingw-w64 and LLVM's runtimes | Windows i686, x86_64, armv7, arm64 | bundled | libc++ DLL by default, static with `-static` | no Linux targets | any, through `<target>-clang` names | yes, PGO + ThinLTO |
| **conda-forge compilers** | GCC, clang, MSVC activation packages | the conda platforms, in recipes | `sysroot_linux-*` packages | shared, from `libstdcxx`/`libcxx` packages via `run_exports` | glibc 2.17+, or 2.28 by opt-in | conda-build, rattler-build | not stated |
| **LLVM releases** | upstream binaries | the host only | none | host runtimes only | the host's glibc; the toolchain is built on Ubuntu 22.04 | none | Linux, macOS: PGO + ThinLTO; Windows: PGO |
| **distro clang + GCC cross** | OS packages | one package set per target | distro packages per target | libstdc++, shared | the distribution's glibc | any | depends on the distribution |
| **Android NDK** | clang and bionic sysroots | Android ABIs × API levels | bundled | libc++, static or shared | Android | CMake, ndk-build | yes, with BOLT |
| **wasi-sdk** | clang and wasi-libc | `wasm32-wasip1`, `wasip2` | bundled | libc++, static | WASI | CMake toolchain file | not stated |
| **toolchains_llvm** (Bazel) | rules around LLVM's release binaries | the host; cross with a user sysroot | the user's | libc++ static natively, the sysroot's libstdc++ when cross | the sysroot's | Bazel | as LLVM |
| **hermetic_cc_toolchain** (Bazel) | rules around zig cc | Linux glibc and musl, windows-gnu, macOS "not well tested" | through zig | libc++, static | chosen per target | Bazel | as zig |

## zig cc

[`zig cc`](https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html)
is the closest in spirit: one download, `-target`, and nothing else. It is
where a cross-compiling clang without a sysroot to install was shown to
work. It differs from xclang in how it gets there:

- **It builds the runtimes on first use.** Zig ships the sources of
  libc++, libc++abi, libunwind, compiler-rt and several C libraries. It
  builds what a target needs the first time, then caches it
  ([overview](https://ziglang.org/learn/overview/)). That is how it fits
  dozens of targets in a 55 MB download. xclang ships the runtimes of its
  six targets prebuilt: no first-build delay, and the same bytes for
  everyone. Fetching other targets as prebuilt archives is
  [planned](../design/roadmap.md#target-archives).
- **It has more targets today**: musl, any glibc version per target
  (`x86_64-linux-gnu.2.17`), the BSDs and WASI. It also builds for macOS
  from any host, with Apple's libc headers and a `libSystem` stub
  ([0.17.0 release notes](https://ziglang.org/download/0.17.0/release-notes.html)).
  In xclang, musl targets are [planned](../design/roadmap.md#musl), a newer
  glibc and the BSDs are [considered](../design/roadmap.md#glibc-newer), and
  macOS from any host, with Apple's own SDK fetched by the user, is
  [unreleased](../design/roadmap.md#macos-any-host).
- **Its clang is Zig's.** 0.17.0 has LLVM 22, with loop vectorization
  disabled to work around a regression since 0.16.0. xclang follows LLVM's
  releases with stock clang, built with PGO and ThinLTO.
- **Runtimes.** zig links libc++ statically, as xclang does, and has open
  issues with libc++ in more than one shared object
  ([#24831](https://github.com/ziglang/zig/issues/24831)). It ships no
  ASan runtime ([#11403](https://github.com/ziglang/zig/issues/11403)),
  and its `windows-msvc` target uses an installed Visual Studio. xclang has
  ASan, TSan, LSan, UBSan and libFuzzer for Linux and macOS.
- **Integration.** zig cc is a drop-in `CC`. xclang adds a CMake package
  with `import std`, a Bazel module, and libclang.

Zig's issue tracker moved to Codeberg in November 2025; the GitHub issues
above are as they were then.

## cargo-zigbuild and cross-rs

[cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) makes zig
cc the C compiler and linker of cargo. Its README lists Linux and macOS
targets, and a glibc version per target.

[cross-rs](https://github.com/cross-rs/cross) runs cargo inside Docker or
Podman images that hold a GCC cross toolchain per target. `cross test`
runs tests under QEMU. Its default images have glibc 2.31, or 2.17 in the
`:centos` ones. It provides no images for Apple targets "due to licensing
reasons".

xclang works with cargo as zig does for cargo-zigbuild, with stock clang
and xclang's runtimes. Today that is a documented recipe
([Rust and Cargo](../integrations/cargo.md)); a helper like
cargo-zigbuild is [considered](../design/roadmap.md#cargo-helper). Unlike
cross-rs, xclang needs no container, and runs natively on Windows and
macOS hosts. It also runs no tests under emulation.

## llvm-mingw

[llvm-mingw](https://github.com/mstorsjo/llvm-mingw) is clang, lld,
mingw-w64 and the LLVM runtimes for Windows, from Linux, macOS and Windows
hosts. xclang's MinGW targets are the same idea, and their sysroots use
mingw-w64 too.

- llvm-mingw has more Windows architectures: i686, armv7, and arm64ec in
  its scripts. It has an msvcrt variant for older Windows, ASan on x86, and
  Control Flow Guard.
- It links libc++ and libunwind as DLLs unless `-static` is given
  ([#333](https://github.com/mstorsjo/llvm-mingw/issues/333)). xclang links
  them in.
- Its releases are built with PGO and ThinLTO too.
- It has no Linux or macOS targets.

## conda-forge's Compilers

The `cxx-compiler` of conda-forge is GCC on Linux, clang on macOS and MSVC
on Windows, made to build conda packages. The C++ runtime is a shared
library from a package, `libstdcxx` or `libcxx`, which `run_exports` adds to
every package built with it. The Linux baseline is glibc 2.17, through the
`sysroot_linux-*` packages
([knowledge base](https://conda-forge.org/docs/maintainer/knowledge_base/)).

That is right for an environment where conda provides the runtimes, and
wrong for a program that leaves it. xclang is a conda package too, but not
a compiler for conda-forge packages. It links its runtimes into every
program, and has no `run_exports`.

## LLVM's Release Binaries

[LLVM's releases](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.2)
are clang, lld and the runtimes for the host. They are built with PGO and
ThinLTO on Linux and macOS (`clang/cmake/caches/Release.cmake`), and with
PGO but no LTO on Windows. They carry no sysroot for another target, so a
cross build needs one from elsewhere. An archive is 0.9 to 2 GB.

xclang 23.1.2.1 was built by them. xclang's archives are 95 to 128 MB,
carry six targets, and run on glibc 2.17. On compile speed they are close
on Linux and macOS ([PGO](../design/pgo.md#what-it-buys) has the numbers).

## Distribution Clang and GCC Cross Toolchains

On Debian, `crossbuild-essential-arm64` brings `aarch64-linux-gnu-g++` and
an arm64 glibc of the version of the distribution
([packages.debian.org](https://packages.debian.org/trixie/crossbuild-essential-arm64)).
`g++-mingw-w64` is a MinGW GCC, and apt.llvm.org has every clang version.
They are the default on a Linux machine, and well maintained. But:

- Their programs need the glibc of the distribution or newer, and
  `libstdc++.so.6`.
- The programs of a MinGW GCC need `libstdc++-6.dll` and
  `libgcc_s_seh-1.dll`, unless linked with `-static`.
- Each target is another set of packages.
- They exist on Linux only.

## Android NDK and wasi-sdk: The Precedents

Both are one clang with bundled sysroots, the shape xclang has for desktop
targets.

- The [NDK](https://developer.android.com/ndk/guides/other_build_systems)
  takes the target and API level in `--target=aarch64-linux-android21`, and
  its libc++ is static by default in CMake. Its
  [C++ library support](https://developer.android.com/ndk/guides/cpp-support)
  page states a rule that xclang's static runtimes also follow. "You can
  only use a static variant of the C++ runtime if you have one and only one
  shared library in your application." Android's own clang is built with
  PGO, LTO and BOLT.
- [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) is "builds
  configured to set the default target and sysroot", which is what a
  config file per target does in xclang.

## Bazel Toolchains

[toolchains_llvm](https://github.com/bazel-contrib/toolchains_llvm)
downloads LLVM's release for the host. It cross-compiles with a sysroot
the user brings, and then links the libstdc++ of that sysroot.
[hermetic_cc_toolchain](https://github.com/uber/hermetic_cc_toolchain) is
built on zig cc and has its targets. Its macOS support is "not well
tested", without a macOS SDK.

xclang's [Bazel module](../integrations/bazel.md) brings the sysroots
itself, and registers a toolchain per host and target. Its actions hold no
absolute paths, and it adds `import std`, sanitizer features and
libclang.

## Not Yet Supported

| | status | who has it |
|---|---|---|
| [musl targets](../design/roadmap.md#musl) | Planned | zig cc |
| [MSVC-ABI targets](../design/roadmap.md#msvc) | Unreleased | clang-cl with Visual Studio |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) | Unreleased | zig cc |
| [Android](../design/roadmap.md#android), [WebAssembly](../design/roadmap.md#wasm), [the BSDs](../design/roadmap.md#freebsd), [bare metal](../design/roadmap.md#bare-metal) | Considered | the NDK, wasi-sdk, zig cc |
| [iOS and Apple's other devices](../design/roadmap.md#ios) | In research | Xcode |
| [Windows 7 and XP](../design/roadmap.md#windows-7) | In research | llvm-mingw's msvcrt variant |
| [Runtimes built from source with other options: MemorySanitizer, libc++ hardening, an ABI of one's own](../design/roadmap.md#libc-on-demand) | Planned | zig cc builds its runtimes on first use |

## Known Limitations

- **No tests under emulation.** Programs built for another target run on a
  machine of that target; xclang has nothing like `cross test`.
- **No msvcrt.** The MinGW targets use UCRT, which needs Windows 10 or
  later; an msvcrt variant is [not planned](../design/roadmap.md#msvcrt).
- **No shared C++ runtime across shared libraries.** It is
  [not planned](../design/roadmap.md#shared-runtime).
