# xclang

xclang is a clang toolchain that cross-compiles C and C++ for Linux, Windows
and macOS with one `--target` flag, and builds programs that need nothing at
run time but the OS.

[Documentation](https://docs.clice.io/xclang) · [中文文档](https://docs.clice.io/zh/xclang)

```sh
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
clang++ -O2 --target=x86_64-unknown-linux-musl hello.cpp -o hello-static-x64
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

Nothing else to install: for each `--target`, `clang` reads a config file in
`bin/` that points it to the target's sysroot and prebuilt runtimes, which
come with the toolchain. Each program runs on any machine of its target, as
a single file.

## What You Get

- **Targets**: Linux (glibc and static musl), Windows (MinGW and MSVC) and
  macOS, on x64 and arm64, from every host. The SDKs no one may
  redistribute, Apple's and Microsoft's, come from the vendor through
  `xclang sdk fetch`.
- **Programs that need only the OS**: `libc++`, `libc++abi`, `libunwind`
  and `compiler-rt` are linked in; a Linux program runs on glibc 2.17 or
  later, a Windows one on Windows 10 or later, a macOS one on macOS 13 or
  later.
- **Build systems**: CMake with `import std`, Bazel, cargo through
  `xclang cargo`, and Make and Meson all use the same toolchain.
- **Speed**: `clang` and `lld` are built with PGO and ThinLTO and linked
  statically against xclang's own `libc++` on every host.
- **Pinned, reproducible releases**: built from LLVM's release source with
  documented patches, verified by `SHA256SUMS`, and never replaced.
- **libclang**: the `clang` and LLVM libraries each release was built
  from, as ThinLTO bitcode, for tools built on `clang`.

## Install

From the [clice conda channel](https://conda.clice.io) with `pixi.toml`:

```toml
[workspace]
name = "hello"
channels = ["conda-forge", "https://conda.clice.io"]
platforms = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"]

[dependencies]
xclang = "*"
```

```sh
pixi install
```

You can also install from release archives, CMake `FetchContent`, or the Bazel
registry; see the [quick start](https://docs.clice.io/xclang/guide/quick-start).

## Use It in Your Build

CMake: the toolchain file, with `XCLANG_TARGET` (`$XCLANG` is the toolchain
directory):

```sh
cmake -G Ninja -B build-aarch64-w64-mingw32 --toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake \
    -DXCLANG_TARGET=aarch64-w64-mingw32
cmake --build build-aarch64-w64-mingw32
```

Bazel: the module from [bazel.clice.io](https://bazel.clice.io), and a
platform per target:

```python
bazel_dep(name = "xclang", version = "23.1.5.1")
```

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:hello
```

cargo: `xclang cargo` sets the compilers and linkers of each target, with
no cargo config:

```sh
xclang cargo build --release --target x86_64-pc-windows-gnullvm
```

The [documentation](https://docs.clice.io/xclang) has the rest: `import std`,
Make and Meson, sanitizers, runtimes built from source, debug symbols,
libclang and CI.

What is not in a release yet is in the
[roadmap](https://docs.clice.io/xclang/design/roadmap). xclang is developed for
[clice](https://github.com/clice-io/clice), whose release builds are its first
user; [catter](https://github.com/clice-io/catter) builds with it too.

[CHANGELOG](CHANGELOG.md) · [contributing](CONTRIBUTING.md) · [security](SECURITY.md) · [license](LICENSE)
