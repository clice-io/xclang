# Why xclang?

A C++ build is *hermetic* when its result depends only on its declared
inputs. The same sources and toolchain give the same program, on any
machine and in any directory. Most C++ toolchains are not built for that.
They take headers and libraries from the machine, and link runtimes that
the target machine has to provide. They write the paths of the build into
the output. xclang aims at the current best practice for hermetic, modern
C++ builds.

## At a Glance

| | what it means for you | details |
|---|---|---|
| [Reproducible](#reproducible) | one pinned toolchain; Bazel builds that are the same bytes in any checkout | [the Bazel module](../design/bazel-module.md) |
| [Portable programs](#portable-programs) | a program runs on any machine of its target, as one file | [hermeticity](../design/hermeticity.md) |
| [Cross-compiling is a flag](#cross-compiling-is-a-flag) | one compiler version for eight targets, no sysroots to install | [cross-compiling](cross-compiling.md) |
| [Correct build caches](#correct-build-caches) | a cache never serves objects of another compiler | [the Bazel module](../design/bazel-module.md#every-toolchain-file-is-an-input) |
| [C++20 modules](#c-20-modules) | `import std` in CMake 3.28 or later without experimental switches, and in Bazel | [C++20 modules](../features/modules.md) |
| [Fast](#fast) | clang and lld built with PGO and ThinLTO, on every host | [PGO](../design/pgo.md) |
| [Correctness tools](#correctness-tools) | sanitizers that report real bugs, debug symbols for every target | [sanitizers](../features/sanitizers.md), [debugging](../features/debugging.md) |
| [Supply chain](#supply-chain) | every archive pinned by sha256, LLVM's source with documented patches | [releases](../reference/releases.md) |
| [One toolchain for every build](#one-toolchain-for-every-build) | the same compiler for CMake, Bazel, Meson, Make and cargo | [installation](install.md) |

How each claim is tested is in [testing](../dev/testing.md).

## Reproducible

A toolchain is a release, and a release is never replaced: a rebuild is the
next revision. The Bazel module pins each archive by its sha256, and the
CMake download checks it. So two developers and a CI runner build with the
same compiler. In Bazel builds, no command line or debug information holds
an absolute path, but for the macOS SDK. A program built in a second
checkout is the same bytes.

## Portable Programs

A program depends at run time only on what every installation of its OS has.
That is glibc 2.17 or later, Windows 10 or later, or macOS 13 or later.
libc++ and the other runtimes are linked into it. That is what Rust does by
default. Chromium arranges it for itself, with a Debian sysroot and its own
libc++ built into the browser. Build scripts written for
GCC (`-latomic`, `-lgcc_s`, `-lstdc++`) link unchanged.

## Cross-Compiling Is a Flag

Cross toolchains have traditionally been one per target: a distribution
package, a MinGW GCC or a Docker image. Each has its own compiler version
and sysroot. clang already compiles for every LLVM target; what it lacks
is the libraries of each target. xclang ships them next to the compiler,
so `clang++ --target=aarch64-w64-mingw32` is the whole difference. A bug
fixed or a warning added in one compiler version applies to all targets
at once.

## Correct Build Caches

A cache is only as correct as its key. With a compiler found on the machine,
a new compiler version rebuilds nothing, and the cache serves objects of the
old one. In Bazel, every toolchain file that an action reads is a declared
input. A new release rebuilds what it should, and a disk or remote cache can
serve any machine. Module files are inputs of their importers too, which is
where ccache goes wrong
([build caches and modules](../features/modules.md#build-caches-and-modules)).

## C++20 Modules

A module file is only usable by importers compiled with the same language
options. So a prebuilt `std` module cannot be shipped. xclang builds the
`std` and `std.compat` modules of libc++ for each build, with its options,
as a library to link. It is `xclang::std` in CMake, and
`@xclang//bazel:std` in Bazel. CMake needs no experimental switch.

## Fast

A compiler runs thousands of times per build, so its own speed is a large
part of the build time. clang and lld are built with PGO and ThinLTO on
every host. The profile comes from compiling real code, the way builds and
editors do.

On C++, 23.1.2.6 compiles as fast as LLVM's own builds on Linux and macOS,
and faster than LLVM's build on Windows. libclang ships
as ThinLTO bitcode, and the [ThinLTO cache](../features/thinlto-cache.md)
makes the relinks of tools built on it take seconds.

## Correctness Tools

ASan, TSan, LSan, UBSan and libFuzzer work for Linux and macOS targets;
UBSan for the MSVC targets, and ASan and libFuzzer for x64 ones. An
ASan program against an uninstrumented libc++ reports container overflows
that are not there. So xclang ships an ASan build of libc++, which ASan
programs link. Debug information holds wherever the build ran, and the
toolchain makes GSYM files for every target, the same file on every run,
and dSYMs for macOS ones.

## Supply Chain

Every archive is listed in the `SHA256SUMS` of its release, and the Bazel
module pins each by sha256. LLVM's source is the release tarball, pinned by
sha256, with the patches in the repository applied. Every patch has a README
saying what it changes and where it stands upstream. Each host's archives
are made twice, on two machines, and must be the same bytes. Every archive
carries the licenses of its components, with an SPDX document
([layout](../reference/layout.md#licenses)).

Vendor SDKs, such as Apple's and Microsoft's, are never in an archive: the
user fetches them from the vendor, pinned by version and sha256
([vendor SDKs](../design/vendor-sdks.md)). A toolchain runs on every
developer machine and writes every shipped binary. Knowing which source
built it, and that the bytes downloaded are the bytes published, is the
minimum.

## One Toolchain for Every Build

A project usually has more than one build: the main one, a script, a Rust
crate with C code, a test harness. With different compilers, their outputs
differ in subtle ways, such as another libc++ or another glibc floor. The
same toolchain directory is the compiler of plain clang, CMake, Bazel,
Meson, Make, and cargo's C code and links. It comes from pixi, an archive,
FetchContent or the Bazel registry.

## Not Yet Supported

| | status |
|---|---|
| [More Linux architectures, WebAssembly, Android, BSDs, bare metal](../design/roadmap.md#targets) | Considered |
| [MemorySanitizer, through libc++ built on demand](../design/roadmap.md#msan) | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [Relative debug paths in CMake builds](../design/roadmap.md#cmake-relative-paths) | Planned |
| [Immutable releases](../design/roadmap.md#immutable-releases) | Planned |
| [SLSA provenance](../design/roadmap.md#slsa) | Considered |
| [BOLT](../design/roadmap.md#bolt) | In research |
| [A wider PGO training](../design/roadmap.md#pgo-training) | Planned |
| [An `xclang cargo` helper](../design/roadmap.md#cargo-helper) | Considered |

## Known Limitations

- **One libc++ per shared object.** A standard exception from one shared
  library is caught in another only by `catch (...)` on Linux and macOS
  ([hermeticity](../design/hermeticity.md#one-libc-per-shared-object)).
- **No Bazel sandbox on Windows** by default: an action can read
  undeclared files there. The Linux and macOS builds of the same targets
  enforce the declarations.
- **Header units** are built by neither CMake nor Bazel, and Bazel's
  module support is experimental.
- **glibc 2.17 has no `-static-pie`**
  ([compatibility](../reference/compatibility.md#known-limitations)).
