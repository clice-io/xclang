# Comparisons

The toolchains people use for the jobs xclang does, what each does, and
where xclang differs, in both directions. Facts are as of 2026-10-06 and
come from each project's own documentation, linked; corrections are
welcome as [issues](https://github.com/clice-io/xclang/issues).

## In one table

| | what it is | targets out of the box | sysroots and SDKs | C++ runtime in programs | Linux programs run on | build systems | compiler built with PGO |
|---|---|---|---|---|---|---|---|
| **xclang** | clang, lld and six targets' runtimes, prebuilt | Linux x64/arm64, Windows x64/arm64 (MinGW), macOS (from macOS) | bundled; macOS SDK from Xcode | libc++, static | glibc 2.17+ | CMake package, Bazel module, conda | yes, PGO + ThinLTO, every host |
| **zig cc** 0.17 | Zig's driver around its clang | dozens: glibc, musl, MinGW, macOS, BSDs, WASI | libc sources and stubs bundled, built on first use | libc++, static | any glibc version chosen per target (default 2.31) | `zig build`; `CC="zig cc"` | not stated |
| **cargo-zigbuild** | zig cc as cargo's linker | Linux, macOS (per its README) | through zig; macOS SDK from the user | through zig | glibc version chosen per target | cargo | (zig's) |
| **cross-rs** | cargo in Docker images with GCC cross toolchains | most of Rust's Linux, Windows and other targets | per-target images; Apple and MSVC images built by the user | libstdc++ | 2.31 (2.17 in `:centos` images) | cargo | no (GCC) |
| **llvm-mingw** | clang, lld, mingw-w64 and LLVM's runtimes | Windows i686, x86_64, armv7, arm64 | bundled | libc++ DLL by default, static with `-static` | (no Linux targets) | any, through `<triple>-clang` names | yes, PGO + ThinLTO |
| **conda-forge compilers** | GCC, clang, MSVC activation packages | the conda platforms, in recipes | `sysroot_linux-*` packages | shared, from `libstdcxx`/`libcxx` packages via `run_exports` | glibc 2.17+ (2.28 opt-in) | conda-build, rattler-build | not stated |
| **LLVM releases** | upstream binaries | the host only | none | host runtimes only | (the toolchain is built on Ubuntu 22.04) | none | Linux, macOS: PGO + ThinLTO; Windows: PGO |
| **distro clang + GCC cross** | OS packages | one package set per target | distro packages per target | libstdc++, shared | the distribution's glibc | any | depends on the distribution |
| **Android NDK** | clang and bionic sysroots | Android ABIs × API levels | bundled | libc++, static or shared | (Android) | CMake, ndk-build | yes, with BOLT |
| **wasi-sdk** | clang and wasi-libc | `wasm32-wasip1`, `wasip2` | bundled | libc++, static | (WASI) | CMake toolchain file | not stated |
| **toolchains_llvm** (Bazel) | rules around LLVM's release binaries | the host; cross with a user sysroot | the user's | libc++ static natively, the sysroot's libstdc++ when cross | the sysroot's | Bazel | (LLVM's) |
| **hermetic_cc_toolchain** (Bazel) | rules around zig cc | Linux glibc/musl, windows-gnu, macOS (weak) | through zig | libc++, static | chosen per target | Bazel | (zig's) |

## zig cc

[`zig cc`](https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html)
is the closest in spirit: one download, `-target` and nothing else, and it
is where the idea of a cross-compiling clang without a sysroot to install
was shown to work. It differs from xclang in how it gets there:

- **It builds the runtimes on first use.** Zig ships the sources of libc++,
  libc++abi, libunwind, compiler-rt and of several C libraries, and builds
  what a target needs the first time, then caches it
  ([overview](https://ziglang.org/learn/overview/)). That is how it fits
  dozens of targets in a 55 MB download. xclang ships the six targets'
  runtimes prebuilt (no first-build delay, the same bytes for everyone)
  and is to fetch other targets as prebuilt archives.
- **It has more targets today**: musl, any glibc version per target
  (`x86_64-linux-gnu.2.17`), the BSDs, WASI, and macOS from any host with
  Apple's libc headers and a `libSystem` stub
  ([0.17.0 release notes](https://ziglang.org/download/0.17.0/release-notes.html)).
  xclang has none of these yet.
- **Its clang is Zig's.** 0.17.0 has LLVM 22, with loop vectorization
  disabled to work around a regression since 0.16.0; xclang follows LLVM's
  releases with stock clang, built with PGO and ThinLTO.
- **Runtimes**: zig links libc++ statically, as xclang does, and has open
  issues with libc++ in more than one shared object
  ([#24831](https://github.com/ziglang/zig/issues/24831)); it ships no ASan
  runtime ([#11403](https://github.com/ziglang/zig/issues/11403)), and its
  `windows-msvc` target uses an installed Visual Studio. xclang has ASan,
  TSan, LSan, UBSan and libFuzzer for Linux and macOS.
- **Integration**: zig cc is a drop-in `CC`; xclang adds a CMake package
  (with `import std`), a Bazel module and libclang.

Zig's issue tracker moved to Codeberg in November 2025; the GitHub issues
above are as they were then.

## cargo-zigbuild and cross-rs

[cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild) makes zig cc
cargo's C compiler and linker; its README lists Linux and macOS targets,
and a glibc version per target. [cross-rs](https://github.com/cross-rs/cross)
runs cargo inside Docker or Podman images that hold a GCC cross toolchain
per target, and `cross test` runs tests under QEMU; its default images
have glibc 2.31 (2.17 in `:centos` ones), and it provides no images for
Apple targets "due to licensing reasons".

xclang is to do for cargo what cargo-zigbuild does, with stock clang and
xclang's runtimes; today that is a documented recipe, not a helper
([Rust and cargo](../integrations/cargo.md)). Unlike cross-rs, it needs no
container and runs natively on Windows and macOS hosts; unlike cross-rs, it
runs no tests under emulation.

## llvm-mingw

[llvm-mingw](https://github.com/mstorsjo/llvm-mingw) is clang, lld,
mingw-w64 and LLVM's runtimes for Windows, from Linux, macOS and Windows
hosts; xclang's MinGW targets are the same idea, and its sysroots use
mingw-w64 as llvm-mingw does. llvm-mingw has more Windows architectures
(i686, armv7, and arm64ec in its scripts), an msvcrt variant for older
Windows, ASan on x86, and Control Flow Guard. It links libc++ and libunwind
as DLLs unless `-static` is given
([#333](https://github.com/mstorsjo/llvm-mingw/issues/333)); xclang links
them in. Its releases are built with PGO and ThinLTO too. It has no Linux
or macOS targets.

## conda-forge's compilers

conda-forge's `cxx-compiler` is GCC on Linux, clang on macOS and MSVC on
Windows, made to build conda packages: the C++ runtime is a shared library
from a package (`libstdcxx`, `libcxx`), which `run_exports` adds to every
package built with it, and the Linux baseline is glibc 2.17 through
`sysroot_linux-*` packages
([knowledge base](https://conda-forge.org/docs/maintainer/knowledge_base/)).
That is right for an environment where conda provides the runtimes, and
wrong for a program that leaves it. xclang is a conda package too, but is
not a compiler for conda-forge packages: it links its runtimes into every
program and has no `run_exports`.

## LLVM's release binaries

[LLVM's releases](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.2)
are clang, lld and the runtimes for the host, built with PGO and ThinLTO on
Linux and macOS (`clang/cmake/caches/Release.cmake`) and with PGO on
Windows, where LTO is off. They carry no sysroot for another target, so a
cross build needs one from elsewhere, and their own size is 0.9 to 2 GB an
archive. xclang 23.1.2.1 was built by them; xclang's archives are 95 to
128 MB, carry six targets, and run on glibc 2.17. On compile speed they
are close: [Why xclang](why-xclang.md#fast) has the numbers.

## Distribution clang and GCC cross toolchains

On Debian, `crossbuild-essential-arm64` brings `aarch64-linux-gnu-g++` and
an arm64 glibc of the distribution's version
([packages.debian.org](https://packages.debian.org/trixie/crossbuild-essential-arm64)),
`g++-mingw-w64` a MinGW GCC; apt.llvm.org has every clang version. They
are the default on a Linux machine and well maintained. Their programs
need the distribution's glibc or newer and `libstdc++.so.6`, a MinGW GCC's
need `libstdc++-6.dll` and `libgcc_s_seh-1.dll` unless linked with
`-static`, each target is another set of packages, and they exist on Linux
only.

## Android NDK and wasi-sdk: the precedents

Both are one clang with bundled sysroots, the shape xclang has for desktop
targets. The [NDK](https://developer.android.com/ndk/guides/other_build_systems)
takes the target and API level in `--target=aarch64-linux-android21`, and
its libc++ is static by default in CMake. Its
[C++ library support](https://developer.android.com/ndk/guides/cpp-support)
page states the rule xclang's static runtimes also follow: "you can only
use a static variant of the C++ runtime if you have one and only one
shared library in your application". [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)
is "builds configured to set the default target and sysroot", which is
what a config file per target does in xclang. Android's own clang is
built with PGO, LTO and BOLT.

## Bazel toolchains

[toolchains_llvm](https://github.com/bazel-contrib/toolchains_llvm)
downloads LLVM's release for the host; it cross-compiles with a sysroot the
user brings and then links that sysroot's libstdc++.
[hermetic_cc_toolchain](https://github.com/uber/hermetic_cc_toolchain) is
built on zig cc and has its targets, with macOS support "not well tested"
and no macOS SDK. xclang's [Bazel module](../integrations/bazel.md) brings
the sysroots itself, registers a toolchain per (host, target) pair, keeps
its actions free of absolute paths, and adds `import std`, sanitizer
features and libclang.

## What xclang does not do

- Targets beyond the six: no musl, Android, iOS, WebAssembly, BSDs or
  bare metal yet; zig cc, the NDK and wasi-sdk have them.
- MSVC-ABI targets, and macOS from Linux or Windows: in research.
- Run tests for other targets under emulation, as cross-rs does.
- Older Windows (msvcrt, Windows 7), as llvm-mingw does.
- A shared C++ runtime across shared libraries.
- Build runtimes from source with other options (MemorySanitizer, libc++
  hardening, a libc++ ABI of one's own): planned.
