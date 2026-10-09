# Sanitizers

For the Linux and macOS targets, compiler-rt carries AddressSanitizer
(ASan), ThreadSanitizer (TSan), LeakSanitizer, UBSan and libFuzzer. Those
targets also carry an ASan build of libc++, the *ASan libc++*, which ASan
programs link. The MSVC targets carry UBSan, and for x64 ASan and
libFuzzer ([below](#msvc-targets)); the musl targets UBSan
([below](#musl-targets)).

## Usage

The examples are in
[examples/sanitizers](https://github.com/clice-io/xclang/tree/main/examples/sanitizers).
The CMake and plain clang commands below run in that directory, in a
`pixi shell` after `pixi install`, on a Linux or macOS host.

`overflow.cpp` reads past the end of a string, but within its capacity:

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

`race.cpp` has a data race:

<!-- file: examples/sanitizers/race.cpp -->
```cpp
#include <thread>

int shared;

int main() {
    std::thread t([] { shared++; });
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

### Plain Clang

The ASan libc++ is in the `asan` directory next to the module manifest of
libc++: `usr/lib/asan` of the sysroot on Linux, `lib/asan` on macOS.

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

`overflow-plain` links the normal libc++, which does not annotate the
string, so ASan sees nothing wrong. On macOS, a report ends in an abort,
so a shell gives exit code 134 instead.

### CMake

An ASan build takes the ASan libc++ in its compile and link flags, with
`$asan` from above:

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

`./build-asan/overflow` reports the container-overflow. `xclang::std`
picks up `CMAKE_CXX_FLAGS`, so in a project with `import std` the module
matches.

### Bazel

The sanitizers are features of the whole build. `--features=asan` compiles
and links with the ASan libc++:

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
bazel_dep(name = "xclang", version = "23.1.2.8")
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

The first reports the container-overflow, the second the data race. Both
end with the exit code of the program.

## Options

| | plain clang, CMake | Bazel |
|---|---|---|
| AddressSanitizer | `-fsanitize=address`, and the ASan libc++ (below) | `--features=asan` |
| ThreadSanitizer | `-fsanitize=thread` | `--features=tsan` |
| UBSan | `-fsanitize=undefined` | `--features=ubsan` |
| LeakSanitizer | `-fsanitize=leak` | `--features=lsan` |
| libFuzzer | `-fsanitize=fuzzer` | |
| the ASan libc++ | compile: `-isystem $asan/include`; link: `-nostdlib++ $asan/libc++.a` | part of `asan` |

## Behavior

- **ASan programs link the ASan libc++, all of them.** libc++ annotates
  its containers for ASan: `std::vector` tells ASan which part of its
  buffer is in use, so a read past `size()` but within `capacity()` is a
  *container-overflow*. The program and every library in it must use the
  same libc++, or ASan reports overflows that are not there (below).
- **The other sanitizers link the normal libc++.** TSan and UBSan programs
  need nothing of the kind.
- **On macOS, the runtimes are dylibs**, such as
  `libclang_rt.asan_osx_dynamic.dylib`. A program loads them from the
  resource directory of the toolchain, or from its own directory. An ASan
  build is for testing, not for shipping, so this is the one exception to
  [hermeticity](../design/hermeticity.md#known-limitations). In Bazel, the
  sanitizer features link the absolute path of the toolchain as an rpath.
- **libclang has an ASan build too**, for Linux x64 and macOS arm64 hosts.
  It is built against the ASan libc++
  ([libclang](libclang.md#the-asan-build)).

### Why an ASan libc++

The annotations are made by whichever copy of a function runs, and checked
on every access. A program compiled with ASan against an uninstrumented
libc++ has two kinds of code working on the same container. The inline
functions of the program are instrumented and annotate; the copies of the
same functions in the library are not.

When the linker picks one copy of a function for both, the annotations no
longer match the writes. A template that the library also instantiates is
such a function: `std::vector<std::string_view>::push_back` inside
`std::filesystem`, for example. catter's macOS tests hit exactly this in
`std::filesystem::relative`.

xclang's first answer, in 23.1.2.3, was a patch that put ASan into the ABI
tag of libc++, so that instrumented and uninstrumented copies got
different names. Upstream answered that an ASan program with an
uninstrumented library is already broken. The patch also could not help
code outside libc++ that grows an instrumented container, or an
`import std` built without ASan.

From 23.1.2.5 on, libc++ itself comes instrumented. The ASan libc++ is a
`libc++.a` built with ASan, and a `__config_site` that differs from the
normal one only in `_LIBCPP_INSTRUMENTED_WITH_ASAN`. That macro also turns
on the container checks of `std::string`. Every piece of the C++ of the
program is then instrumented the same way, and the reports are real.

## MSVC Targets

The [MSVC targets](../integrations/clang.md#msvc-targets) carry UBSan,
and for x64 ASan and libFuzzer, as compiler-rt has them for Windows.
clang names their libraries itself, with `-fsanitize=`, from
`lib/clang/<major>/lib/windows`.

- **The ASan libc++ of x64** is
  `lib/clang/<major>/lib/windows/libc++asan-x86_64.lib`, with its
  `__config_site` in `x86_64-pc-windows-msvc/lib/asan/include` of the
  toolchain directory, `$XCLANG` below. An ASan build compiles with
  `-isystem $XCLANG/x86_64-pc-windows-msvc/lib/asan/include`, whose
  `__config_site` names the ASan library in every object in place of the
  normal one; the link needs nothing more. It names no ASan runtime
  either, so it serves every C runtime. Bazel's `--features=asan` does the
  same ([Bazel](../integrations/bazel.md#use-sanitizers)).

- **ASan's runtime is a DLL**, `clang_rt.asan_dynamic-x86_64.dll`, also for
  a program with the static CRT. Copy it next to the program. It loads
  `vcruntime140.dll`, as compiler-rt builds it with the DLL CRT.
- The hybrid CRT, `/MD` and the static CRT all work with ASan.
- With Microsoft's STL (`-stdlib=platform`), an ASan program that uses
  the STL's containers does not link: they name the STL's
  `stl_asan.lib`, which `xclang sdk fetch` does not fetch.
- arm64 Windows has no ASan or libFuzzer in LLVM 23.

<!-- not run: needs a vendor SDK the user accepts the license of; test-sdk.yml runs these, through tests/sdk/msvc.ts, and their programs on Windows -->
```sh
clang++ --target=x86_64-pc-windows-msvc -fsanitize=address -isystem "$XCLANG/x86_64-pc-windows-msvc/lib/asan/include" \
    -g -O1 asan.cpp -o asan.exe
clang --target=aarch64-pc-windows-msvc -fsanitize=undefined -O1 ubsan.c -o ubsan.exe
```

## musl Targets

The [musl targets](../reference/targets.md#musl-targets), from 23.1.2.10
on, link statically, and of the sanitizers only UBSan works in a static
program: its standalone runtime (`-fsanitize=undefined`, `--features=ubsan`
in Bazel) and its minimal one (`-fsanitize-minimal-runtime`), or none with
`-fsanitize-trap=undefined`.

ASan, TSan and LSan intercept functions of the C library and find the real
ones through `dlsym`, which a static program has not. Their runtimes do not
link into one (`undefined hidden symbol: _DYNAMIC`), so they are not built
for musl, and neither is libFuzzer, which stops at its first `sigaction`.
Build for the glibc target of the same architecture to use them; a
dynamically linked musl variant that has them is
[considered](../design/roadmap.md#musl-sanitizers).

<!-- not run: tests/toolchain/smoke.ts builds the same and runs it on Linux -->
```sh
clang++ --target=x86_64-unknown-linux-musl -fsanitize=undefined -O1 ubsan.cpp -o ubsan
```

## Not Yet Supported

| | status |
|---|---|
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [ASan, TSan, LSan and libFuzzer for musl targets](../design/roadmap.md#musl-sanitizers) | Considered |
| [MemorySanitizer](../design/roadmap.md#msan) | Unreleased |

MemorySanitizer needs every library instrumented, libc++ too, and
compiler-rt's runtime of it, which the toolchain does not carry. On `main`,
the runtimes built from source give it both, for the Linux targets
([runtimes from source](runtimes-from-source.md)): `XCLANG_RUNTIMES=source`
with `XCLANG_SANITIZER=memory` in CMake, `--@xclang//runtimes:source` with
`--features=msan` in Bazel. ThreadSanitizer and AddressSanitizer report
through runtimes from source as well, instrumented like the program.
