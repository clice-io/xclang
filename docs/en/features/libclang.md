# libclang and the Option Tables

For tools built on `clang` and LLVM, such as
[clice](https://github.com/clice-io/clice) and
[catter](https://github.com/clice-io/catter). In these docs, *libclang* refers
to the static C++ libraries and headers of `clang`, `clang-tidy` and LLVM, not
only the `libclang` C API. Every release publishes `libclang` for all six hosts
as ThinLTO bitcode compiled with the same PGO profile as xclang's `clang`,
paired with `XCLANG_THINLTO_CACHE` so incremental links finish in seconds, an
ASan-instrumented `libclang` build for Linux `x86_64` and macOS `arm64`, and
`llvm-option-inc` containing the TableGen driver option tables.

## Usage

The example in
[examples/libclang](https://github.com/clice-io/xclang/tree/main/examples/libclang)
lexes a line of C++ using `clang`'s C++ classes and prints the compiler version
and enabled compression libraries:

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

It prints the `clang` version, followed by `tokens 9 zlib 1 zstd 1`.

### CMake

`libclang` is distributed as a release archive (`libclang-<version>-<host>.tar.xz`),
not through conda or `FetchContent`. In `examples/libclang`, inside `pixi shell`
after `pixi install`, download, verify and unpack the archive matching the
installed release on Linux `x86_64`
([installation](../reference/releases.md#assets) lists all host triples; on macOS,
verify with `shasum -a 256 -c --ignore-missing SHA256SUMS`):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
h=x86_64-unknown-linux-gnu
curl -LO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
v=$(sed -n "s/^[0-9a-f]*  libclang-\(.*\)-$h\.tar\.xz$/\1/p" SHA256SUMS)
curl -LO https://github.com/clice-io/xclang/releases/download/$v/libclang-$v-$h.tar.xz
sha256sum -c --ignore-missing SHA256SUMS
tar -xf libclang-$v-$h.tar.xz
```

Find `libclang` with `find_package(Clang REQUIRED CONFIG)` and
`CMAKE_PREFIX_PATH` pointing to the unpacked `libclang` directory. Calling
`find_package(xclang REQUIRED CONFIG)` enables the
[ThinLTO cache](#the-thinlto-cache) when `XCLANG_THINLTO_CACHE` is set (as a
CMake variable or environment variable before `find_package(xclang)`): it
creates the cache directory at configure time and adds the cache flag to every
link in that directory and its subdirectories:

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

The first link compiles the required `libclang` bitcode modules and populates
`/var/tmp/xclang-thinlto`. After modifying `main.cpp`, the relink reuses the
cached `libclang` machine code and finishes in seconds:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
touch main.cpp
cmake --build build
```

### Bazel

`@libclang` provides the `libclang` archive of the target platform, and
`@llvm_option_inc` provides the option tables. Import them from the `xclang`
module extension in `MODULE.bazel`:

<!-- file: examples/libclang/MODULE.bazel -->
```python
module(name = "tool")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")

xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

Each library target in `@libclang` carries the link interface (`deps` and
`linkopts`) exported by LLVM's and `clang`'s CMake packages: transitive library
dependencies, system libraries, `zlib`, `zstd`, and on MinGW targets the
Windows import libraries (`oleaut32` for `LLVMWindowsDriver`, and others) that
CMake links by default. A Bazel target lists only the libraries it directly
uses:

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

Configure the ThinLTO cache in the project's `.bazelrc` with one fixed path per
OS (`/var/tmp/xclang-thinlto` on Linux and macOS, `C:/xclang-thinlto` on
Windows; see [Why One Fixed Path](#why-one-fixed-path)):

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

If a machine requires a different cache path, override it in `user.bazelrc`
(links using a custom path have a different action key and do not share link
outputs with a remote cache):

```text
common:linux --repo_env=XCLANG_THINLTO_CACHE=/data/xclang-thinlto
common:linux --sandbox_writable_path=/data/xclang-thinlto
```

Build and run the tool:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:tool
```

A tool built on `libclang` looks for the `clang` resource directory (with
`clang`'s built-in headers) at `../lib/clang` relative to its executable
directory, just as `clang` itself does. `xclang_resource_dir` stages
`@libclang`'s resource directory there for a `bin/<name>` binary in the same
package, both in `bazel-bin` and in its runfiles:

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

### Plain Clang

When linking ThinLTO bitcode with `clang++` directly, pass the target linker's
ThinLTO cache flag:

- **Linux and MinGW targets** (`ld.lld`): `-Wl,--thinlto-cache-dir=<dir>`
- **macOS targets** (`ld64.lld`): `-Wl,-cache_path_lto,<dir>`
- **MSVC targets** (`lld-link`): `-Wl,/lldltocache:<dir>`

The CMake package and the Bazel module pass these same flags when
`XCLANG_THINLTO_CACHE` is set.

### The Option Tables

`llvm-option-inc-<version>.tar.xz` contains the pre-generated TableGen option
tables of `clang`, `lld` (`ELF`, `COFF`, `MachO`, `MinGW`, `wasm`), `llvm-lib`
and `llvm-dlltool`, for tools that parse compiler or linker command lines
without linking LLVM. Each `.inc` file expands `OPTION(...)` once per option.
`options.cpp` counts `clang`'s driver options:

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

In Bazel, depend on `@llvm_option_inc` from `BUILD.bazel`:

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

The same headers are published as the `noarch` conda package `llvm-option-inc`
(installed under `$PREFIX/include/llvm-options-td`) and in the release asset
`llvm-option-inc-<version>.tar.xz` ([installation](../reference/releases.md#assets)).

## Options

| | CMake | Bazel | Plain Clang |
|---|---|---|---|
| Link `libclang` | `find_package(Clang REQUIRED CONFIG)` with `CMAKE_PREFIX_PATH=<libclang-dir>` | `deps = ["@libclang//:<library>"]` (`use_repo(xclang, "libclang")`) | `-I<libclang>/include`, `-L<libclang>/lib` |
| ASan `libclang` | unpack `libclang-<version>-<host>-asan.tar.xz` | `--features=asan` (switches `@libclang`), or `@libclang_asan` | unpack `-asan` archive + [ASan `libc++`](sanitizers.md) |
| Stage `clang` resource directory | copy `<libclang>/lib/clang/<major>` next to `bin/` | `xclang_resource_dir(name = ...)` | copy `<libclang>/lib/clang/<major>` |
| Option tables | `llvm-option-inc` conda package or archive | `deps = ["@llvm_option_inc"]` (`use_repo(xclang, "llvm_option_inc")`) | `-I<prefix>/include` |
| Enable ThinLTO cache | `-DXCLANG_THINLTO_CACHE=<dir>` (or env var) before `find_package(xclang)` | `--repo_env=XCLANG_THINLTO_CACHE=<dir>` (plus `--sandbox_writable_path=<dir>` on Linux) | `-Wl,--thinlto-cache-dir=<dir>`, `-Wl,-cache_path_lto,<dir>`, or `-Wl,/lldltocache:<dir>` |
| Where ThinLTO cache applies | every link in the directory of `find_package(xclang)` and its subdirectories | every link via the `thinlto_cache` feature | links with the flag |
| Disable ThinLTO cache | leave `XCLANG_THINLTO_CACHE` unset | unset variable, `--features=-thinlto_cache`, or `features = ["-thinlto_cache"]` | omit flag |

Full option lists are in the [CMake API](../reference/cmake-api.md) and the
[Bazel API](../reference/bazel-api.md).

## Behavior

### Rules for Code That Links It

- **Link with the toolchain of the same release**: `libclang` is ThinLTO
  bitcode, which only an `lld` from the same LLVM version reads. The first link
  compiles every bitcode module the tool uses to machine code; the
  [ThinLTO cache](#the-thinlto-cache) reuses that machine code on subsequent
  links.
- **Compile with `-fno-rtti`**: matching the LLVM and `clang` libraries in the
  archive.
- **Ship the resource directory**: when the tool parses C or C++ code, place
  `lib/clang/<major>` at `../lib/clang/<major>` relative to the executable's
  directory (`xclang_resource_dir` in Bazel, or copied from the archive's
  `lib/clang/<major>`).
- **Cross-compile with the target's `libclang`**: in Bazel, `@libclang`
  automatically selects and downloads only the archive matching the target
  platform (`--platforms`). In CMake, set `CMAKE_PREFIX_PATH` to the unpacked
  `libclang` archive of the target host.
- **Hosts only**: there is a `libclang` for each of the six hosts, and none
  for the musl or MSVC targets; in Bazel, what depends on `@libclang` is
  incompatible with those platforms. A `libclang` for the MSVC ABI is
  [not planned](../design/roadmap.md#libclang-msvc).


### What the Archive Contains

`libclang-<version>-<host>.tar.xz` contains the libraries from which that
host's `clang` was linked, without the backend code generators that a front-end
tool does not use:

| | contents |
|---|---|
| Libraries | static libraries of `clang` and LLVM as PGO and ThinLTO bitcode, with headers |
| CMake packages | LLVM's and `clang`'s config files for `find_package(Clang)` and `find_package(LLVM)` |
| C++ standard library | compiled against xclang's `libc++`, matching the toolchain |
| `zlib`, `zstd` | static compression libraries linked by LLVM, found via the same `CMAKE_PREFIX_PATH` |
| Resource directory | `lib/clang/<major>`: `clang`'s built-in headers and `compiler-rt` headers (`sanitizer/`, `fuzzer/`, ...) |
| `clang-tidy` | headers and `clang-tidy/clang-tidy-config.h` (configured without the static analyzer or query-based checks) |
| Every target's MC layer | `TargetInfo`, MC descriptions, assembly parser and disassembler for all LLVM targets |
| No code generators | `InitializeAllTargets()`, `InitializeAllAsmPrinters()` and `InitializeNativeTarget()` are not included |
| Build record | `lib/cmake/xclang/libclang.cmake` (`XCLANG_LLVM_VERSION`, `XCLANG_LTO`, `XCLANG_PGO`, `XCLANG_PATCHES`, ...) |

`clang` uses the X86 MC assembly parser to parse MS-style `__asm {}` blocks,
and tools register the MC layer via `InitializeAllTargetInfos()`,
`InitializeAllTargetMCs()`, `InitializeAllAsmParsers()` and
`InitializeAllDisassemblers()` to look up targets by triple (for example,
inferring a target from a compiler name such as `aarch64-linux-gnu-g++`). In
CMake, the components are `AllTargetsInfos`, `AllTargetsDescs`,
`AllTargetsAsmParsers` and `AllTargetsDisassemblers`; in Bazel, they are
`@libclang//:AllTargetsInfos`, `@libclang//:AllTargetsDescs`,
`@libclang//:AllTargetsAsmParsers` and `@libclang//:AllTargetsDisassemblers`.

### The ASan Build

`libclang-<version>-<host>-asan.tar.xz`, published for the
`x86_64-unknown-linux-gnu` and `aarch64-apple-darwin` hosts, is built with
assertions and AddressSanitizer at `-O1`, without PGO or ThinLTO, against the
[ASan `libc++`](sanitizers.md). It carries the same headers and library targets
for debugging a tool under ASan.

In Bazel, `@libclang_asan` references the ASan archive directly, and
`@libclang` switches its libraries, headers and resource directory to the ASan
build automatically when `--features=asan` is passed on the command line
(stopping at analysis time if the target platform has no ASan `libclang`
archive). Setting `features = ["asan"]` on a single Bazel target does not
switch `@libclang`.

### The ThinLTO Cache

- **What it keeps**: `lld`'s ThinLTO cache stores the compiled machine code of
  each bitcode module in the cache directory under a hash of everything that
  affects its code generation: the module's bitcode, the import summaries of
  modules it inlines from, and the compiler options. A subsequent link
  recompiles only the bitcode modules whose hash changed and reads the rest
  from the cache.
- **Identical binaries**: because each cache entry is looked up by the exact
  hash of its inputs, enabling the cache speeds up links without changing the
  output bytes.
- **Concurrent builds**: cache entries are written atomically (whole file or
  not at all), so multiple builds can share one directory safely.
- **Pruning**: at most once every 20 minutes, `lld` removes cache entries that
  have not been read for a week (LLVM's default policy). Persisting the cache
  between CI runs is covered in [CI](../integrations/ci.md).

### Why Bitcode

A tool built on `clang` (a language server, linter or refactoring tool) spends
most of its execution time inside `clang` itself: the lexer, parser, `Sema` and
AST traversal. When `libclang` is shipped as precompiled machine code, those
libraries are optimized in isolation and every call between the tool and
`clang` crosses an opaque library boundary.

Shipping `libclang` as ThinLTO bitcode compiled with the same PGO profile as
xclang's `clang` lets the linker optimize `libclang` and the tool together:
functions inline across the boundary, unused code is discarded, and PGO
hot/cold layout is preserved.

The trade-off is link time: without a cache, ThinLTO compiles every bitcode
module the tool references to machine code during each link, taking several
minutes even after a one-line edit in the tool. The ThinLTO cache reduces
incremental relinks to seconds.

### Why One Fixed Path

- **The path is part of the link's action key**: the cache directory is passed
  on the linker command line, so in Bazel it is hashed into the link action's
  cache key. A disk or remote cache only serves a cached link to builds that
  pass the exact same directory path. Placing the cache inside the workspace or
  `$HOME` makes the path differ across checkouts and machines, preventing link
  cache hits. Configure one fixed path per OS (`/var/tmp/xclang-thinlto` on
  Linux and macOS, `C:/xclang-thinlto` on Windows).
- **The Linux sandbox must allow writes**: Bazel's Linux sandbox mounts the
  host file system read-only except for declared outputs and paths listed in
  `--sandbox_writable_path=<dir>`. `--sandbox_writable_path` is not part of the
  action key, and only mounts a path that already exists when the action
  starts; the `xclang` Bazel module therefore creates `XCLANG_THINLTO_CACHE`
  during repository setup and recreates it whenever it is missing.
- **Never under `/tmp`**: Bazel's Linux sandbox mounts a private `/tmp` for
  each action, so a cache under `/tmp` is written into the action's temporary
  mount and discarded when the link finishes. `/var/tmp` is shared on Linux
  (with `--sandbox_writable_path`) and writable in Bazel's macOS sandbox; on
  Windows, Bazel runs actions without a sandbox by default.
- **Safe outside Bazel's input tracking**: although Bazel does not track files
  inside the ThinLTO cache directory, the cache is content-addressed by `lld`,
  so stale entries cannot corrupt a build.

### Measurements

Link times for [clice](https://github.com/clice-io/clice) linking `libclang`'s
bitcode on GitHub-hosted runners (Linux `x86_64` with 4 cores, macOS `arm64`
with 3 cores, Windows `x86_64` with 4 cores; link action duration alone from
Bazel's profile in clice runs
[37041436235](https://github.com/clice-io/clice/actions/runs/37041436235),
[37047279320](https://github.com/clice-io/clice/actions/runs/37047279320),
[37065094747](https://github.com/clice-io/clice/actions/runs/37065094747) and
[37075525831](https://github.com/clice-io/clice/actions/runs/37075525831),
branch `exp/bazel-lto`):

| | Linux x64 | macOS arm64 | Windows x64 |
|---|---|---|---|
| No cache | 353 s | 190 s | 400–506 s |
| Empty cache | 357 s | 190–200 s | 492 s |
| Full cache, nothing changed | 6.1–6.3 s | 4.8–5.1 s | 7.6–14 s |
| Full cache, one source changed | 6.2 s | 4.7–7.3 s | 14 s |
| First link on a fresh runner after restoring the cache, with a change | 6.2 s | 15.6 s | 13.7 s |
| Cache size | 352–403 MiB | 414–425 MiB | 394–660 MiB |

Linking a small tool (`examples/libclang`) across all six hosts takes 7 to
20 s cold (no cache or empty cache) and 0.6 to 1.7 s warm (152 to 155 cache
entries), producing identical binary bytes on every run.
