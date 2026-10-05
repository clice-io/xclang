# The toolchain's shape

How the pieces of an archive fit together, and why: clang's config files
instead of built-in defaults, one program for every tool, and plain
directories for the sysroots.

## A config file per target

clang reads a config file for the target it compiles for: for
`--target=aarch64-w64-mingw32` it looks for `aarch64-w64-windows-gnu.cfg`
(its normalized spelling of the triple) next to its own program, and puts
the options in it before the command line's. xclang writes one per target
and per spelling of it into `bin/`:

| target | config files |
|---|---|
| Linux | `<arch>-unknown-linux-gnu.cfg`, `<arch>-pc-linux-gnu.cfg` |
| Windows | `<arch>-w64-windows-gnu.cfg`, `<arch>-pc-windows-gnu.cfg` |
| macOS | `<arch>-apple-darwin.cfg`, `<arch>-apple-macos.cfg`, `<arch>-apple-macosx.cfg` (`arm64` and `aarch64` for arm64) |

What each says ([config/](https://github.com/clice-io/xclang/tree/main/config)):

| target | options |
|---|---|
| Linux | `--sysroot` of the target's directory, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-static-libstdc++ -static-libgcc`, `-fuse-ld=lld` |
| Windows | `--sysroot` of the target's directory, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-fuse-ld=lld` (the sysroot has static libraries only) |
| macOS | xclang's libc++ headers (`-stdlib++-isystem`) and `libc++.a` ahead of the SDK's `libc++.tbd` (`-L`), `-mmacos-version-min=13.0`, `-fuse-ld=lld` |

Paths are relative to the file (`<CFGDIR>`), so the tree works from
wherever it is unpacked. The config files apply to native builds too: a
plain `clang++ main.cpp` on Linux compiles against glibc 2.17 and links
everything but glibc statically.

**Why config files, not built-in defaults.** clang can be built with
defaults (`CLANG_DEFAULT_CXX_STDLIB`, `CLANG_DEFAULT_RTLIB`,
`CLANG_DEFAULT_LINKER`, ...), and 23.1.2.1 was. Those defaults live in
clang's driver, which is also in libclang, and tools built on libclang run
the driver to understand other compilers' commands. clice does exactly
that: given a `g++` command from a project's compilation database, it runs
clang's driver in g++'s place to find the include paths. With the defaults
built in, that `g++` command got libc++'s headers instead of libstdc++'s.
Since 23.1.2.2 the defaults are gone and the config files carry them:
`clang` from `bin/` reads its target's file, and libclang's driver, which
has no `bin/` and no config file, behaves like upstream clang.

The same separation gives the bare compiler back on demand:
`--no-default-config` skips the config file, for building against the
system's own headers and libraries, as upstream clang would.

Two details:

- **clang-cl targets MSVC.** clang-cl looks for `<default target>-clang-cl.cfg`,
  then `<default target>.cfg`, before it turns to the MSVC target, so it
  read the host's MinGW options and warned about each. An empty
  `<spelling>-clang-cl.cfg` for every spelling stops it (since 23.1.2.3).
- **Bazel uses its own copy.** clang makes a config file's directory
  absolute, and Bazel needs no absolute paths in its actions' outputs (the
  dependency files would name the sandbox). The Bazel module writes each
  config file again with paths relative to the execution root and passes
  `--no-default-config --config=<file>` ([Bazel's module](bazel-module.md)).

## One program

clang, lld and most of the tools (`llvm-ar`, `llvm-objcopy`, `dsymutil`,
`llvm-gsymutil`, ...) are one program, `llvm`, built with LLVM's
`LLVM_TOOL_LLVM_DRIVER_BUILD`. Each name is a link to it (on Windows, a
small launcher), and it dispatches on the name it was started by. Every
tool would otherwise carry its own copy of LLVM's libraries. When xclang
switched to it, the archives shrank:

| host | before | after |
|---|---|---|
| Linux x64 | 148 MB | 83 MB |
| Linux arm64 | 133 MB | 77 MB |
| macOS arm64 | 154 MB | 100 MB |
| macOS x64 | 172 MB | 110 MB |
| Windows x64 | 540 MB (a zip) | 82 MB |
| Windows arm64 | 521 MB (a zip) | 74 MB |

(The same change dropped the Linux sysroots' locale archive and turned on
identical code folding, so not all of it is the one program's; the
Windows numbers also change from zip to `.tar.xz`.) A shared `libLLVM`
would also have shared the code; it was rejected for speed: calls into it
go through the dynamic linker's tables, and ThinLTO cannot optimize
across its boundary.

A tool that reads clang's `-###` output sees a consequence: clang prints
its compile job as

```
"/path/xclang/bin/llvm" "clang" "-cc1" ...
```

not `"/path/xclang/bin/clang" "-cc1" ...`. The driver runs the job as the
program it is in, with the tool's name as the first argument; a parser
that expects `-cc1` as the second word has to skip the name. clice met
this in its first build with xclang and handles both forms.

Some tools are outside the one program, built on their own:
`llvm-profdata`, `llvm-cov`, `llvm-dwarfdump`, `llvm-strings` and
`FileCheck`.

## Windows: launchers, not links

A Windows archive holds no symbolic links: Windows creates them only with
developer mode or administrator rights, and conda packages for Windows
cannot carry them. Every name of `llvm.exe` (`clang++.exe`, `ld.lld.exe`,
...) is a small program, [`windows/alias.c`](https://github.com/clice-io/xclang/blob/main/windows/alias.c),
that starts `llvm.exe <name> <arguments>`. Why the name goes in as an
argument, and how the launcher keeps `llvm.exe` from outliving a killed
build, is in [Windows](windows.md#the-launchers).

## Plain directories

A target's directory is a sysroot laid out the way clang's drivers
expect, with libc++, libunwind and the GCC names in it, and compiler-rt
is in clang's resource directory ([layout](../reference/layout.md)).
Nothing is specific to xclang's clang: any clang of the same major version
pointed at a target's directory with `--sysroot` and at the resource
directory with `-resource-dir` cross-compiles with it, and the config files
are plain text anyone can read to see what a target means.
