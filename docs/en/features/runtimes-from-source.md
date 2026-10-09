# C++ Runtimes from Source

xclang's prebuilt C++ runtimes are one build of libc++, libc++abi and
libunwind per target: no hardening mode, ABI version 1, exceptions and
RTTI, no instrumentation but the ASan libc++
([sanitizers](sanitizers.md)). A CMake or Bazel build can instead compile
them from the sources every toolchain carries, with options of its own, and
link its programs against those. This is for what the prebuilt runtimes
cannot be:

- **MemorySanitizer**, which needs every library instrumented, libc++ too,
  and compiler-rt's runtime of it, which the toolchain does not carry.
  ThreadSanitizer and AddressSanitizer report through an instrumented
  libc++ too.
- **libc++'s hardening modes**, checked inside the library as well as in
  its headers.
- **ABI options**: libc++'s ABI version 2, bounded iterators, an inline
  namespace of one's own.
- **No exceptions, no RTTI** in libc++ and libc++abi.
- **LTO of libc++ with the program** (CMake).

The prebuilt runtimes stay the default. Runtimes from source are in no
release yet ([Unreleased](../design/roadmap.md#libc-on-demand)); the
toolchains of the release after 23.1.2.10 carry the sources.

## Usage

### CMake

The option is the toolchain file's, `XCLANG_RUNTIMES=source`, with
libc++'s options next to it:

<!-- not run: in no release yet; tests/cmake/cmake.ts builds the same variants (test-cmake.yml) -->
```sh
cmake -G Ninja -B build --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_LIBCXX_HARDENING=fast
cmake --build build
```

The first configure builds the variant, about half a minute on four cores,
into `build/xclang-runtimes/<target>-<digest>`; later configures use it, and
other options make another variant beside it. Every compile and link of the
build is against it, CMake's own checks too, and `xclang::std` is built
from its modules. A MemorySanitizer build, which builds compiler-rt's
runtime of it first:

<!-- not run: in no release yet; tests/cmake/cmake.ts builds the same on Linux x64 (test-cmake.yml) -->
```sh
cmake -G Ninja -B build-msan --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory -DCMAKE_BUILD_TYPE=RelWithDebInfo
```

`XCLANG_SANITIZER` gives the whole build its `-fsanitize=` and runtimes
that suit it, so the project's flags need no `-fsanitize=` of their own.
With the prebuilt runtimes it works too, for the sanitizers they have:
`address` then links the prebuilt ASan libc++.

For another target, add `-DXCLANG_TARGET=<target>`: the variant is built for
it, by the same toolchain file.

### Bazel

The flags of the whole build are in `@xclang//runtimes`, and the
sanitizers are the features they always were:

<!-- not run: in no release yet; tests/bazel/runtimes.ts builds the same variants (test-bazel.yml) -->
```sh
bazel build --@xclang//runtimes:source --@xclang//runtimes:hardening=fast //...
bazel test --@xclang//runtimes:source --features=msan //...
```

The runtimes are libraries of the toolchain's repository, compiled for the
target platform with the build's features (a sanitizer's instrumentation)
and `--copt`, and cached as any other action. A `.bazelrc` names the
variants a project uses:

```text
build:msan --@xclang//runtimes:source --features=msan
build:hardened --@xclang//runtimes:source --@xclang//runtimes:hardening=extensive
```

## Options

| | CMake (toolchain file) | Bazel |
|---|---|---|
| runtimes from source | `XCLANG_RUNTIMES=source` | `--@xclang//runtimes:source` |
| libc++'s hardening mode: `none`, `fast`, `extensive`, `debug` | `XCLANG_LIBCXX_HARDENING` | `--@xclang//runtimes:hardening` |
| libc++'s ABI version, `1` or `2` | `XCLANG_LIBCXX_ABI_VERSION` | `--@xclang//runtimes:abi_version` |
| libc++'s inline namespace, `__<name>` | `XCLANG_LIBCXX_ABI_NAMESPACE` | `--@xclang//runtimes:abi_namespace` |
| libc++'s ABI macros, `_LIBCPP_ABI_*` | `XCLANG_LIBCXX_ABI_DEFINES` (a list) | `--@xclang//runtimes:abi_defines` (comma-separated) |
| libc++ and libc++abi without exceptions | `XCLANG_RUNTIMES_EXCEPTIONS=OFF` | `--@xclang//runtimes:exceptions=false` |
| libc++ without RTTI (and without exceptions) | `XCLANG_RUNTIMES_RTTI=OFF` | `--@xclang//runtimes:rtti=false` |
| sanitizers: `address`, `memory`, `thread`, `undefined`, `leak` | `XCLANG_SANITIZER` | `--features=asan`, `msan`, `tsan`, `ubsan`, `lsan` |
| more compile options of libc++ and libc++abi | `XCLANG_RUNTIMES_FLAGS` | the build's `--copt` |
| LTO of libc++ with the program | `XCLANG_RUNTIMES_FLAGS=-flto=thin` | not available |
| more options of LLVM's CMake build | `XCLANG_RUNTIMES_CMAKE_ARGS` | |
| where the variants are built | `XCLANG_RUNTIMES_DIR` | Bazel's output base and caches |

The program's own options are its own: a build without exceptions passes
`-fno-exceptions` (`CMAKE_CXX_FLAGS`, `--copt`) as well. The
[CMake API](../reference/cmake-api.md#runtimes-from-source) and the
[Bazel API](../reference/bazel-api.md#runtimes-from-source) list them again.

## Behavior

- **The same build as the prebuilt runtimes.** CMake builds LLVM's
  `runtimes/` with the CMake cache and options of xclang's own build of
  the runtimes, by the toolchain file and the config file of the target.
  With no options, the result is the prebuilt runtimes: the same
  `__config_site`, and the same code. Bazel compiles the same translation
  units with the same flags, which `packages/bazel/runtimes.ts` takes from
  LLVM's CMake build of every target.
- **What is built**: libc++ with libc++abi in it, libc++experimental, and
  libunwind (none for macOS, which unwinds with the system's). With
  MemorySanitizer, compiler-rt's runtime of it.
- **In place of the prebuilt ones.** The variant's `__config_site` comes
  before libc++'s other headers, and its libraries are linked instead of
  the prebuilt ones (`-nostdlib++`). `import std` follows the variant:
  `xclang::std` and `@xclang//bazel:std` are built from it.
- **libunwind stays uninstrumented** with sanitizers, as in the prebuilt
  ASan libc++: the sanitizers' runtimes unwind with it, and MemorySanitizer
  would report the registers it reads.
- **MemorySanitizer is for the Linux targets** (glibc), x64 and arm64. Its
  runtime is linked into executables as clang links the others, whole, with
  its interface exported.
- **Every library of a program must use the same variant.** A library
  built against the prebuilt runtimes, with another ABI namespace, ABI
  version or set of ABI macros, does not link, or breaks at run time; under
  MemorySanitizer, its code reports what it was not instrumented to see.
- **Bazel does not run ThinLTO on the runtimes**: `--features=thin_lto`
  links programs of ThinLTO against runtimes of native code. Bazel's ThinLTO
  backends compile the objects of the libraries it knows, and the toolchain
  links the runtimes' by their paths.
- **CMake needs Python 3**, as LLVM's build of the runtimes does. Bazel
  needs nothing more.

## The Sources

Every toolchain directory has the sources once, for every target, in
`libc++/src`, next to libc++'s headers: llvm-project's own layout
(`runtimes/`, `cmake/`, `llvm/cmake/`, `libcxx/`, `libcxxabi/`,
`libunwind/`, `compiler-rt/`, and the headers of LLVM's libc that libc++
includes), without tests and documentation, with xclang's
[patches](../reference/patches.md) of libc++ applied. They are 35 MB
unpacked, 2.3 MB of each archive.

## Not Yet Supported

| | status |
|---|---|
| [Runtimes from source for the MSVC targets](../design/roadmap.md#runtimes-msvc) | Planned |
| [LTO of the runtimes with the program in Bazel](../design/roadmap.md#runtimes-bazel-lto) | Considered |
