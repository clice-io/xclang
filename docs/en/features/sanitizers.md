# Sanitizers

For the Linux and macOS targets, compiler-rt carries AddressSanitizer
(ASan), ThreadSanitizer (TSan), LeakSanitizer, UBSan and libFuzzer. Those
targets also carry an ASan build of libc++, the *ASan libc++*, which ASan
programs link.

## Usage

The examples are in
[examples/sanitizers](https://github.com/clice-io/xclang/tree/main/examples/sanitizers).
`overflow.cpp` reads past the end of a string, but within its capacity:

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
string, so ASan sees nothing wrong.

### CMake

An ASan build takes the ASan libc++ in its compile and link flags.
`xclang::std` picks up `CMAKE_CXX_FLAGS`, so `import std` matches:

```sh
cmake -G Ninja -B build-asan -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    "-DCMAKE_CXX_FLAGS=-fsanitize=address -isystem $asan/include" \
    "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address -nostdlib++ $asan/libc++.a"
cmake --build build-asan
./build-asan/overflow
```

### Bazel

The sanitizers are features of the whole build. `--features=asan` compiles
and links with the ASan libc++:

```sh
bazel run -c dbg --features=asan //:overflow
bazel run -c dbg --features=tsan //:race
```

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

## Not Yet Supported

| | status |
|---|---|
| [Sanitizers for MSVC targets](../design/roadmap.md#msvc), part of the MSVC targets | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [MemorySanitizer](../design/roadmap.md#msan) | Planned |

MemorySanitizer needs every library instrumented, libc++ too, and
ThreadSanitizer reports better through an instrumented libc++. Both need
libc++ built from source with the options of the program, which is
[planned](../design/roadmap.md#libc-on-demand).
