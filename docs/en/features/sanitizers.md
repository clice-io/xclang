# Sanitizers

`compiler-rt` carries the sanitizers' runtimes for each target, and the
targets with ASan an ASan build of `libc++` (the *ASan `libc++`*), which
ASan programs link. MemorySanitizer comes with the
[runtimes from source](runtimes-from-source.md). libFuzzer is there for the
glibc Linux, macOS and x64 MSVC targets.

<!-- BEGIN GENERATED: sanitizers -->

| target | ASan | LSan | TSan | UBSan | MSan |
| --- | --- | --- | --- | --- | --- |
| `x86_64-unknown-linux-gnu` | yes | yes | yes | yes | with the runtimes from source |
| `aarch64-unknown-linux-gnu` | yes | yes | yes | yes | with the runtimes from source |
| `x86_64-w64-mingw32` | yes |  |  | yes |  |
| `aarch64-w64-mingw32` |  |  |  | yes |  |
| `aarch64-apple-darwin` | yes | yes | yes | yes |  |
| `x86_64-apple-darwin` | yes | yes | yes | yes |  |
| `x86_64-unknown-linux-musl` |  |  |  | yes |  |
| `aarch64-unknown-linux-musl` |  |  |  | yes |  |
| `x86_64-pc-windows-msvc` | yes |  |  | yes |  |
| `aarch64-pc-windows-msvc` |  |  |  | yes |  |

<!-- END GENERATED -->

How each family differs: [MinGW Targets](#mingw-targets),
[MSVC Targets](#msvc-targets), [musl Targets](#musl-targets),
[MemorySanitizer](#memorysanitizer).

## Usage

The examples are in
[examples/sanitizers](https://github.com/clice-io/xclang/tree/main/examples/sanitizers).
The CMake and plain `clang++` commands below run in that directory inside
`pixi shell` after `pixi install`, on a Linux or macOS host.

`overflow.cpp` reads past the end of a `std::string`, within its allocated
capacity:

<!-- file: examples/sanitizers/overflow.cpp -->
```cpp
#include <cstdio>
#include <string>

int main(int argc, char**) {
    std::string s(40, 'x');
    s.reserve(100);
    // Past size(), within capacity(): only an instrumented libc++ annotates it.
    volatile char c = s.data()[40 + argc];
    (void)c;
    std::puts("no report");
}
```

`race.cpp` has a data race between two threads:

<!-- file: examples/sanitizers/race.cpp -->
```cpp
#include <chrono>
#include <thread>

int shared;

int main() {
    std::thread t([] { shared++; });
    // The thread's write first, then the main thread's, which races with
    // it: in this order TSan reports the race every time.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    shared++;
    t.join();
}
```

`fuzz.cpp` is a libFuzzer target:

<!-- file: examples/sanitizers/fuzz.cpp -->
```cpp
#include <cstddef>
#include <cstdint>

#include <fuzzer/FuzzedDataProvider.h>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    FuzzedDataProvider input(data, size);
    if (input.ConsumeIntegral<char>() == 'x') {
        volatile int sum = input.ConsumeIntegral<int>();
        (void)sum;
    }
    return 0;
}
```

### CMake

With xclang's toolchain file (`--toolchain $XCLANG/lib/cmake/xclang/toolchain.cmake`),
pass `-DXCLANG_SANITIZER=address`, `thread`, `undefined` or `leak` (or
`memory` with `-DXCLANG_RUNTIMES=source`; see
[MemorySanitizer](#memorysanitizer)). `XCLANG_SANITIZER` adds the corresponding
`-fsanitize=` flag to every compile and link in the build, and for `address`
automatically switches to the prebuilt ASan `libc++` (or builds an instrumented
`libc++` when `XCLANG_RUNTIMES=source` is set).

Without the toolchain file, pass `-fsanitize=address` and the ASan `libc++`
flags in `CMAKE_CXX_FLAGS` and `CMAKE_EXE_LINKER_FLAGS`, where
`asan=$(dirname "$(clang++ -print-library-module-manifest-path)")/asan`
([Plain Clang](#plain-clang)):

<!-- file: examples/sanitizers/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(sanitizers LANGUAGES CXX)

add_executable(overflow overflow.cpp)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build-asan -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    "-DCMAKE_CXX_FLAGS=-fsanitize=address -isystem $asan/include" \
    "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address -nostdlib++ $asan/libc++.a"
cmake --build build-asan
```

`./build-asan/overflow` reports the `container-overflow`. Because `xclang::std`
is compiled with `CMAKE_CXX_FLAGS`, a project that uses `import std` compiles
the `std` module with matching sanitizer flags ([C++20 modules](modules.md#cmake)).

### Bazel

Enable a sanitizer across the whole build with `--features=asan`,
`--features=tsan`, `--features=ubsan` or `--features=lsan`:

<!-- file: examples/sanitizers/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "overflow",
    srcs = ["overflow.cpp"],
)

cc_binary(
    name = "race",
    srcs = ["race.cpp"],
)
```

::: details MODULE.bazel and .bazelrc

<!-- file: examples/sanitizers/MODULE.bazel -->
```python
module(name = "sanitizers")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.3.4")
```

<!-- file: examples/sanitizers/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
```

:::

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run -c dbg --features=asan //:overflow
bazel run -c dbg --features=tsan //:race
```

The first command reports the `container-overflow` and the second the data
race; both exit with the sanitizer's non-zero exit code.

- `--features=asan` compiles and links every C++ target against the ASan
  `libc++`.
- Requesting a sanitizer that the target platform does not support stops the
  build immediately at analysis time with an error naming the target and
  sanitizer.
- On `x86_64` Windows targets, `--features=asan` copies the ASan runtime DLL
  beside every binary in `bazel-bin` and in its runfiles so `bazel run` and
  `bazel test` can start it ([MinGW Targets](#mingw-targets)).
- Adding `--@xclang//runtimes:source` compiles `libc++`, `libc++abi` and
  `libunwind` from source with the build's sanitizer features, and enables
  `--features=msan` on the glibc Linux targets
  ([MemorySanitizer](#memorysanitizer),
  [runtimes from source](runtimes-from-source.md#bazel)).

### Plain Clang

On Linux, macOS and MinGW targets, the ASan `libc++` sits in the `asan`
directory next to `libc++.modules.json` (`usr/lib/asan` in the sysroot on
Linux, `lib/asan` on macOS and MinGW):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
asan=$(dirname "$(clang++ -print-library-module-manifest-path)")/asan
clang++ -fsanitize=address -g -O1 overflow.cpp -o overflow-plain
clang++ -fsanitize=address -isystem "$asan/include" -nostdlib++ "$asan/libc++.a" -g -O1 overflow.cpp -o overflow
clang++ -fsanitize=thread -g -O1 race.cpp -o race
clang++ -fsanitize=fuzzer -g -O1 fuzz.cpp -o fuzz
```

| command | prints | exit code |
|---|---|---|
| `./overflow-plain` | `no report` | 0 |
| `./overflow` | `ERROR: AddressSanitizer: container-overflow` in `main`, `overflow.cpp:8` | 1 |
| `./race` | `WARNING: ThreadSanitizer: data race` | 66 |
| `./fuzz -runs=1000` | `Done 1000 runs` | 0 |

`overflow-plain` links the normal `libc++`, which does not annotate the
`std::string` buffer, so ASan does not detect the out-of-bounds read. On macOS,
a sanitizer report aborts the process, so the shell reports exit code `134`.

## Options

| | Plain Clang | CMake (toolchain file) | Bazel |
|---|---|---|---|
| AddressSanitizer | `-fsanitize=address` + ASan `libc++` | `-DXCLANG_SANITIZER=address` | `--features=asan` |
| ThreadSanitizer | `-fsanitize=thread` | `-DXCLANG_SANITIZER=thread` | `--features=tsan` |
| UBSan | `-fsanitize=undefined` | `-DXCLANG_SANITIZER=undefined` | `--features=ubsan` |
| LeakSanitizer | `-fsanitize=leak` | `-DXCLANG_SANITIZER=leak` | `--features=lsan` |
| libFuzzer | `-fsanitize=fuzzer` | `-fsanitize=fuzzer` in compile/link flags | |
| MemorySanitizer | | `-DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory` | `--@xclang//runtimes:source --features=msan` |
| ASan `libc++` flags | compile: `-isystem $asan/include`; link: `-nostdlib++ $asan/libc++.a` (MSVC: compile flag only) | included in `XCLANG_SANITIZER=address` | included in `--features=asan` |

Full option lists are in the [CMake API](../reference/cmake-api.md) and the
[Bazel API](../reference/bazel-api.md).

## Behavior

- **Every C++ library in an ASan program must use the ASan `libc++`**: `libc++`
  annotates its containers (`std::vector`, `std::string`) so ASan knows which
  portion of the allocated buffer is within `size()` and reports accesses
  between `size()` and `capacity()` as `container-overflow`. Mixing code built
  against the ASan `libc++` and the uninstrumented `libc++` produces false
  `container-overflow` reports ([below](#why-an-asan-libc)).
- **Other sanitizers use the normal `libc++`**: TSan, UBSan and LSan builds
  link the standard prebuilt `libc++` unless
  [runtimes from source](runtimes-from-source.md) are requested.
- **Dynamic sanitizer runtimes on macOS and Windows**: on macOS, sanitizer
  runtimes are `.dylib` files such as `libclang_rt.asan_osx_dynamic.dylib`,
  loaded from the toolchain's resource directory or the binary's directory. On
  Windows, the `x86_64` ASan runtime is a DLL. Because sanitizer builds are
  used for testing rather than shipping, loading these dynamic runtimes is an
  exception to [hermeticity](../design/hermeticity.md). In Bazel on macOS
  hosts, the sanitizer features add the toolchain's resource directory as an
  `rpath`; binaries cross-compiled on Linux or Windows look for the `.dylib` in
  their own directory.
- **ASan build of `libclang`**: for Linux `x86_64` and macOS `arm64` hosts,
  xclang provides an ASan-instrumented build of `libclang` compiled against the
  ASan `libc++` ([libclang](libclang.md#the-asan-build)).
- **No ASan build of the platform's C++ library**: with
  `XCLANG_STDLIB=platform`, `XCLANG_SANITIZER=address` links no ASan C++
  library, and on the MSVC targets the STL's containers under ASan need
  `stl_asan.lib`, which `xclang sdk fetch windows` does not fetch.


### Why an ASan libc++

Container annotations are written by whichever copy of a container method runs,
and checked on every element access. When a program compiled with
`-fsanitize=address` links an uninstrumented `libc++.a`, two versions of the
same container methods exist in the binary: inline functions in the program
are compiled with ASan and update container annotations, while functions and
template instantiations compiled into `libc++.a` are not.

When the linker keeps one copy of a template instantiated in both places, and
picks the uninstrumented one from `libc++.a`, vector growth no longer updates the ASan
shadow memory and later reads report a false `container-overflow`. That is
what catter's macOS tests hit, with `std::vector<std::string_view>::push_back`
inside `std::filesystem::relative`.

xclang therefore ships an ASan-instrumented `libc++` alongside the normal one.
It consists of a `libc++.a` (or `libc++asan-x86_64.lib` on MSVC) compiled with
`-fsanitize=address` and a `__config_site` header that defines
`_LIBCPP_INSTRUMENTED_WITH_ASAN`, which also turns on container annotations for
`std::string`. Compiling with `-isystem $asan/include` and linking the ASan
`libc++` instruments the program and the standard library identically.

## MinGW Targets

The MinGW targets carry UBSan on `x86_64` and `aarch64` and ASan with the ASan
`libc++` on `x86_64`, matching what `compiler-rt` and `llvm-mingw` support on
Windows. `clang` selects the runtime libraries from
`lib/clang/<major>/lib/<arch>-w64-windows-gnu` when `-fsanitize=` is passed.

- **ASan's runtime is a DLL**: Windows has no static ASan runtime, so ASan
  programs link `libclang_rt.asan_dynamic.dll.a` and load
  `libclang_rt.asan_dynamic.dll` at startup from their own directory or `PATH`.
  On the `x86_64` Windows host, a copy of the DLL sits in the toolchain's
  `bin/` directory, which `pixi` or `conda` activation places on `PATH`; on
  other machines, copy the DLL next to the `.exe`. In Bazel, `--features=asan`
  places the DLL beside every binary in `bazel-bin` and in its runfiles. Unlike
  `llvm-mingw`'s ASan DLL, xclang links `libc++` and `libunwind` into the DLL
  statically so it depends only on Windows system DLLs and UCRT.
- **The ASan `libc++`** is in `x86_64-w64-mingw32/lib/asan` (`$asan` below):
  pass `-isystem $asan/include` when compiling and `-nostdlib++ $asan/libc++.a`
  when linking, or use CMake's `-DXCLANG_SANITIZER=address` or Bazel's
  `--features=asan`.
- **Native `x86_64` Windows only**: an `x86_64` ASan program must run on
  `x86_64` Windows; under `arm64` Windows' `x86_64` emulator, ASan cannot
  intercept the C runtime's functions.
- **Unsupported sanitizers**: `compiler-rt` has no TSan, LeakSanitizer,
  MemorySanitizer or libFuzzer for MinGW, and no ASan for `aarch64` Windows.
  CMake and Bazel reject those sanitizers for MinGW targets.

`ubsan.cpp`, in `examples/sanitizers`, triggers a signed integer overflow:

<!-- file: examples/sanitizers/ubsan.cpp -->
```cpp
#include <climits>
#include <cstdio>

int main(int argc, char**) {
    int n = INT_MAX;
    // A signed overflow: UBSan reports it, and the program goes on.
    n += argc;
    std::printf("%d\n", n);
}
```

Cross-compile both examples from any host:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
asan=$(dirname "$(clang++ --target=x86_64-w64-mingw32 -print-library-module-manifest-path)")/asan
clang++ --target=x86_64-w64-mingw32 -fsanitize=address -isystem "$asan/include" -nostdlib++ "$asan/libc++.a" \
    -g -O1 overflow.cpp -o overflow.exe
clang++ --target=aarch64-w64-mingw32 -fsanitize=undefined -O1 ubsan.cpp -o ubsan.exe
```

On an `x86_64` Windows machine with `libclang_rt.asan_dynamic.dll` beside it or
on `PATH`, `overflow.exe` reports the `container-overflow`. On `arm64` Windows,
`ubsan.exe` reports `runtime error: signed integer overflow` and prints
`-2147483648`.

With [Bazel](#bazel) on an `x86_64` Windows host, `--features=asan` places the
DLL beside the executable and runs it:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run -c dbg --features=asan //:overflow
```

It reports the `container-overflow` and exits with code `1`.

## MSVC Targets

The [MSVC targets](../guide/cross-compiling.md#msvc-targets) carry UBSan on `x86_64`
and `aarch64`, and ASan and libFuzzer on `x86_64`. `clang` selects their
libraries from `lib/clang/<major>/lib/windows` when `-fsanitize=` is passed.

- **The `x86_64` ASan `libc++`** is
  `lib/clang/<major>/lib/windows/libc++asan-x86_64.lib`, with its
  `__config_site` in `$XCLANG/x86_64-pc-windows-msvc/lib/asan/include`. Pass
  `-isystem $XCLANG/x86_64-pc-windows-msvc/lib/asan/include` when compiling:
  its `__config_site` embeds `#pragma comment(lib, "libc++asan-x86_64.lib")` in
  every object file in place of `libc++-x86_64.lib`, so the link step needs no
  extra library flag and works with the hybrid CRT, `/MD` and the static CRT
  alike. CMake's `-DXCLANG_SANITIZER=address` and Bazel's `--features=asan`
  pass this include path automatically.
- **ASan's runtime is a DLL**, `clang_rt.asan_dynamic-x86_64.dll`, even when
  linking the static CRT. The `x86_64` Windows host toolchain includes a copy
  in `bin/`; on other machines, copy it beside the executable (Bazel's
  `--features=asan` copies it automatically). Because `compiler-rt` links this
  DLL against the dynamic VC runtime, it loads `vcruntime140.dll` at run time.
- **Not compatible with `-stdlib=platform` containers**: when compiling against
  Microsoft's STL (`-stdlib=platform`), STL containers under ASan reference
  `stl_asan.lib`, which `xclang sdk fetch windows` does not fetch.
- **No `aarch64` ASan or libFuzzer**: LLVM 23 does not support ASan or
  libFuzzer on `arm64` Windows.

With the Windows SDK fetched, cross-compile from any host using `ubsan.cpp`
from [MinGW Targets](#mingw-targets):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-pc-windows-msvc -fsanitize=address -isystem "$XCLANG/x86_64-pc-windows-msvc/lib/asan/include" \
    -g -O1 overflow.cpp -o overflow.exe
clang++ --target=aarch64-pc-windows-msvc -fsanitize=undefined -O1 ubsan.cpp -o ubsan.exe
```

With `clang_rt.asan_dynamic-x86_64.dll` beside it, `overflow.exe` reports the
`container-overflow`; `ubsan.exe` reports
`runtime error: signed integer overflow` and prints `-2147483648`.

## musl Targets

The [musl targets](../guide/cross-compiling.md#musl-targets) link statically, and only
UBSan works in a statically linked executable: its standalone runtime
(`-fsanitize=undefined`, `-DXCLANG_SANITIZER=undefined` in CMake,
`--features=ubsan` in Bazel), its minimal runtime
(`-fsanitize-minimal-runtime`), or trapping mode (`-fsanitize-trap=undefined`).

ASan, TSan and LSan intercept C library functions and look up the underlying
symbols via `dlsym`, which a static musl binary does not have; linking their
runtimes into a static binary fails with `undefined hidden symbol: _DYNAMIC`,
and libFuzzer fails at its first `sigaction` call. Those runtimes are therefore
not built for musl. Build for the glibc target of the same architecture to run
ASan, TSan, LSan or libFuzzer; a dynamically linked musl target variant for
them is [considered](../design/roadmap.md#musl-sanitizers).

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-unknown-linux-musl -fsanitize=undefined -O1 ubsan.cpp -o ubsan
```

`ubsan` is a static executable that runs on any Linux `x86_64` machine.

## MemorySanitizer

MemorySanitizer (MSan) requires every library in the program, including
`libc++` and `libc++abi`, to be compiled with `-fsanitize=memory`, along with
`compiler-rt`'s MSan runtime. Because prebuilt archives do not include an
MSan-instrumented `libc++` or MSan runtime, xclang builds both on demand on the
glibc Linux targets (`x86_64` and `aarch64`) when
[runtimes from source](runtimes-from-source.md) are enabled:

- **CMake**: pass `-DXCLANG_RUNTIMES=source -DXCLANG_SANITIZER=memory` with the
  toolchain file.
- **Bazel**: pass `--@xclang//runtimes:source --features=msan`.

Enabling [runtimes from source](runtimes-from-source.md) with TSan or ASan also
compiles `libc++` and `libc++abi` from source with that sanitizer's
instrumentation.
