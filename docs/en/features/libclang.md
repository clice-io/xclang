# libclang and the option tables

For tools built on clang, such as [clice](https://github.com/clice-io/clice)
and [catter](https://github.com/clice-io/catter).

## libclang

`libclang-<version>-<host>.tar.xz` holds the clang and LLVM static
libraries and headers, with LLVM's and clang's CMake packages. They are the
libraries that host's clang was linked from, taken from the same build
without the parts a tool does not link:

- **PGO and ThinLTO bitcode**, so they need an lld of the same release:
  link with that release's toolchain. A link generates the code of every
  module the tool uses, minutes each time; the linker's ThinLTO cache
  ([the ThinLTO cache](thinlto-cache.md), [Bazel](../integrations/bazel.md#the-thinlto-cache))
  makes the links after the first take seconds.
- **No RTTI**: code using them compiles with `-fno-rtti`, as LLVM's did.
- **libc++**, xclang's own, as every program of the toolchain.
- zlib and zstd, which LLVM's libraries link, are in the archive, found
  through the same `CMAKE_PREFIX_PATH`.
- clang's resource directory (`lib/clang/<major>`) carries compiler-rt's
  headers (`sanitizer/`, `fuzzer/`, ...) next to clang's own, as the
  toolchain's does: a tool hands it to every compiler it stands in for.
- clang-tidy's headers with `clang-tidy/clang-tidy-config.h`, the header
  clang-tidy's build generates from how xclang configures it (no static
  analyzer, no query-based checks), which its headers include (from
  23.1.2.6 on).
- **Every target's MC layer**: TargetInfo, MC descriptions, assembly
  parser and disassembler, which clang parses MS-style `__asm {}` with
  (X86's), and a tool registers (`InitializeAllTargetInfos()`,
  `InitializeAllTargetMCs()`, `InitializeAllAsmParsers()`,
  `InitializeAllDisassemblers()`) to look a target up by triple: to infer it
  from a compiler's name (`aarch64-linux-gnu-g++`, say). CMake's
  `AllTargetsInfos`, `AllTargetsDescs`, `AllTargetsAsmParsers` and
  `AllTargetsDisassemblers` components are those libraries, as
  `@libclang//:AllTargetsInfos` and the like are for Bazel (from 23.1.2.6
  on). No target's code generator: `InitializeAllTargets()`,
  `InitializeAllAsmPrinters()` and `InitializeNativeTarget()` do not link.
- `lib/cmake/xclang/libclang.cmake` records the build: `XCLANG_LLVM_VERSION`,
  `XCLANG_LTO`, `XCLANG_PGO`, `XCLANG_PATCHES` (the [patches](../design/patches.md)
  applied, in order), and so on.

`libclang-<version>-<host>-asan.tar.xz`, for Linux x64 and macOS arm64, is
a build with assertions and AddressSanitizer, at `-O1` and without PGO or
ThinLTO, for debugging a tool, with the same headers and libraries. It is
built against libc++'s ASan build, so the tool is too
([sanitizers](sanitizers.md)).

### CMake

```cmake
cmake_minimum_required(VERSION 3.20)
project(tool CXX)

find_package(Clang REQUIRED CONFIG)

add_executable(tool main.cpp)
set_target_properties(tool PROPERTIES CXX_STANDARD 17)
target_compile_options(tool PRIVATE -fno-rtti)
target_include_directories(tool SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(tool PRIVATE clangBasic clangLex LLVMSupport)
```

```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=<xclang>/bin/clang++ \
    -DCMAKE_PREFIX_PATH=<libclang>
```

tests/libclang is this tool; every host builds and runs it
(tests/libclang.ts, and through xclang's [CMake package](../integrations/cmake.md) in
tests/cmake).

### Bazel

`@libclang//:clangBasic`, `:clangLex`, `:LLVMSupport` and every other
library come with the link interface LLVM's and clang's CMake packages give
them (system libraries, zlib, zstd), so a target names only what it uses;
`:headers` and `:resource_dir` are there too. Its code compiles with
`-fno-rtti`, and the toolchain of the same release links the ThinLTO
bitcode. `@libclang_asan` is the ASan build, for Linux x64 and macOS arm64,
used with `--features=asan`, and `@libclang` is that too in a build with
`--features=asan`: its libraries, headers and resource directory switch
together, and a build for a target without an ASan build says so. (A
target's own `features = ["asan"]` switches no dependency.) Both are the
target platform's: built for another target
([cross-compiling](../integrations/bazel.md#cross-compiling)), a tool links that target's
archive, which is downloaded only then; `@libclang_<triple>` is one
target's.

A tool on libclang finds clang's resource directory, with clang's headers,
in `lib/clang` next to the directory of its program, as clang itself does.
`xclang_resource_dir` lays `@libclang`'s out there for a program `bin/<name>`
of its package, in `bazel-bin` and in the runfiles:

```python
load("@xclang//bazel:resource_dir.bzl", "xclang_resource_dir")

cc_binary(
    name = "bin/tool",
    srcs = ["main.cpp"],
    data = [":resource_dir"],
    deps = ["@libclang//:clangOptions"],
)

xclang_resource_dir(name = "resource_dir")
```

```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "libclang_asan", "llvm_option_inc")
```

`--repo_env=XCLANG_LIBCLANG_ROOT=<libclang>` (`XCLANG_LIBCLANG_ASAN_ROOT`)
uses an unpacked archive of the host's instead of the release's.

## The option tables

`llvm-option-inc-<version>.tar.xz` holds the option tables of clang, lld
(ELF, COFF, MachO, MinGW, wasm), llvm-lib and llvm-dlltool, TableGen's
output from the same build, for tools that parse those command lines
without linking LLVM:

```cpp
#include <llvm-options-td/clang-Driver-Options.inc>
```

The same tables are the conda package `llvm-option-inc` (in
`$PREFIX/include`) and the Bazel repository `@llvm_option_inc`.
