# Sanitizers

compiler-rt carries, for the Linux and macOS targets, AddressSanitizer,
ThreadSanitizer, LeakSanitizer, UBSan and libFuzzer, and those targets also
carry an ASan build of libc++. Windows targets have no sanitizers yet.
MemorySanitizer is not there: it needs every library instrumented.

```sh
clang++ -fsanitize=address -g -O1 main.cpp -o main
clang++ -fsanitize=thread -g -O1 main.cpp -o main
clang++ -fsanitize=fuzzer -g -O1 fuzz.cpp -o fuzz
```

tests/smoke.ts builds and runs each of these on every Linux and macOS host
and checks the report.

## ASan and libc++

An ASan program should link libc++'s ASan build, `<asan>`: `lib/asan` of
the target directory (`usr/lib/asan` on Linux). It compiles and links with
it, all of it, libraries too:

```
compile   -fsanitize=address -isystem <asan>/include
link      -fsanitize=address -nostdlib++ <asan>/libc++.a
```

tests/smoke.ts does both in one command:

```sh
clang++ -fsanitize=address -isystem <asan>/include -nostdlib++ <asan>/libc++.a -g -O0 x.cpp -o x
```

In Bazel, `--features=asan` does it; in CMake, add the two to the ASan
build's flags.

**Why.** libc++ annotates its containers for ASan: `std::vector` tells ASan
which part of its buffer is in use, so a read past `size()` but within
`capacity()` is a *container-overflow*. The annotations are made by
whichever copy of a function runs, and checked on every access. A program
compiled with ASan against a libc++ that is not has two kinds of code
working on the same container: the program's instrumented inlines, which
annotate, and the library's uninstrumented copies of the same functions,
which do not. When the linker picks one copy of a function for both (a
template the library also instantiates, `std::vector<std::string_view>`'s
`push_back` inside `std::filesystem`), the annotations no longer match the
writes, and ASan reports overflows that are not there. catter's macOS
tests hit exactly this in `std::filesystem::relative`.

xclang's first answer, in 23.1.2.3, was a patch that put ASan into libc++'s
ABI tag, so instrumented and uninstrumented copies got different names.
Upstream's answer to the report was that an ASan program with an
uninstrumented library is already broken; the patch also could not help
with code outside libc++ growing an instrumented container, or with an
`import std` built without ASan. From 23.1.2.5, libc++ itself comes
instrumented: its `libc++.a` built with ASan, and a `__config_site` that
differs from the normal one only in `_LIBCPP_INSTRUMENTED_WITH_ASAN`, which
also turns on `std::string`'s container checks. Every piece of the
program's C++ is then instrumented the same way, and the reports are real.

tests/smoke.ts checks both sides: an overflow within a `std::string`'s
capacity is reported, and a program sharing `std::filesystem`'s
instantiations with `libc++.a` gets no false report.

The other sanitizers need nothing of the kind: TSan and UBSan programs link
the normal libc++.

## On macOS

The sanitizers' runtimes are dylibs on macOS (`libclang_rt.asan_osx_dynamic.dylib`
and the rest), which a program loads from the toolchain's resource
directory or from its own directory. An ASan build is for testing, not for
shipping, so it is the one exception to [hermeticity](../design/hermeticity.md).
In Bazel the sanitizer features link the toolchain's absolute path as an
rpath, and only those links depend on the checkout.

## libclang's ASan build

`libclang-<version>-<host>-asan.tar.xz`, for Linux x64 and macOS arm64, is
clang's libraries built with assertions and ASan, against libc++'s ASan
build, for debugging a tool on libclang ([libclang](libclang.md)).

## Not there yet

- Sanitizers for Windows targets.
- MemorySanitizer, which needs libc++ instrumented with it too; ThreadSanitizer
  also reports better through an instrumented libc++. Both need libc++
  built from source with the program's options, which is
  [planned](../design/roadmap.md#libc-built-on-demand).
