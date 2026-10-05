# Debugging and debug symbols

Two things a toolchain decides about debugging: what paths a program's
debug information names, so that a debugger finds the sources; and how a
release's symbols are made and kept, so that a crash from the field can be
read. xclang's tools for both are in every archive: `dsymutil`,
`llvm-gsymutil`, `llvm-symbolizer`, `llvm-dwarfdump`.

## Paths in debug information

By default a compiler writes the absolute directory it ran in into the
DWARF (`DW_AT_comp_dir`), and on macOS the linker writes the absolute path
of every object file into the program's debug map, which is how lldb and
dsymutil find the DWARF, left in the objects. So the same build in two
directories gives two different programs, and a remote or sandboxed build
names directories that exist nowhere else.

In Bazel, xclang's toolchains make every such path relative to the
execution root:

- compiles have `-ffile-compilation-dir=.`: the DWARF's compilation
  directory (and coverage mappings') is `.`, its files `pkg/file.cpp` and
  `external/<repository>/...`;
- macOS links have `-Wl,-oso_prefix,.`: the debug map names its objects
  `bazel-out/...`;
- Windows links have `-Wl,--no-insert-timestamp`: a PE program has no
  link time;
- clang's own paths are relative (`-no-canonical-prefixes`).

The program is then the same bytes from every sandbox and every checkout,
debug information included, and a debugger needs one mapping, from `.` to
the workspace's `bazel-<workspace>` link
([Bazel](../integrations/bazel.md#debugging) has the gdb, lldb and VS Code
settings). tests/bazel.ts builds a program with `-c dbg` in two checkouts
and compares the bytes, and has gdb (Linux), lldb with and without the dSYM
(macOS) and llvm-symbolizer (Linux, Windows) find its lines in the
workspace and in an external repository, on every host
([23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37345631067)).

CMake builds keep CMake's absolute paths; doing the same there is
[planned](../design/roadmap.md#reproducibility).

## Debug symbols for a release

A released program is stripped; its debug information is kept apart, to
turn a crash's addresses into functions and lines later. Two formats:

- **GSYM**, for every target: functions, inlining and line tables by
  address, made from the DWARF by `llvm-gsymutil --convert`, about a tenth
  of the DWARF's size, and fast to look up (`llvm-gsymutil tool.gsym
  --address=<address>`). It is what a crash reporter needs and nothing
  more.
- **dSYM**, for macOS targets: the bundle Apple's tools and lldb read,
  made by `dsymutil` from the objects the program's debug map points into.

Both build systems make them after each link, with the toolchain's tools:
`xclang_debug_symbols(<target>)` in CMake
([CMake](../integrations/cmake.md#debug-symbols)), the
`xclang_debug_symbols` rule and the `generate_dsym_file` feature in Bazel
([Bazel](../integrations/bazel.md#debug-symbols)). By hand, as
tests/smoke.ts does for every target:

```sh
clang++ -g -O1 -c main.cpp -o main.o
clang++ main.o -o tool
dsymutil tool -o tool.dSYM                               # macOS targets
llvm-gsymutil --convert tool --out-file tool.gsym        # or tool.dSYM on macOS
llvm-gsymutil tool.gsym --address=<address>
```

The program needs debug information: `-g`, or `-gline-tables-only` for
functions and lines alone, which is what a GSYM keeps.

### Why a dSYM comes from the link

A macOS program's DWARF is not in the program: the debug map points into
the object files, and dsymutil collects it from them. With ThinLTO the
objects that hold the program's code are the LTO backend's, which the
linker writes to a temporary directory and deletes. A dSYM made after the
link then misses every function that went through LTO: clice's nightly
macOS symbols had no line of libclang until this was found.

So xclang makes the dSYM in the link: the link keeps the LTO objects
(`-object_path_lto <dir>`), dsymutil runs right after it, in the same
action, and the objects go. The link also keeps the names of functions
that identical code folding merged in the debug map
(`--keep-icf-stabs`), so a crash in a folded function names one of them
and `--merged-functions` can list all. The dSYM and the program came out
the same bytes with and without the ThinLTO cache, cold or warm, when this
was checked by hand for 23.1.2.6 on arm64 and x86_64 macOS.

`-object_path_lto` is also what clang's driver passes when it compiles and
links in one command, and it exposed an lld bug: an empty LTO object's
symbol took `main`'s unwind entry, so on arm64 a program built that way
could not catch its own exceptions. xclang carries the fix,
[patch 0007](../design/patches.md), and that is what made ld64.lld usable
for macOS targets at all ([macOS](../design/macos.md)).

### GSYM is not deterministic yet

`llvm-gsymutil --convert` with its default threads writes a different file
each run from the same DWARF: on one program, three runs gave three
digests, 3,043,120 to 3,053,168 bytes. The lookups agree; the layout does
not. With `--num-threads=1` the file is the same every run and about 0.6%
smaller. Neither `xclang_debug_symbols` passes it yet; until it does, a
release's GSYM cannot be compared byte for byte with a rebuild's.

## Strip

Bazel's `<name>.stripped` is a release's strip by object format: ELF and
COFF `--strip-unneeded`, Mach-O `--strip-all`, as Apple's `strip` does. On
macOS a stripped program that keeps its global functions' names gives a
crash log wrong names: `dladdr` names an address by the nearest preceding
symbol, so a local function is reported as the global one before it. With
`--strip-all`, the crash log has addresses only, and the dSYM or GSYM
names them correctly.
