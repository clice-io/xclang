# Debugging and Debug Symbols

A shipped program is stripped, and its debug symbols are kept apart, to
turn the addresses of a crash into functions and lines later. xclang makes
them with its own tools, for every target: `llvm-gsymutil`, `dsymutil`,
`llvm-symbolizer` and `llvm-dwarfdump` are in every toolchain directory.

- **GSYM**, for every target: functions, inlining and line tables by
  address, made from the DWARF by `llvm-gsymutil --convert`. It is about a
  tenth of the size of the DWARF, and fast to look up. It is what a crash
  reporter needs, and nothing more.
- **dSYM**, for macOS targets: the bundle that Apple's tools and lldb
  read, made by `dsymutil`.

## Usage

The example is in
[examples/debug-symbols](https://github.com/clice-io/xclang/tree/main/examples/debug-symbols).
The CMake and plain clang commands below run in that directory, in a
`pixi shell` after `pixi install`. `tool.cpp` keeps `answer` out of line,
so its address maps to one line:

<!-- file: examples/debug-symbols/tool.cpp -->
```cpp
#include <cstdio>

extern "C" [[gnu::noinline]] int answer(int x) { return x * 6 + 36; }

int main(int argc, char**) { std::printf("%d\n", answer(argc)); }
```

### Plain Clang

This builds a Linux x64 program, so the commands are the same on every
host. The last one looks up the address of `answer` in the GSYM:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-unknown-linux-gnu -g -O2 tool.cpp -o tool
llvm-gsymutil --convert tool --out-file tool.gsym --num-threads=1
llvm-gsymutil tool.gsym --address=0x$(llvm-nm tool | awk '$3 == "answer" { print $1 }')
```

It prints the function and its line, `answer @ <this directory>/tool.cpp:3`.
For a macOS target, make the dSYM first, with `dsymutil tool -o tool.dSYM`,
and convert the dSYM instead.

### CMake

`xclang_debug_symbols(<program>)` makes the symbols after each link of the
CMake target `<program>`:

<!-- file: examples/debug-symbols/CMakeLists.txt -->
```cmake
cmake_minimum_required(VERSION 3.28)
project(tool LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)

add_executable(tool tool.cpp)
target_compile_options(tool PRIVATE -g)
xclang_debug_symbols(tool)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/tool
```

The program prints `42`. `build/tool.gsym` is next to it, and on a macOS
host `build/tool.dSYM` too.

### Bazel

The `xclang_debug_symbols` rule makes the GSYM, and the
`generate_dsym_file` feature of rules_cc makes the dSYM in the link:

<!-- file: examples/debug-symbols/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")
load("@xclang//bazel:debug_symbols.bzl", "xclang_debug_symbols")

cc_binary(
    name = "tool",
    srcs = ["tool.cpp"],
    copts = ["-g"],
    features = ["generate_dsym_file"],
)

xclang_debug_symbols(
    name = "tool_symbols",
    binary = ":tool",
)
```

::: details MODULE.bazel and .bazelrc

<!-- file: examples/debug-symbols/MODULE.bazel -->
```python
module(name = "tool")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.6")
```

<!-- file: examples/debug-symbols/.bazelrc -->
```
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
```

:::

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --strip=never //:tool_symbols //:tool.stripped
```

`bazel-bin/tool.gsym` is the GSYM, and `bazel-bin/tool.stripped` the
program to ship ([strip](#strip)). The fastbuild mode strips debug
information unless `--strip=never` is given.

## Options

| | CMake | Bazel |
|---|---|---|
| GSYM | `xclang_debug_symbols(<program>)` | `xclang_debug_symbols(name, binary)` |
| dSYM, macOS targets | made by `xclang_debug_symbols` | `features = ["generate_dsym_file"]`, or `--apple_generate_dsym` |
| extra llvm-gsymutil options | `GSYM_ARGS <option>...` | `gsymutil_args = [...]` |
| llvm-gsymutil's warnings | `<program>.gsym.log` | output group `gsym_log` |
| debug information | `-g` | the same, in `copts` |

`--merged-functions` keeps every name of the functions that identical
code folding merged.

## Behavior

- **Bazel builds have relative paths in debug information** (below), so a
  program is the same bytes from every sandbox and every checkout.
- **The dSYM comes from the link**, with the objects of ThinLTO (below).
- **The GSYM comes from the dSYM** on macOS, and from the program
  elsewhere. llvm-gsymutil runs on the host, also for another target.
- **The strip for a shipped binary depends on the object format** (below).

### Paths in Debug Information

By default, a compiler writes the absolute directory it ran in into the
DWARF (`DW_AT_comp_dir`). On macOS, the linker writes the absolute path of
every object file into the debug map of the program, and lldb and dsymutil
find the DWARF in the objects through it. So the same build in two
directories gives two different programs. A remote or sandboxed build
names directories that exist nowhere else.

In Bazel, xclang's toolchains make every such path relative to the
execution root:

- Compiles have `-ffile-compilation-dir=.`. The compilation directory of
  the DWARF, and of coverage mappings, is `.`, and its files are
  `pkg/file.cpp` and `external/<repository>/...`.
- macOS links have `-Wl,-oso_prefix,.`, so the debug map names its objects
  `bazel-out/...`.
- Windows links have `-Wl,--no-insert-timestamp`, so a PE program has no
  link time.
- clang names its own paths relatively (`-no-canonical-prefixes`).

A debugger then needs one mapping, from `.` to the `bazel-<workspace>` link
of the workspace
([Bazel](../integrations/bazel.md#debug-in-gdb-lldb-and-vs-code)). CMake
builds keep the absolute paths of CMake; relative paths there are
[planned](../design/roadmap.md#cmake-relative-paths).

### Why a dSYM Comes from the Link

A macOS program does not contain its DWARF. Its debug map points into the
object files, and dsymutil collects the DWARF from them. With ThinLTO, the
objects that hold the code of the program are those of the LTO backend.
The linker writes them to a temporary directory and deletes them. A dSYM
made after the link then misses every function that went through LTO.
clice's nightly macOS symbols had no line of libclang until this was
found.

So xclang makes the dSYM in the link. The link keeps the LTO objects
(`-object_path_lto <dir>`), dsymutil runs right after it in the same
action, and then the objects go. The link also keeps, in the debug map,
the names of the functions that identical code folding merged
(`--keep-icf-stabs`). A crash in a folded function then names one of them,
and `--merged-functions` can list them all.

`-object_path_lto` is also what the clang driver passes when it compiles and
links in one command. It exposed an lld bug, which
[patch 0007](../reference/patches.md) fixes
([macOS](../design/macos.md#the-patch-it-took)).

### Strip

The `<name>.stripped` program of Bazel is stripped for shipping, by object
format:

- ELF and COFF: `--strip-unneeded`. The program loses its debug
  information and every symbol no relocation needs.
- Mach-O: `--strip-all`, as Apple's `strip` does: every symbol that dyld
  does not bind, global functions included.

On macOS, `dladdr` names an address by the nearest preceding symbol. A
stripped program that keeps the names of its global functions gives a
crash log wrong names: a local function is reported as the global one
before it. With `--strip-all`, the crash log has addresses only, and the
dSYM or GSYM names them correctly. `--stripopt` adds options to the strip.

## Not Yet Supported

| | status |
|---|---|
| [Relative paths in the debug information of CMake builds](../design/roadmap.md#cmake-relative-paths) | Planned |
| [The same GSYM file on every run](../design/roadmap.md#gsym-determinism) | Planned |

## Known Limitations

- **`-gline-tables-only` gives a GSYM without lines.** llvm-gsymutil of
  LLVM 23 loads no function from that DWARF. The GSYM then holds only the
  names of the symbol table, and a lookup gives the function without its
  file and line. Build with `-g`.
- **GSYM files are not deterministic.** `llvm-gsymutil --convert` with its
  default threads writes a different file each run from the same DWARF.
  On one program, three runs gave three digests, 3,043,120 to 3,053,168
  bytes. The lookups agree; the layout does not. With `--num-threads=1`
  the file is the same every run, and about 0.6% smaller.
  `xclang_debug_symbols` does not pass it, so the GSYM of a release cannot
  be compared byte for byte with that of a rebuild. Passing it is
  [planned](../design/roadmap.md#gsym-determinism).
