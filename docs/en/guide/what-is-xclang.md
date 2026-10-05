# What is xclang?

xclang is a clang toolchain for cross-compiling, the way rustup, cross-rs
and cargo-zigbuild let Rust do it: one compiler for every target. One
directory holds the compiler, the linker and the binary tools. It also
holds, for six targets, the *sysroot* (the C library's headers and
libraries) and the runtimes. Cross-compiling is a `--target` flag and
nothing else:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
```

The compiler is stock LLVM, with a few [patches](../reference/patches.md)
on their way upstream, built with PGO and ThinLTO for six hosts. The six
common targets come with the toolchain. xclang's vision goes further: more
targets, and vendor SDKs fetched when a build needs them. None of that is
in a release; the [roadmap](../design/roadmap.md#the-vision) gives each
item's status.

## What Is in It

- **clang and lld**, and the LLVM binary tools, as one program (`llvm`),
  linked statically against xclang's own libc++. An archive is 95 to
  128 MB.
- **Six targets in every archive**: Linux x64 and arm64 (glibc 2.17),
  Windows x64 and arm64 (MinGW-w64 with UCRT), macOS arm64 and x64. The
  macOS targets use Xcode's SDK, so they build on macOS hosts. Each target
  has its sysroot, libc++, libc++abi, libunwind and compiler-rt, prebuilt,
  and a config file that points clang at them.
- **Programs that run where they are copied.** Everything but the OS's own
  libraries is linked in ([hermeticity](../design/hermeticity.md)).
- **A CMake package and a Bazel module**: the toolchain for the host or
  any target, and `import std` built for the build.
- **libclang**: the static libraries the clang of the release was linked
  from, for tools built on clang ([libclang](../features/libclang.md)).

## Who It Is For

People who want a toolchain they can pin, ship and reproduce, and programs
that run wherever they are copied:

- **Projects that ship programs** to many machines: command-line tools,
  language servers, build tools. A Linux program runs on glibc 2.17 and
  later. A Windows one needs no redistributable, and a macOS one no
  Homebrew.
- **CI that builds for several targets** from one kind of runner, with one
  compiler version for all of them.
- **Teams that want one toolchain** on every developer machine and in CI,
  pinned by version and digest, the same in CMake, Bazel and plain
  commands.
- **C++20 modules** with `import std`, in CMake and Bazel.
- **Tools on clang**, which link libclang built with PGO.

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user.
[catter](https://github.com/clice-io/catter) builds with it too. xclang's CI
builds the tests of [kotatsu](https://github.com/clice-io/kotatsu) for
Windows from Linux, and runs them on Windows.

[Comparisons](comparisons.md) puts xclang next to the toolchains people use
for the same jobs, with what each does better.

## Not Yet Supported

Each has its status in the [roadmap](../design/roadmap.md). Until then,
other toolchains serve these:

| | status | today, use |
|---|---|---|
| [MSVC-ABI targets](../design/roadmap.md#msvc), against your own MSVC and Windows SDK | Unreleased | clang-cl with Visual Studio |
| [musl targets](../design/roadmap.md#musl) | Planned | zig cc, or a musl cross toolchain |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) | In research | a Mac |
| [Android, WebAssembly, bare metal, more Linux architectures](../design/roadmap.md#targets) | Considered | the NDK, wasi-sdk, zig cc, or a GCC cross toolchain |
| [iOS and Apple's other devices](../design/roadmap.md#ios) | In research | Xcode |
| [MemorySanitizer](../design/roadmap.md#msan) | Planned | |
| [Sanitizers for MSVC targets](../design/roadmap.md#msvc) | Unreleased | |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered | |

## Known Limitations

These follow from what xclang is. Where they do not fit, another
toolchain is the better one.

- **C++ libraries from another toolchain do not link.** xclang's C++
  library is libc++, linked into every program. A library built with GCC's
  libstdc++ (a distribution's Qt or Boost) or with MSVC's STL has another
  ABI. Build C++ dependencies with xclang for the target, through CMake,
  Bazel or vcpkg's chain-loaded toolchain file. C libraries are fine.
- **C++ objects should not cross shared libraries.** Each shared library
  carries its own libc++. On Linux and macOS, a standard exception from one
  is caught in another only by `catch (...)`
  ([one libc++ per shared object](../design/hermeticity.md#one-libc-per-shared-object)).
  A plugin system with C++ interfaces needs a shared C++ runtime, which is
  [not planned](../design/roadmap.md#shared-runtime).
- **No OpenMP runtime.** One is [not planned](../design/roadmap.md#openmp).
- **No clang-format, clang-tidy or clangd programs.** xclang is a compiler
  toolchain; they are [not planned](../design/roadmap.md#tool-binaries).
- **Not for conda-forge packages.** Use conda-forge's compilers, which
  link its runtime packages; xclang deliberately does not.

## Next

- [Quick Start](quick-start.md): programs for every target, then a CMake
  project with `import std`.
- [Installation](install.md): pixi, archives, FetchContent, Bazel.
- [Why xclang?](why-xclang.md): the case for it.
