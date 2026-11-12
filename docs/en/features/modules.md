# C++20 Modules and `import std`

xclang builds C++20 named modules and the standard library modules (`import std`
and `import std.compat`) in CMake, Bazel and plain `clang++`, for the host or
any cross target, without CMake's experimental switches. Each module interface
compiles to a precompiled *module file* (BMI, `.pcm` in `clang`), which every
importer reads.

## Usage

The example in
[examples/modules](https://github.com/clice-io/xclang/tree/main/examples/modules)
defines a module `math` with a partition `math:ops` and an executable that
imports both `math` and `std`. The CMake and plain `clang++` commands below run
in that directory inside `pixi shell` after `pixi install`, which places
xclang's `bin/` first in `PATH`.

`math-ops.cppm` is the module partition:

<!-- file: examples/modules/math-ops.cppm -->
```cpp
export module math:ops;

import std;

export int perimeter(std::span<const int> sides) {
    return std::accumulate(sides.begin(), sides.end(), 0);
}
```

`math.cppm` is the primary module interface, which re-exports `:ops`:

<!-- file: examples/modules/math.cppm -->
```cpp
export module math;

export import :ops;
import std;

export std::string describe(std::string_view name, std::span<const int> sides) {
    return std::format("{}: {} sides, perimeter {}", name, sides.size(), perimeter(sides));
}
```

`main.cpp` imports both modules:

<!-- file: examples/modules/main.cpp -->
```cpp
import std;
import math;

int main() {
    std::vector<int> triangle{3, 4, 5};
    std::println("{}", describe("triangle", triangle));
}
```

Every build below produces a program with this output:

<!-- file: examples/modules/expected.txt -->
```
triangle: 3 sides, perimeter 12
```

### CMake

`xclang::std` is a static library containing the `std` and `std.compat` modules
of `libc++`, compiled from the module sources named in the compiler's module
manifest for the active target. Link `xclang::std` to use `import std` and
`import std.compat`, and list your own module interfaces in a
`FILE_SET CXX_MODULES`. `cmake_minimum_required(VERSION 3.28)` enables
`clang-scan-deps` module scanning on C++20 and later targets (`CMP0155`):

<!-- file: examples/modules/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(shapes LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(xclang REQUIRED CONFIG)

add_library(math STATIC)
target_sources(math PUBLIC FILE_SET CXX_MODULES FILES math.cppm math-ops.cppm)
target_link_libraries(math PUBLIC xclang::std)

add_executable(shapes main.cpp)
target_link_libraries(shapes PRIVATE math xclang::std)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++
cmake --build build
./build/shapes
```

Because `clang` rejects a module file compiled with different language options
than its importer ([Behavior](#behavior)):

- `xclang::std` is compiled with the settings of the directory that called
  `find_package(xclang)`, evaluated at the end of that directory's
  `CMakeLists.txt`: `CMAKE_CXX_STANDARD`, `CMAKE_CXX_EXTENSIONS`,
  `CMAKE_CXX_FLAGS` and `add_compile_options()`. Set language options
  project-wide rather than on individual CMake targets.
- `xclang::std` is C++23, or the `CMAKE_CXX_STANDARD` of that directory if
  it is 20 or later, and asks the same standard of its importers.
- When a target needs different language options, create a separate `std`
  module target with `xclang_add_std(<name>)` and attach `PUBLIC` compile
  options to it so both that `std` library and its importers use them:

  <!-- excerpt: tests/cmake/noexcept/CMakeLists.txt -->
  ```cmake
  xclang_add_std(std_noexcept)
  target_compile_options(std_noexcept PUBLIC -fno-exceptions)
  ```

To cross-compile for another target, pass the toolchain file and
`XCLANG_TARGET` ([CMake](../integrations/cmake.md)); `xclang::std` is then built
for that target as well:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
cmake -G Ninja -B build-x86_64-w64-mingw32 --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

### Bazel

`@xclang//bazel:std` provides the `std` and `std.compat` modules. List a
library's module interfaces in `module_interfaces`, and enable
`features = ["cpp_modules"]` on every target that compiles or imports a C++20
module:

<!-- file: examples/modules/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")
load("@rules_cc//cc:cc_library.bzl", "cc_library")

cc_library(
    name = "math",
    features = ["cpp_modules"],
    module_interfaces = [
        "math.cppm",
        "math-ops.cppm",
    ],
    deps = ["@xclang//bazel:std"],
)

cc_binary(
    name = "shapes",
    srcs = ["main.cpp"],
    features = ["cpp_modules"],
    deps = [
        ":math",
        "@xclang//bazel:std",
    ],
)
```

::: details MODULE.bazel and .bazelrc

<!-- file: examples/modules/MODULE.bazel -->
```python
module(name = "shapes")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")
```

The `.bazelrc` adds the registry ([Bazel](../integrations/bazel.md)),
`--experimental_cpp_modules`, and the `--cxxopt` flags shared by
`@xclang//bazel:std` and its importers:

<!-- file: examples/modules/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
common --enable_platform_specific_config
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
# import std: libc++'s modules are built with these options, and so are
# their importers.
common --cxxopt=-std=c++23 --host_cxxopt=-std=c++23
common --experimental_cpp_modules
common:windows --enable_runfiles
```

:::

`@xclang//bazel:std` is compiled with the `--cxxopt` of the build. Because
`clang` requires matching language options between a module file and its
importers ([Behavior](#behavior)), put language flags such as `-std=c++23`,
`-fno-exceptions` and `-fno-rtti` in `--cxxopt` rather than in the `copts` of a
single target.

Run the program on the host, or pass `--platforms` to cross-compile it (here
for Windows x64, writing `bazel-bin/shapes.exe`):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:shapes
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:shapes
```

### Plain Clang

Each module interface compiles in one step to both an object file and a `.pcm`
module file (`-fmodule-output=<file>.pcm`). Pass `-fprebuilt-module-path=.` so
importers find `std.pcm`, `math.pcm`, and `math-ops.pcm` for the partition
`math:ops`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
std=$(dirname "$(clang++ -print-library-module-manifest-path)")/../share/libc++/v1/std.cppm
clang++ -std=c++23 -O2 -Wno-reserved-module-identifier -c "$std" -fmodule-output=std.pcm -o std.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c math-ops.cppm -fmodule-output=math-ops.pcm -o math-ops.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c math.cppm -fmodule-output=math.pcm -o math.o
clang++ -std=c++23 -O2 -fprebuilt-module-path=. -c main.cpp -o main.o
clang++ main.o math.o math-ops.o std.o -o shapes
./shapes
```

`clang++ -print-library-module-manifest-path` prints the path of
`libc++.modules.json`, which records `../share/libc++/v1/std.cppm` as the
`source-path` of `std`. Add `--target=<target>` to every command, including the
manifest lookup, to cross-compile for another target. Because `clang` searches
for `libc++.a` when printing the manifest path, it reports no path for the MSVC
targets (`libc++-<arch>.lib`); their module source is at
`$XCLANG/<target>/share/libc++/v1/std.cppm`
([archive layout](../reference/layout.md)).

## Options

| | CMake | Bazel | Plain Clang |
|---|---|---|---|
| `import std` and `import std.compat` | `target_link_libraries(<target> PRIVATE xclang::std)` | `deps = ["@xclang//bazel:std"]` | compile `std.cppm` and `std.compat.cppm` with `-fmodule-output=` |
| C++20 modules of a library | `target_sources(<lib> PUBLIC FILE_SET CXX_MODULES FILES ...)` | `module_interfaces = [...]`, `features = ["cpp_modules"]` | `-fmodule-output=<name>.pcm`, `-fprebuilt-module-path=<dir>` |
| Language options of `std` | directory options where `find_package(xclang)` was called | the build's `--cxxopt` | flags passed when compiling `std.cppm` |
| Additional `std` target with custom options | `xclang_add_std(<name>)` | | |
| Requirements | CMake 3.28+, Ninja 1.11+, `Ninja` or `Ninja Multi-Config` | Bazel 9, `rules_cc` 0.2.25+, `--experimental_cpp_modules` | |

Full option lists are in the [CMake API](../reference/cmake-api.md) and the
[Bazel API](../reference/bazel-api.md).

## Behavior

- **Dependency scanning**: an importer must compile after the `.pcm` files of
  the modules it imports. CMake and Bazel run `clang-scan-deps`, which writes
  the module dependencies of each source file in the P1689 format.
- **Matching language options**: `clang` rejects a `.pcm` built with different
  language options than its importer: `-std`, GNU extensions, `-fno-exceptions`,
  `-fno-rtti`, and other flags that change language semantics. Macros (`-D`),
  include paths and optimization levels may differ. Importing a `std` module
  built with C++23 from a target compiled with `-std=c++26` fails with
  `C++26 was disabled in precompiled file`.
- **`std` is built per build**: because a precompiled `.pcm` only serves
  importers compiled with matching language options, xclang ships `std.cppm`
  and `std.compat.cppm` as sources and compiles them as a static library target
  inside each build. When [runtimes from source](runtimes-from-source.md) are
  enabled, `xclang::std` and `@xclang//bazel:std` compile against that runtime
  variant.
- **No experimental CMake switch**: CMake's built-in `import std` is gated
  behind `CMAKE_EXPERIMENTAL_CXX_IMPORT_STD`, whose UUID changes across CMake
  versions. `xclang::std` is a regular `STATIC` library with a `CXX_MODULES`
  file set, so it needs only the module support of CMake 3.28.
- **Embedded sources in Bazel**: a module file embeds its sources (the
  `modules_embed_all_files` feature, on by default). An importer compiled
  with `-g` reads them, and in the sandbox it has the module file but not
  the source.

### Build Caches and Modules

A compile cache keyed only on the source file, the compiler command line and
`#include`d headers misses imported `.pcm` files. The command line names module
files only by path (in CMake, inside a `@<source>.modmap` response file). If
the cache does not hash the contents of the `.pcm` files, it returns a stale
object file after an imported module interface changes.

xclang's CI runs the CMake compile commands for a module interface and its
importer (`-fmodule-output=a.pcm`, and `-fmodule-file=a=a.pcm` inside
`@b.modmap`) three times under two `ccache` versions: the first build, a rebuild, and a
rebuild after an exported constant changed from `1` to `2`:

| | module interface | importer, unchanged | importer, after the interface changed |
|---|---|---|---|
| ccache 4.13.6 | never cached (`unsupported_source_language`) | cache hit | **cache hit: stale object returned, program returns 1** |
| ccache 4.14.1 | never cached | cache hit | cache miss, recompiled: program returns 2 |

With `ccache` 4.13 or older, a C++20 module build can silently link stale code.
With `ccache` 4.14 or later, importers are invalidated when `.pcm` files change,
though module interfaces themselves are never cached.

Bazel's action cache hashes every declared input of an action, including the
`.pcm` files an importer reads. Changing a module interface produces a new
`.pcm` and invalidates its importers. Because xclang's Bazel toolchains pass
`-fmodule-file-home-is-cwd`, `.pcm` files record paths relative to the
execution root and can be shared across checkouts and machines through a remote
or disk cache.

## Platform Notes

With `-stdlib=platform` (`-DXCLANG_STDLIB=platform` in CMake,
`--@xclang//bazel:stdlib=platform` in Bazel), `xclang::std` and
`@xclang//bazel:std` use the platform C++ library's module sources instead of
xclang's `libc++` ([cross-compiling](../targets/cross-compiling.md#the-platform-s-c-library)):

- **MSVC targets**: `xclang::std` and `@xclang//bazel:std` compile Microsoft's
  STL module sources (`std.ixx` and `std.compat.ixx` from the fetched Windows
  SDK or Visual Studio, with `<malloc.h>` included before the module on `arm64`
  so `_alloca` is not declared twice).
- **Linux and MinGW targets**: in CMake, `xclang::std` uses the module manifest
  reported by `clang++ -stdlib=platform -print-library-module-manifest-path`
  when present (such as GCC 15's `libstdc++`), and `find_package(xclang)` stops
  if the system C++ library has no manifest. The Bazel module refuses
  `-stdlib=platform` for these targets: their library comes from a sysroot
  outside the toolchain.
- **macOS targets**: Apple's macOS SDK ships no module manifest or module
  sources for its `libc++`, so `import std` is not available with
  `-stdlib=platform` (`find_package(xclang)` fails in CMake, and
  `@xclang//bazel:std` is marked incompatible in Bazel).

## Limitations

- Header units (`import <vector>;`) are not built by CMake or Bazel.
- Bazel requires `--experimental_cpp_modules` (Bazel 9 and `rules_cc` 0.2.25 or
  later).
- CMake builds C++20 modules only with the `Ninja` and `Ninja Multi-Config`
  generators (CMake 3.28 and Ninja 1.11 or later).
- `ccache` does not cache module interface compilations, and `ccache` 4.13 and
  older can serve stale object files for importers
  ([Build Caches and Modules](#build-caches-and-modules)).
- With `-stdlib=platform`, `import std` requires module sources from the
  platform's C++ library and is unavailable on macOS
  ([Platform Notes](#platform-notes)).
