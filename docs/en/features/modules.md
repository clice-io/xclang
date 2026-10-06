# C++20 Modules and `import std`

xclang builds C++20 modules in CMake and Bazel, `import std` included,
without CMake's experimental switches. A module interface compiles to a
*module file* (BMI, `.pcm` for clang), which every importer reads.

## Usage

The example is a named module, `math`, with a partition, `math:ops`, and a
program that imports both it and `std`. It is in
[examples/modules](https://github.com/clice-io/xclang/tree/main/examples/modules).
The CMake and plain clang commands below run in that directory, in a
`pixi shell` after `pixi install`, which puts xclang's `bin/` first in
`PATH`.

`math-ops.cppm` is the partition:

<!-- file: examples/modules/math-ops.cppm -->
```cpp
export module math:ops;

import std;

export int perimeter(std::span<const int> sides) {
    return std::accumulate(sides.begin(), sides.end(), 0);
}
```

`math.cppm` is the primary interface, which exports the partition:

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

Each build below makes a program that prints this:

<!-- file: examples/modules/expected.txt -->
```
triangle: 3 sides, perimeter 12
```

### CMake

`xclang::std` is the `std` module as a library to link. The C++ modules of
the program are a `FILE_SET CXX_MODULES`:

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

For another target, use the toolchain file of the toolchain directory
([CMake](../integrations/cmake.md#build-for-another-target)). `xclang::std`
is then built for that target too:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
XCLANG=$PWD/.pixi/envs/default/opt/xclang
cmake -G Ninja -B build-x86_64-w64-mingw32 --toolchain "$XCLANG/lib/cmake/xclang/toolchain.cmake" \
    -DXCLANG_TARGET=x86_64-w64-mingw32
cmake --build build-x86_64-w64-mingw32
```

### Bazel

`@xclang//bazel:std` is the `std` module, and `module_interfaces` holds
the C++ modules of a `cc_library`:

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
bazel_dep(name = "xclang", version = "23.1.2.7")
```

The `.bazelrc` is the one of [Bazel](../integrations/bazel.md#set-up-a-project),
with `--experimental_cpp_modules`:

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

The second command builds the program for Windows x64, as
`bazel-bin/shapes.exe`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:shapes
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:shapes
```

### Plain Clang

Each interface compiles in one step to its object and its module file.
`-fprebuilt-module-path=.` finds `std.pcm`, `math.pcm`, and `math-ops.pcm`
for the partition `math:ops`:

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

The first line finds the source of the `std` module. The module manifest of
libc++ lists it as the `source-path` of the module `std`. Add
`--target=<target>` to every line, the manifest included, to build for
another target.

## Options

| | CMake | Bazel |
|---|---|---|
| `import std` | `target_link_libraries(<program> PRIVATE xclang::std)` | `deps = ["@xclang//bazel:std"]` |
| C++ modules of a library | `target_sources(<lib> PUBLIC FILE_SET CXX_MODULES FILES ...)` | `module_interfaces = [...]`, `features = ["cpp_modules"]` |
| language options of `std` | those of the directory that called `find_package(xclang)` | the build's `--cxxopt` |
| a `std` with other options | `xclang_add_std(<name>)` | |
| needs | CMake 3.28, Ninja 1.11, a Ninja generator | Bazel 9, `--experimental_cpp_modules` |

## Behavior

- **Scanning.** An importer compiles after the module files it imports, so
  the build has to know which source provides and imports which module.
  CMake and Bazel ask clang-scan-deps, which writes the dependencies of
  each source in the P1689 format.
- **Matching options.** clang refuses a module file built with other
  language options than its importer's: `-std`, GNU extensions,
  `-fno-exceptions`, `-fno-rtti`, and others that change what the code
  means. Macros, include paths and optimization may differ. A target
  asking for a newer standard than `std` was built with gets
  `C++26 was disabled in precompiled file`.
- **`std` is built per build.** A prebuilt `std` module could only serve
  importers with exactly its options. So xclang builds it for each build,
  with the options of that build, as a library to link.
- **No experimental CMake switch.** CMake's own `import std` support is
  behind `CMAKE_EXPERIMENTAL_CXX_IMPORT_STD` in CMake 4.4, whose value
  changes with the CMake version. `xclang::std` is an ordinary library
  whose sources are module interfaces, so it needs only the module support
  of CMake 3.28.

## Build Caches and Modules

A compile cache keyed on the source, the command line and the included
headers misses the module files. The command line names them only by path;
CMake passes them in a response file, `@<source>.modmap`. If the cache
does not hash the content of the module file, it serves an importer the
object it had before the interface changed.

CI runs the command lines CMake gives a module and its importer
(`-fmodule-output=a.pcm`, and `-fmodule-file=a=a.pcm` in `@b.modmap`) three
times, under two ccache versions: as is, again, and after the exported
constant of the module changed from 1 to 2
([testing](../dev/testing.md#c-20-modules)):

| | module interface | importer, unchanged | importer, after the interface changed |
|---|---|---|---|
| ccache 4.13.6 | never cached (`unsupported_source_language`) | cache hit | **cache hit: the stale object, the program returns 1** |
| ccache 4.14.1 | never cached | cache hit | cache miss, recompiled: the program returns 2 |

With ccache 4.13 or older, a module build can be silently wrong. With 4.14
it is correct, but every module interface is compiled on every build,
which in a modularized project is much of the work.

Bazel has no such problem. The key of each action is the content of all
its inputs, and the inputs of an importer include the module files it
reads. A changed interface gives a new module file, which changes the key
of every importer. xclang's toolchains compile modules with paths relative
to the execution root (`-fmodule-file-home-is-cwd`). So a module file is
the same wherever it is built, and a shared cache serves it to every
checkout.

## Known Limitations

- Header units (`import <vector>;`) are built by neither CMake nor Bazel.
- Bazel's module support is behind `--experimental_cpp_modules` in
  Bazel 9.
- CMake builds modules only with the Ninja and Ninja Multi-Config
  generators.

## See Also

- [CMake](../integrations/cmake.md#use-c-20-modules-and-import-std):
  `xclang::std` and the options it is built with.
- [Bazel](../integrations/bazel.md#use-c-20-modules-and-import-std).
