# What is xclang

xclang is a clang toolchain for cross-compiling, the way rustup, cross-rs
and cargo-zigbuild let Rust do it: one compiler for every target. One
directory holds the compiler, the linker, the binary tools and, for six
targets, the sysroot and the runtimes, so cross-compiling is a `--target`
flag and nothing else:

```sh
clang++ --target=aarch64-w64-mingw32 main.cpp -o main.exe
```

The common targets come with the toolchain; everything else (more targets,
and the vendor SDKs that cannot be redistributed) is to be fetched when a
build needs it. It is stock LLVM, with a few [patches](../design/patches.md)
that are on their way upstream, built with PGO and ThinLTO for six hosts.

## What is in it

- **clang and lld**, and the LLVM binary tools, as one program (`llvm`),
  linked statically against xclang's own libc++: 95 to 128 MB an archive.
- **Six targets in every archive**: Linux x64 and arm64 (glibc 2.17),
  Windows x64 and arm64 (MinGW-w64, UCRT), macOS arm64 and x64 (with
  Xcode's SDK, so from macOS hosts). Each has its sysroot, libc++,
  libc++abi, libunwind and compiler-rt, prebuilt, and a config file that
  points clang at them.
- **Programs that run where they are copied**: everything but the OS's own
  libraries is linked in ([hermeticity](../design/hermeticity.md)).
- **A CMake package and a Bazel module**: the toolchain for the host or any
  target, and `import std` built for the build.
- **libclang**, the static libraries the toolchain's clang was linked from
  (ThinLTO bitcode), and the option tables, for tools built on clang.

## Who it is for

People who want a toolchain they can pin, ship and reproduce, and binaries
that run wherever they are copied:

- **Projects that ship programs** to many machines: command-line tools,
  language servers, build tools, games' tools. A Linux program runs on
  glibc 2.17 and later, a Windows one needs no redistributable, a macOS one
  no Homebrew.
- **CI that builds for several targets** from one kind of runner, with
  one compiler version for all of them.
- **Teams that want one toolchain** on every developer machine and in CI,
  pinned by version and digest, the same in CMake, Bazel and plain
  commands.
- **C++20 modules** with `import std`, in CMake and Bazel today.
- **Tools on clang**: libclang with PGO, the option tables.

xclang is developed for [clice](https://github.com/clice-io/clice), whose
release builds are its first user; [catter](https://github.com/clice-io/catter)
builds with it too, and xclang's CI builds
[kotatsu](https://github.com/clice-io/kotatsu)'s tests for Windows from
Linux with its Bazel module and runs them on Windows.

## When not to use it

xclang makes choices; where they do not fit, another toolchain is the
better one:

- **You link C++ libraries built by another toolchain.** xclang's C++
  library is libc++, linked into every program. A C++ library from the
  system or a vendor, built with GCC's libstdc++ (a distribution's Qt or
  Boost) or with MSVC's STL, has another ABI: build C++ dependencies with
  xclang for the target (with CMake, Bazel, vcpkg's chain-loaded toolchain
  file, ...). C libraries are fine.
- **You need the MSVC ABI.** xclang's Windows targets are MinGW today;
  MSVC targets, against the user's MSVC and Windows SDK, are in research.
  For MSVC today, use clang-cl with Visual Studio.
- **C++ objects cross shared libraries.** Each shared library carries its
  own libc++; standard exceptions are caught across them only by
  `catch (...)` on Linux and macOS
  ([one libc++ per shared object](../design/hermeticity.md#one-libc-per-shared-object)).
  A plugin system with C++ interfaces wants a shared C++ runtime.
- **Your target is not one of the six yet**: musl, iOS, Android,
  WebAssembly, embedded, other Linux architectures. They are in the
  [roadmap](../design/roadmap.md); today the NDK, wasi-sdk, zig cc or a
  GCC cross toolchain serve them.
- **macOS from Linux or Windows.** Not yet; xclang's macOS targets need
  Xcode's SDK on a Mac.
- **You need OpenMP, MemorySanitizer, sanitizers on Windows**, or
  clang-format, clang-tidy and clangd binaries: not included.
- **You build conda-forge packages**: use conda-forge's compilers, which
  integrate with its runtime packages; xclang deliberately does not.

[Comparisons](comparisons.md) puts xclang next to the toolchains people use
for the same jobs, with what each does better.

## Next

- [Quick start](quick-start.md): programs for every target, then a CMake
  project with `import std`.
- [Why xclang](why-xclang.md): the case for it, with the evidence and the
  gaps.
- [Installing](install.md).
