# libclang and the Option Tables

For tools built on clang, such as [clice](https://github.com/clice-io/clice)
and [catter](https://github.com/clice-io/catter). In these docs,
*libclang* means the static C++ libraries of clang and LLVM, not only the
libclang C API. Each release has them for every host, as ThinLTO bitcode
built with the same PGO profile as its clang.

## Usage

The example is a small tool that lexes a line of C++ with clang's own
classes. It is in
[examples/libclang](https://github.com/clice-io/xclang/tree/main/examples/libclang):

<!-- file: examples/libclang/main.cpp -->
```cpp
// Lexes a line of C++ with libclang's own classes, and reports the
// compression the LLVM libraries were built with.
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/FileManager.h"
#include "clang/Basic/LangOptions.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Basic/Version.h"
#include "clang/Lex/Lexer.h"
#include "llvm/Support/Compression.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

int main() {
  clang::FileManager files{clang::FileSystemOptions{}};
  clang::DiagnosticOptions diagOptions;
  clang::DiagnosticsEngine diags(new clang::DiagnosticIDs, diagOptions);
  clang::SourceManager sources(diags, files);
  auto buffer = llvm::MemoryBuffer::getMemBuffer("int main() { return 42; }", "input.cpp");
  clang::FileID file = sources.createFileID(std::move(buffer));
  clang::LangOptions lang;
  lang.CPlusPlus = true;
  clang::Lexer lexer(file, sources.getBufferOrFake(file), sources, lang);
  unsigned tokens = 0;
  clang::Token token;
  do {
    lexer.LexFromRawLexer(token);
    if (token.isNot(clang::tok::eof)) ++tokens;
  } while (token.isNot(clang::tok::eof));
  llvm::outs() << clang::getClangFullVersion() << "\n"
               << "tokens " << tokens << " zlib " << llvm::compression::zlib::isAvailable()
               << " zstd " << llvm::compression::zstd::isAvailable() << "\n";
}
```

It prints the clang version, then `tokens 9 zlib 1 zstd 1`.

### CMake

libclang comes as a release archive, not from conda or FetchContent. In
`examples/libclang`, in a `pixi shell` after `pixi install`, this
downloads, checks and unpacks the newest release's on Linux x64, the
release pixi installed too (see
[the rules](#rules-for-code-that-links-it)):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
v=$(sed -n "s/^[0-9a-f]*  libclang-\(.*\)-$h\.tar\.xz$/\1/p" SHA256SUMS)
curl -LO https://github.com/clice-io/xclang/releases/download/$v/libclang-$v-$h.tar.xz
sha256sum -c --ignore-missing SHA256SUMS
tar -xf libclang-$v-$h.tar.xz
```

On macOS, check with `shasum -a 256 -c --ignore-missing SHA256SUMS`. The
other hosts are in [releases](../reference/releases.md#assets).

The tool finds libclang with `find_package(Clang)`. `find_package(xclang)`
adds the [ThinLTO cache](thinlto-cache.md) to its links:

<!-- file: examples/libclang/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(tool LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

add_executable(tool main.cpp)
set_target_properties(tool PROPERTIES CXX_STANDARD 17)
target_compile_options(tool PRIVATE -fno-rtti)
target_include_directories(tool SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(tool PRIVATE clangBasic clangLex LLVMSupport)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$PWD/libclang" -DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
cmake --build build
./build/tool
```

### Bazel

`@libclang` is the libclang of the target platform. Each library comes with
the link interface that the CMake packages of LLVM and clang give it:
system libraries, zlib and zstd. A Bazel target names only what it uses:

<!-- excerpt: examples/libclang/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "tool",
    srcs = ["main.cpp"],
    copts = ["-fno-rtti"],
    deps = [
        "@libclang//:clangBasic",
        "@libclang//:clangLex",
        "@libclang//:LLVMSupport",
    ],
)
```

`MODULE.bazel` takes the repositories from the module extension of xclang:

<!-- file: examples/libclang/MODULE.bazel -->
```python
module(name = "tool")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")

xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

::: details .bazelrc

It names the [ThinLTO cache](thinlto-cache.md#bazel):

<!-- file: examples/libclang/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
common --enable_platform_specific_config
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
common:windows --enable_runfiles
# The linker's ThinLTO cache: one path per OS, the same on every machine.
common:linux --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:linux --sandbox_writable_path=/var/tmp/xclang-thinlto
common:macos --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:windows --repo_env=XCLANG_THINLTO_CACHE=C:/xclang-thinlto
try-import %workspace%/user.bazelrc
```

:::

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:tool
```

A tool on libclang finds the clang resource directory, with the clang
headers, in `lib/clang` next to the directory of its program, as clang
itself does. `xclang_resource_dir` lays out the one of `@libclang` there,
for a program `bin/<name>` of its package, in `bazel-bin` and in the
runfiles:

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

## Rules for Code That Links It

- **Link with the toolchain of the same release.** libclang is ThinLTO
  bitcode, which only an lld of the same LLVM reads. A link generates the
  code of every bitcode file the tool uses: minutes, which the
  [ThinLTO cache](thinlto-cache.md) turns into seconds after the first.
- **Compile with `-fno-rtti`**, as LLVM was.
- **Ship the resource directory** in `lib/clang`, next to the directory
  of the program, when the tool parses code: the archive has it in
  `lib/clang/<major>`.
- **Build for another target with its libclang.** In Bazel, `@libclang`
  follows the target platform, and a build for another target downloads
  only that target's archive. In CMake, point `CMAKE_PREFIX_PATH` at the
  archive of the target host.

## What the Archive Contains

`libclang-<version>-<host>.tar.xz` holds the libraries the clang of that
host was linked from, without the parts a tool does not link:

| | |
|---|---|
| libraries | the static libraries of clang and LLVM, as PGO and ThinLTO bitcode, with headers |
| CMake packages | LLVM's and clang's own, for `find_package(Clang)` |
| C++ library | xclang's libc++, as every program of the toolchain |
| zlib, zstd | the compression libraries LLVM links, found through the same `CMAKE_PREFIX_PATH` |
| resource directory | `lib/clang/<major>`: the clang headers, and the compiler-rt headers (`sanitizer/`, `fuzzer/`, ...), as the toolchain has them; a tool hands it to every compiler it stands in for |
| clang-tidy | its headers, and `clang-tidy/clang-tidy-config.h`, which they include, as xclang configures it: no static analyzer, no query-based checks |
| every target's MC layer | TargetInfo, MC descriptions, assembly parser and disassembler of every LLVM target |
| no code generators | `InitializeAllTargets()`, `InitializeAllAsmPrinters()` and `InitializeNativeTarget()` do not link |
| build record | `lib/cmake/xclang/libclang.cmake`: `XCLANG_LLVM_VERSION`, `XCLANG_LTO`, `XCLANG_PGO`, `XCLANG_PATCHES` and the like |

The MC layer is what clang parses MS-style `__asm {}` with, for X86. A tool
registers it, with `InitializeAllTargetInfos()`, `InitializeAllTargetMCs()`,
`InitializeAllAsmParsers()` and `InitializeAllDisassemblers()`, to look up a
target by its triple. That infers the target from a compiler name such as
`aarch64-linux-gnu-g++`, for example. The CMake components are
`AllTargetsInfos`, `AllTargetsDescs`, `AllTargetsAsmParsers` and
`AllTargetsDisassemblers`; in Bazel they are `@libclang//:AllTargetsInfos`
and the like.

## The ASan Build

`libclang-<version>-<host>-asan.tar.xz`, for Linux x64 and macOS arm64
hosts, is a build with assertions and AddressSanitizer, at `-O1`, without
PGO or ThinLTO. It has the same headers and libraries, for debugging a
tool. It is built against the [ASan libc++](sanitizers.md), so the tool is
too.

In Bazel, `@libclang_asan` is the ASan build, and `@libclang` is that too
in a build with `--features=asan`. Its libraries, headers and resource
directory switch together, and a build for a target without an ASan build
says so. The `features = ["asan"]` of a single Bazel target switches no
dependency.

## The Option Tables

`llvm-option-inc-<version>.tar.xz` holds the option tables of clang, of
lld (ELF, COFF, MachO, MinGW, wasm), of llvm-lib and of llvm-dlltool. They
are the TableGen output of the same build, for tools that parse those
command lines without linking LLVM. Each `.inc` file expands `OPTION(...)`
once per option. `options.cpp` counts the options of clang:

<!-- file: examples/libclang/options.cpp -->
```cpp
#include <cstdio>

int main() {
    int count = 0;
#define OPTION(...) ++count;
#include <llvm-options-td/clang-Driver-Options.inc>
#undef OPTION
    std::printf("clang has %d options\n", count);
}
```

In Bazel, it depends on `@llvm_option_inc`, as `BUILD.bazel` has it:

<!-- excerpt: examples/libclang/BUILD.bazel -->
```python
cc_binary(
    name = "options",
    srcs = ["options.cpp"],
    deps = ["@llvm_option_inc"],
)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:options
```

The same tables are the conda package `llvm-option-inc`, in
`$PREFIX/include`, and the Bazel repository `@llvm_option_inc`.

## See Also

- [Bazel API](../reference/bazel-api.md#repositories): `@libclang`,
  `@libclang_asan`, `@libclang_<target>`, `@llvm_option_inc`,
  `xclang_resource_dir`.
- [CMake API](../reference/cmake-api.md#libclang-s-package).
