# C++ Runtimes from Source

xclang's prebuilt C++ runtimes provide one build of `libc++`, `libc++abi` and
`libunwind` per target: no hardening mode, ABI version 1, exceptions and RTTI
enabled, and no sanitizer instrumentation beyond the prebuilt ASan `libc++`
([sanitizers](sanitizers.md)). A CMake or Bazel build can instead compile the
runtimes from the sources bundled in every toolchain archive (`libc++/src`),
with options of its own, and link its programs against that variant. Use
runtimes from source when a build needs:

- **MemorySanitizer**, which requires every library in the program (`libc++`
  and `libc++abi` included) to be instrumented with `-fsanitize=memory`, along
  with `compiler-rt`'s MSan runtime. ThreadSanitizer and AddressSanitizer also
  instrument `libc++` and `libc++abi` when built from source.
- **`libc++` hardening modes** (`fast`, `extensive`, `debug`), checked inside
  the compiled library as well as in its headers.
- **ABI options**: `libc++` ABI version 2, bounded iterators, or a custom
  inline ABI namespace.
- **No exceptions or no RTTI** in `libc++` and `libc++abi`.
- **ThinLTO of `libc++` together with the program** (CMake).

The prebuilt runtimes remain the default. Runtimes from source are supported
for every target except the MSVC targets.

## Usage

### CMake

Pass `-DXCLANG_RUNTIMES=source` with xclang's toolchain file, together with any
`libc++` or sanitizer options:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_LIBCXX_HARDENING=fast
cmake --build build
```

The first configure builds the runtime variant (about half a minute on four
cores) into `build/xclang-runtimes/<target>-<digest>`; later configures reuse
it, and changing options creates another variant directory alongside it (or in
`XCLANG_RUNTIMES_DIR` when shared across build trees). Every compile and link
in the build uses that variant, CMake's compiler checks and `xclang::std`
included.

For a MemorySanitizer build, which compiles `compiler-rt`'s MSan runtime before
`libc++`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-msan --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory -DCMAKE_BUILD_TYPE=RelWithDebInfo
```

`XCLANG_SANITIZER` (`address`, `memory`, `thread`, `undefined`, `leak`) adds
`-fsanitize=<sanitizer>` to the whole build and selects matching runtimes, so
the project's own flags do not need `-fsanitize=`. `XCLANG_SANITIZER` works
with the prebuilt runtimes as well for the sanitizers they support: `address`
links the prebuilt ASan `libc++` ([sanitizers](sanitizers.md#cmake)), and on
`x86_64` Windows the program loads the ASan DLL from beside itself or from
`PATH` ([MinGW Targets](sanitizers.md#mingw-targets)).

To cross-compile a runtime variant for another target, add
`-DXCLANG_TARGET=<target>` with the same toolchain file.

### Bazel

The example in
[examples/runtimes](https://github.com/clice-io/xclang/tree/main/examples/runtimes)
tests `libc++` with runtimes built from source:

<!-- file: examples/runtimes/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_test.bzl", "cc_test")

cc_test(
    name = "words_test",
    srcs = ["words_test.cpp"],
)
```

::: details words_test.cpp and MODULE.bazel

<!-- file: examples/runtimes/words_test.cpp -->
```cpp
#include <cstdio>
#include <map>
#include <sstream>
#include <string>

int main() {
    std::istringstream text("the runtimes from source are the runtimes of the build");
    std::map<std::string, int> counts;
    for (std::string word; text >> word;) ++counts[word];
    std::string report;
    for (const auto& [word, n] : counts) report += word + " " + std::to_string(n) + "\n";
    // MemorySanitizer checks what printf reads: libc++ wrote it, so libc++
    // must be instrumented too.
    std::printf("%s", report.c_str());
    return counts["runtimes"] == 2 ? 0 : 1;
}
```

<!-- file: examples/runtimes/MODULE.bazel -->
```python
module(name = "runtimes")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.11")
```

:::

Configure the build's runtime variant with flags in `@xclang//runtimes`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --@xclang//runtimes:source --@xclang//runtimes:hardening=fast //...
```

Combine `--@xclang//runtimes:source` with `--features=msan` (for the glibc
Linux targets), `asan`, `tsan`, `ubsan` or `lsan` to instrument `libc++` and
`libc++abi` with the build's sanitizer:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel test --@xclang//runtimes:source --features=msan //...
```

In Bazel, the runtimes are `cc_library` targets inside the toolchain
repository, compiled for the target platform with the build's sanitizer
features and `--copt` flags and cached in Bazel's action cache like any other
target. Define named configurations in `.bazelrc` for the variants a project
uses:

```text
build:msan --@xclang//runtimes:source --features=msan
build:hardened --@xclang//runtimes:source --@xclang//runtimes:hardening=extensive
```

## Options

| | CMake (toolchain file) | Bazel |
|---|---|---|
| Build runtimes from source | `XCLANG_RUNTIMES=source` | `--@xclang//runtimes:source` |
| `libc++` hardening mode: `none`, `fast`, `extensive`, `debug` | `XCLANG_LIBCXX_HARDENING` | `--@xclang//runtimes:hardening` |
| `libc++` ABI version: `1` or `2` | `XCLANG_LIBCXX_ABI_VERSION` | `--@xclang//runtimes:abi_version` |
| `libc++` inline ABI namespace (`__<name>`) | `XCLANG_LIBCXX_ABI_NAMESPACE` | `--@xclang//runtimes:abi_namespace` |
| `libc++` ABI macros (`_LIBCPP_ABI_*`) | `XCLANG_LIBCXX_ABI_DEFINES` (semicolon list) | `--@xclang//runtimes:abi_defines` (comma-separated) |
| `libc++` and `libc++abi` without exceptions | `XCLANG_RUNTIMES_EXCEPTIONS=OFF` | `--@xclang//runtimes:exceptions=false` |
| `libc++` without RTTI (and without exceptions) | `XCLANG_RUNTIMES_RTTI=OFF` | `--@xclang//runtimes:rtti=false` |
| Sanitizers: `address`, `memory`, `thread`, `undefined`, `leak` | `XCLANG_SANITIZER` | `--features=asan`, `msan`, `tsan`, `ubsan`, `lsan` |
| Extra compile flags for `libc++` and `libc++abi` | `XCLANG_RUNTIMES_FLAGS` | the build's `--copt` |
| ThinLTO of `libc++` with the program | `XCLANG_RUNTIMES_FLAGS=-flto=thin` | not available |
| Extra CMake arguments for LLVM's runtimes build | `XCLANG_RUNTIMES_CMAKE_ARGS` | |
| Directory where runtime variants are stored | `XCLANG_RUNTIMES_DIR` | Bazel's output base and action cache |

The runtime options configure `libc++` and `libc++abi`; pass matching language
flags such as `-fno-exceptions` or `-fno-rtti` in the project's own compile
flags (`CMAKE_CXX_FLAGS`, `--copt` or `--cxxopt`) as well. Full option lists
are in the [CMake API](../reference/cmake-api.md) and the
[Bazel API](../reference/bazel-api.md).

## Behavior

- **Same build configuration as the prebuilt runtimes**: CMake builds LLVM's
  `runtimes/` directory with the CMake cache variables and target config file
  used to build xclang's prebuilt runtimes. With default options, it produces
  the same `__config_site` and library code. Bazel compiles the same source
  files with the same per-target flags, extracted from LLVM's CMake build by
  `packages/bazel/runtimes.ts`.
- **What is built**: `libc++` (with `libc++abi` merged into `libc++.a`),
  `libc++experimental.a`, and `libunwind.a` (except on macOS, which unwinds
  with `libSystem`). With MemorySanitizer, `compiler-rt`'s MSan runtime
  (`libclang_rt.msan.a` and `libclang_rt.msan_cxx.a`) is built as well.
- **Replaces the prebuilt runtimes**: the variant's `__config_site` directory
  is placed before `libc++`'s shared headers on the include path, and links
  pass `-nostdlib++` and link the variant's libraries instead of the prebuilt
  ones. `import std` (`xclang::std` and `@xclang//bazel:std`) compiles from
  the variant.
- **`libunwind` stays uninstrumented**: under sanitizers, `libunwind` is
  compiled without sanitizer instrumentation, just as in the prebuilt ASan
  `libc++`, because sanitizer runtimes unwind stack traces through it and
  MemorySanitizer would report uninitialized registers read during unwinding.
- **MemorySanitizer is for the glibc Linux targets** (`x86_64` and `aarch64`).
  Its runtime is linked into executables with `--whole-archive` and
  `--export-dynamic`, matching how `clang` links prebuilt sanitizer runtimes.
- **Every library in a program must use the same variant**: linking a library
  compiled against the prebuilt runtimes into a program that uses another ABI
  namespace, ABI version, set of ABI macros or MemorySanitizer fails to link or
  misbehaves at run time.
- **Target configuration only in Bazel**: host tools executed during the build
  (`cfg = "exec"`) are always built with the prebuilt host runtimes, regardless
  of `@xclang//runtimes:*` settings. The runtimes follow the sanitizer features
  of the overall build (`--features=asan`), not `features` attributes set on a
  single Bazel target.
- **Host requirements**: CMake's runtime build runs LLVM's CMake scripts and
  requires Python 3 on the host; Bazel needs no additional host tools.
- **Not for the MSVC targets**: CMake and Bazel refuse runtimes from source
  for them ([planned](../design/roadmap.md#runtimes-msvc)).
- **One C++ library**: `-stdlib=platform` (`XCLANG_STDLIB=platform`,
  `--@xclang//bazel:stdlib=platform`) takes the platform's C++ library, and
  runtimes from source build `libc++`: a build has one or the other.
- **No LTO of the runtimes in Bazel**: `--features=thin_lto` links the
  program against runtimes compiled to machine code, as Bazel runs ThinLTO's
  backends only for the libraries in `deps`, not for those the toolchain
  links ([considered](../design/roadmap.md#runtimes-bazel-lto)).


### The Sources

Every toolchain archive includes the runtime sources once for all targets in
`libc++/src`, alongside `libc++/include`: `llvm-project`'s `runtimes/`,
`cmake/`, `llvm/cmake/`, `libcxx/`, `libcxxabi/`, `libunwind/`, `compiler-rt/`,
and the internal `libc` headers that `libc++` includes, without tests or
documentation and with xclang's `libc++` [patches](../reference/patches.md)
applied. They occupy 35 MB unpacked (2.3 MB in each compressed archive).
