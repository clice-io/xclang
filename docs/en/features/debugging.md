# Debugging and Debug Symbols

A shipped binary is stripped, and its debug symbols are kept apart to resolve
crash addresses to functions, files and line numbers. xclang builds debug
symbols for every target with the tools bundled in every toolchain archive
(`llvm-gsymutil`, `dsymutil`, `llvm-symbolizer`, `llvm-dwarfdump` and
`llvm-strip`):

- **GSYM**, for every target except the MSVC targets: address-indexed
  functions, inline call stacks and line tables converted from DWARF by
  `llvm-gsymutil --convert`. A GSYM file is about a tenth of the size of the
  DWARF and fast to look up in a crash reporter.
- **dSYM**, for [macOS](../guide/cross-compiling.md#macos) targets: the `.dSYM` bundle read
  by Apple's tools and `lldb`, collected by `dsymutil` on any host.
- **PDB**, for [MSVC](../guide/cross-compiling.md#msvc-targets) targets: the CodeView
  `.pdb` written by `lld-link`, which `llvm-gsymutil` does not read.

## Usage

The example is in
[examples/debug-symbols](https://github.com/clice-io/xclang/tree/main/examples/debug-symbols).
The CMake and plain `clang++` commands below run in that directory inside
`pixi shell` after `pixi install`. `tool.cpp` keeps `answer` out of line so its
address maps to one source line:

<!-- file: examples/debug-symbols/tool.cpp -->
```cpp
#include <cstdio>

extern "C" [[gnu::noinline]] int answer(int x) { return x * 6 + 36; }

int main(int argc, char**) { std::printf("%d\n", answer(argc)); }
```

### CMake

`xclang_debug_symbols(<program>)` generates debug symbols after each link of
the CMake target `<program>`: `<program>.gsym` next to the binary (with
`llvm-gsymutil`'s warnings written to `<program>.gsym.log`), and for a macOS
target `<program>.dSYM` as well.

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

The program prints `42`, with `build/tool.gsym` alongside it (and
`build/tool.dSYM` on a macOS target).

- Pass `GSYM_ARGS --merged-functions` to `xclang_debug_symbols(tool ...)` to
  keep every function name when identical code folding (ICF) merges functions
  with identical bodies.
- For a macOS target, `xclang_debug_symbols` tells the linker to retain
  ThinLTO object files in `<build-dir>/<program>.lto` so `dsymutil` can read
  their DWARF ([Why a dSYM Comes from the Link](#why-a-dsym-comes-from-the-link)).
- For an MSVC target, `lld-link` writes a `.pdb` whenever the link has `-g`
  (`Debug` and `RelWithDebInfo` include it; in other configurations pass `-g`
  in `target_link_options` as well), and `xclang_debug_symbols` does nothing.

### Bazel

The `xclang_debug_symbols` rule generates the GSYM file, and the
`generate_dsym_file` feature generates the `.dSYM` bundle during a macOS link:

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
bazel_dep(name = "xclang", version = "23.1.2.8")
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

- `bazel-bin/tool.gsym` is the GSYM file. `llvm-gsymutil` runs on the host,
  including when cross-compiling for another target, with `--num-threads=1` so
  rebuilds produce identical bytes. Its warnings are written to `tool.gsym.log`
  in the `gsym_log` output group. Pass `gsymutil_args = ["--merged-functions"]`
  to keep all names of functions merged by ICF.
- `bazel-bin/tool.dSYM`, for a macOS target, is generated on every host in the
  `dsyms` output group; `--apple_generate_dsym` enables `generate_dsym_file`
  for the whole build.
- For an MSVC target, `tool_symbols` outputs `bazel-bin/tool.pdb` from the
  link's `generate_pdb_file` feature (`pdb_file` output group, on by default
  with `-c dbg`).
- `bazel-bin/tool.stripped` is the stripped binary for shipping
  ([Strip](#strip)). Bazel's `fastbuild` mode strips debug information unless
  `--strip=never` (or `-c dbg`) is given.

Without putting the toolchain on `PATH`, run the toolchain's `llvm-gsymutil`
through `@xclang//bazel:llvm-gsymutil` (pass an absolute path to the `.gsym`
file because `bazel run` changes to the runfiles directory):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run @xclang//bazel:llvm-gsymutil -- "$PWD/bazel-bin/tool.gsym"
```

Pass `--address=0x<address>` to look up a specific address.

#### Debug in gdb, lldb and VS Code

Every path in the debug information of a Bazel build is relative to the
execution root ([Paths in Debug Information](#paths-in-debug-information)).
Configure your debugger with one mapping from `.` to the `bazel-<workspace>`
symlink in the workspace root (where `<workspace>` is the workspace directory's
name). That symlink holds the workspace's own sources and `external/<repo>` for
external repositories:

```text
# gdb, in ~/.gdbinit or the session
directory /path/to/workspace/bazel-workspace
# lldb, in ~/.lldbinit or the session
settings set target.source-map . /path/to/workspace/bazel-workspace
```

In VS Code, CodeLLDB takes `sourceMap` in `launch.json`:

```json
"sourceMap": { ".": "${workspaceFolder}/bazel-workspace" }
```

The C/C++ extension with `gdb` takes `setupCommands`:

```json
"setupCommands": [{ "text": "directory ${workspaceFolder}/bazel-workspace" }]
```

On macOS, `lldb` reads a `.dSYM` bundle from any directory. Without a `.dSYM`,
`lldb` reads the object files named in the binary's debug map (`bazel-out/...`)
relative to its current working directory; start `lldb` in the workspace root,
which contains the `bazel-out` symlink.

### Plain Clang

Compile a Linux `x86_64` binary with `-g`, convert its DWARF to `tool.gsym`,
and look up the address of `answer` (these commands run on any host):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ --target=x86_64-unknown-linux-gnu -g -O2 tool.cpp -o tool
llvm-gsymutil --convert tool --out-file tool.gsym --num-threads=1
llvm-gsymutil tool.gsym --address=0x$(llvm-nm tool | awk '$3 == "answer" { print $1 }')
```

It prints `answer @ <this directory>/tool.cpp:3`. For a macOS target, generate
the `.dSYM` bundle first with `dsymutil tool -o tool.dSYM`, then convert the
`.dSYM` bundle with `llvm-gsymutil --convert`.

## Options

| | CMake | Bazel | Plain Clang |
|---|---|---|---|
| GSYM | `xclang_debug_symbols(<program>)` | `xclang_debug_symbols(name, binary)` | `llvm-gsymutil --convert <in> --out-file <out> --num-threads=1` |
| dSYM (macOS targets) | generated by `xclang_debug_symbols(<program>)` | `features = ["generate_dsym_file"]`, or `--apple_generate_dsym` | `dsymutil <bin> -o <bin>.dSYM` |
| PDB (MSVC targets) | written by links with `-g` | `generate_pdb_file` (on with `-c dbg`), or `xclang_debug_symbols` | `-g` (or `/Zi` in `clang-cl`) |
| Extra `llvm-gsymutil` flags | `GSYM_ARGS <option>...` | `gsymutil_args = [...]` | command-line flags |
| `llvm-gsymutil` log | `<program>.gsym.log` | output group `gsym_log` | stdout/stderr |
| Debug info flag | `-g` | `copts = ["-g"]` or `-c dbg`, with `--strip=never` in `fastbuild` | `-g` |
| Stripped binary | `llvm-strip` | `<binary>.stripped` target | `llvm-strip --strip-unneeded` (ELF/COFF) or `--strip-all` (Mach-O) |

Full option lists are in the [CMake API](../reference/cmake-api.md) and the
[Bazel API](../reference/bazel-api.md).

## Behavior

- **Bazel builds record relative paths in debug information**
  ([below](#paths-in-debug-information)), producing identical binaries across
  sandboxes and checkout directories.
- **macOS `.dSYM` bundles are collected during the link** so ThinLTO object
  files are included ([below](#why-a-dsym-comes-from-the-link)).
- **GSYM files are built from the `.dSYM` on macOS** and directly from the
  binary on Linux and MinGW targets; `llvm-gsymutil` runs on any host. MSVC
  targets produce a `.pdb` instead.
- **Stripping for shipped binaries is tailored to the object format**
  ([below](#strip)).
- **GSYM needs `-g`**: from `-gline-tables-only` DWARF, LLVM 23's
  `llvm-gsymutil` loads no functions, and the GSYM has names from the
  symbol table without files or lines.
- **One thread for the same GSYM**: with its default threads,
  `llvm-gsymutil --convert` lays the file out differently from run to run
  (3,043,120 to 3,053,168 bytes over three runs, with the same lookups).
  With `--num-threads=1` every run gives the same file, about 0.6% smaller;
  for Ubuntu 24.04's `libclang-cpp.so.18` (a 98 MB GSYM) and
  `libLLVM.so.18` (118 MB) on a 4-core runner, one thread took 6.0 s and
  7.8 s, four threads 4.3 s and 5.7 s. `xclang_debug_symbols` passes
  `--num-threads=1`.


### Paths in Debug Information

By default, compilers record the absolute working directory in DWARF
(`DW_AT_comp_dir`), and on macOS the linker writes the absolute path of every
`.o` file into the binary's debug map (`N_OSO` stabs) so `lldb` and `dsymutil`
can locate the DWARF. The same sources built in two directories, or in
sandboxes, then give different binaries, whose debug paths do not exist on
another machine.

In Bazel, xclang's toolchains make every debug and coverage path relative to
the execution root:

- **Compiles pass `-ffile-compilation-dir=.`**: `DW_AT_comp_dir` and coverage
  mappings record `.` as the compilation directory, and source paths are
  `pkg/file.cpp` or `external/<repo>/...`.
- **macOS links pass `-Wl,-oso_prefix,.`**: the Mach-O debug map records object
  files as `bazel-out/...`. Library objects are passed to the linker directly
  between `--start-lib` and `--end-lib` rather than inside `.a` archives: in an
  archive, two objects with the same basename (such as `foo.cppm`'s and
  `foo.cpp`'s `foo.o`) both appear in the debug map as `libfoo.a(foo.o)` with a
  Bazel mtime of `0`, causing `dsymutil` to read the first member for both.
- **Windows links omit timestamps**: MinGW links pass
  `-Wl,--no-insert-timestamp` and MSVC links pass `-Wl,/Brepro`, and MSVC PDBs
  record source paths relative to the execution root.
- **Tool paths stay relative**: `clang` runs with `-no-canonical-prefixes`.

CMake builds keep CMake's absolute paths in debug information; relative debug
paths in CMake are [planned](../design/roadmap.md#cmake-relative-paths).

### Why a dSYM Comes from the Link

Mach-O executables do not embed DWARF sections; their debug map points to the
`.o` files, and `dsymutil` reads the DWARF from those `.o` files. Under
ThinLTO, the LTO backend compiles bitcode into temporary `.o` files during the
link and deletes them before returning. Running `dsymutil` after a normal
ThinLTO link misses every function compiled through ThinLTO (which previously
left clice's nightly macOS builds without line numbers for `libclang`).

xclang therefore generates the `.dSYM` from the link's preserved LTO objects:

- The link passes `-object_path_lto <dir>` to retain the temporary ThinLTO
  backend objects. In Bazel, `dsymutil` runs immediately in the link action and
  deletes the directory before the action finishes; in CMake, the objects are
  kept in `<build-dir>/<target>.lto` and `dsymutil` runs as a post-build step.
- The link passes `--keep-icf-stabs` so functions folded by ICF retain their
  stab entries in the debug map, allowing `--merged-functions` in
  `llvm-gsymutil` to record all merged function names.
- `dsymutil` runs with `--linker classic`: LLVM 23's default `--linker parallel`
  emits DWARF 5 line tables (for macOS 15+ deployment targets) that crash
  Apple's `atos`.
- Passing `-object_path_lto` also exposed an `ld64.lld` bug where the empty
  `ltmp0` object overwrote `main`'s `__unwind_info` entry on `arm64`, fixed by
  [patch 0007](../reference/patches.md)
  ([macOS](../design/macos.md#why-ld64-lld-and-patch-0007)).

### Strip

Bazel's `<name>.stripped` target (and `llvm-strip` when stripping manually)
strips binaries according to their object format:

- **ELF and COFF**: `--strip-unneeded`, removing debug sections and symbols not
  required by relocations.
- **Mach-O**: `--strip-all` (matching Apple's `strip`), removing all symbols
  that `dyld` does not bind, including global function names.

On macOS, `dladdr` resolves an address in a stack trace to the nearest
preceding symbol. If a stripped binary keeps global or exported weak function
symbols, crash logs attribute crashes inside stripped local functions to the
preceding exported symbol. While `--strip-all` removes local and non-exported
global symbols, it keeps symbols exported for `dyld` coalescing, including weak
C++ template instantiations and inline functions (1,844 symbols in clice's
stripped binary). Optimized macOS builds in Bazel therefore enable the
`no_exported_symbols` feature by default, passing `-Wl,-no_exported_symbols` so
the executable exports nothing, `<name>.stripped` retains no function symbols,
and crash logs record raw addresses for the `.dSYM` or `.gsym` to symbolicate
accurately. If an executable loads plugins that bind to its symbols, disable
the feature with `features = ["-no_exported_symbols"]` on its `cc_binary`.
Pass extra flags to `llvm-strip` with `--stripopt`.
