# Toolchain Structure

How the pieces of a toolchain archive fit together, and why.

## Summary

clang finds each target's sysroot and runtimes through a config file per
target, not through defaults built into the compiler. clang, lld and most
tools are one program. The sysroots are plain directories that any clang
can use. For users, that means `--target` is the whole difference between
a native and a cross build, and `--no-default-config` gives back a bare,
upstream-like clang.

## A Config File per Target

clang reads a config file for the target it compiles for. For
`--target=aarch64-w64-mingw32`, it looks for `aarch64-w64-windows-gnu.cfg`
next to its own program. That name is clang's normalized spelling of the
triple. clang puts the options in the file before those of the command
line. xclang writes one file per target, and per spelling of it, into
`bin/`:

| target | config files |
|---|---|
| Linux | `<arch>-unknown-linux-gnu.cfg`, `<arch>-pc-linux-gnu.cfg` |
| Windows (MinGW) | `<arch>-w64-windows-gnu.cfg`, `<arch>-pc-windows-gnu.cfg` |
| macOS | `<arch>-apple-darwin.cfg`, `<arch>-apple-macos.cfg`, `<arch>-apple-macosx.cfg` (`arm64` and `aarch64` for arm64) |
| Windows (MSVC), [unreleased](roadmap.md#msvc) | `<arch>-pc-windows-msvc.cfg`, `<arch>-unknown-windows-msvc.cfg`, and for clang-cl `<spelling>-clang-cl.cfg` |

Each says this
([config/](https://github.com/clice-io/xclang/tree/main/config)):

| target | options |
|---|---|
| Linux | `--sysroot` of the target, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-static-libstdc++ -static-libgcc`, `-fuse-ld=lld` |
| Windows (MinGW) | `--sysroot` of the target, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-fuse-ld=lld`; the sysroot has static libraries only |
| macOS | xclang's libc++ headers (`-stdlib++-isystem`) and `libc++.a` ahead of the SDK's `libc++.tbd` (`-L`), `-mmacos-version-min=13.0`, `-fuse-ld=lld` |
| Windows (MSVC) | `@../sdk/windows/<target>.cfg`, the file of the fetched SDK that names it; `-fuse-ld=lld`; the builtins and the hybrid CRT named in every object ([MSVC targets](windows.md#msvc-targets)) |

Paths are relative to the file (`<CFGDIR>`), so the toolchain directory
works wherever it is unpacked. The config files apply to native builds
too. A plain `clang++ main.cpp` on Linux compiles against glibc 2.17, not
the machine's glibc, and links everything but glibc statically.

### Why Not Built-In Defaults

clang can be built with defaults instead (`CLANG_DEFAULT_CXX_STDLIB`,
`CLANG_DEFAULT_RTLIB`, `CLANG_DEFAULT_LINKER`, ...), and 23.1.2.1 was.
Those defaults live in the clang driver, which is also in libclang. Tools
built on libclang run the driver to understand other compilers' commands.

clice does exactly that. Given a `g++` command from a compilation
database, it runs the clang driver in place of g++ to find the include
paths. With the defaults built in, that `g++` command got the headers of
libc++ instead of libstdc++.

Since 23.1.2.2 the defaults are gone, and the config files carry them, so no
default needs a patched driver. `clang` from `bin/` reads the file for its
target. The driver inside libclang has no `bin/` and no config file, so it
behaves like upstream clang.

### The Bare Compiler

The same separation gives the bare compiler back on demand.
`--no-default-config` skips the config file. clang then builds against the
system's own headers and libraries, as upstream clang would. Use it to
link against the system's libstdc++, for example.

### Two Details

- **clang-cl targets MSVC.** clang-cl looks for
  `<default target>-clang-cl.cfg`, then `<default target>.cfg`, before it
  turns to the MSVC target. So it read the MinGW options of the host and
  warned about each. An empty `<spelling>-clang-cl.cfg` for every spelling
  stops that, since 23.1.2.3. With the [unreleased](roadmap.md#msvc) MSVC
  targets, that file is the clang-cl file of the MSVC target of its
  architecture.
- **Bazel uses its own copy.** clang makes the directory of a config file
  absolute, and Bazel needs no absolute paths in the outputs of its
  actions; the dependency files would name the sandbox. The Bazel module
  writes each config file again with paths relative to the execution root
  ([no absolute paths](bazel-module.md#no-absolute-paths)).

## One Program

clang, lld and most tools (`llvm-ar`, `llvm-objcopy`, `dsymutil`,
`llvm-gsymutil`, ...) are one program, `llvm`, built with LLVM's
`LLVM_TOOL_LLVM_DRIVER_BUILD`. Each name is a link to it, or on Windows a
small [launcher](windows.md#the-launchers). The program dispatches on the
name it was started by. Otherwise every tool carries its own copy of the
LLVM libraries.

When xclang switched to it, the archives shrank:

| host | before | after |
|---|---|---|
| Linux x64 | 148 MB | 83 MB |
| Linux arm64 | 133 MB | 77 MB |
| macOS arm64 | 154 MB | 100 MB |
| macOS x64 | 172 MB | 110 MB |
| Windows x64 | 540 MB (a zip) | 82 MB |
| Windows arm64 | 521 MB (a zip) | 74 MB |

Not all of it came from the one program. The same change dropped the
locale archive of the Linux sysroots and turned on identical code folding.
The Windows archives also changed from zip to `.tar.xz`.

A shared `libLLVM` would also have shared the code. It was rejected for
speed: calls into it go through the tables of the dynamic linker, and
ThinLTO cannot optimize across its boundary.

Some tools are outside the one program, built on their own:
`llvm-profdata`, `llvm-cov`, `llvm-dwarfdump`, `llvm-strings` and
`FileCheck`.

### What `-###` Prints

A tool that reads the output of `clang -###` sees a consequence. clang
prints its compile job like this:

```
"/path/xclang/bin/llvm" "clang" "-cc1" ...
```

It does not print `"/path/xclang/bin/clang" "-cc1" ...`. The driver runs
the job as the program it is in, with the tool name as the first argument.
A parser that expects `-cc1` as the second word has to skip the name.
clice met this in its first build with xclang and handles both forms.

## Plain Directories

A sysroot is laid out the way the clang drivers expect, with libc++,
libunwind and the [GCC library names](hermeticity.md#gcc-library-names)
in it. compiler-rt is in the clang resource directory
([archive layout](../reference/layout.md)). The sysroots hold what
compiling and linking read, nothing else: headers, startup files and
libraries, not glibc's programs, locales or gconv modules.

Nothing in them is specific to xclang's clang. Any clang of the same major
version, pointed at a sysroot with `--sysroot` and at the resource
directory with `-resource-dir`, cross-compiles with it. The config files
are plain text, so anyone can read what a target means.
