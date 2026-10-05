# Bazel

xclang is a Bazel module (Bazel 9, rules_cc 0.2.25): the C++ toolchain of
the host for each of its targets, downloaded from the release of the
module's version by its sha256, with libclang and the option tables as
repositories. Every release is published to the clice Bazel registry,
[bazel.clice.io](https://github.com/clice-io/bazel). Every rule, feature
and repository is listed in the [Bazel API](../reference/bazel-api.md); why
the module is built the way it is, in [the Bazel module](../design/bazel-module.md).

## Setup

A complete project is
[examples/bazel](https://github.com/clice-io/xclang/tree/main/examples/bazel),
which [examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml)
builds and runs on every host, and builds for another target, from
bazel.clice.io ([the run for 23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37354730630)):

<!-- file: examples/bazel/MODULE.bazel -->
```python
module(name = "hello")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.6")
```

<!-- file: examples/bazel/.bazelrc -->
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

<!-- file: examples/bazel/BUILD.bazel -->
```python
load("@rules_cc//cc:cc_binary.bzl", "cc_binary")

cc_binary(
    name = "hello",
    srcs = ["main.cpp"],
    features = ["cpp_modules"],
    deps = ["@xclang//bazel:std"],
)
```

```sh
bazel build //...
bazel run //:hello
```

The module registers its toolchains itself. A library that only builds
with xclang makes the `bazel_dep` a `dev_dependency`. To link libclang or
include the option tables:

```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

On Windows, in `%USERPROFILE%\.bazelrc` (startup options have no
per-platform form): a short output root, as Bazel's default one is too
deep for Windows paths, and runfiles as symlinks rather than copies:

```
startup --output_user_root=C:/b
startup --windows_enable_symlinks
```

Bazel itself is best run through bazelisk (`npm install -g
@bazel/bazelisk`, or as a devDependency and `npx bazelisk`) with the version
in `.bazelversion`; conda-forge has no bazelisk, and its bazel runs only
with `--batch`.

A commit of this repository works too, through `git_override`. The module
is the repository's `packages/bazel` directory, and the commit's
`packages/bazel/bazel/versions.bzl` names the release it downloads:

```python
bazel_dep(name = "xclang", version = "23.1.2.6")
git_override(
    module_name = "xclang",
    remote = "https://github.com/clice-io/xclang",
    commit = "<commit>",
    strip_prefix = "packages/bazel",
)
```

Older commits (the tags up to 23.1.2.5) have the module at the top of the
repository, and no `strip_prefix`.

## What the toolchain does

- **Hermetic.** Every file of the toolchain an action reads is one of its
  inputs, so another release builds anew, and no path on a command line is
  absolute: a disk or remote cache serves every checkout. The one input from
  the machine is the macOS SDK, which `xcrun` finds; `--macos_minimum_os`
  sets the deployment target.
- **Static.** Libraries link into tests and programs statically: libc++ is
  in every shared object on its own, so memory one shared library allocates
  another would free ([why](../design/hermeticity.md#one-libc-per-shared-object)).
  `cc_binary(linkshared = True)` still makes one (`libfoo.so`,
  `libfoo.dylib`, `foo.dll`); `features = ["supports_dynamic_linker"]`
  gives a target Bazel's dynamic linking back.
- **Windows** programs are MinGW ones, named `.exe`, with `.dll` shared
  libraries.
- Optimized builds link with lld's `--gc-sections` (the `gc_sections`
  feature) for Linux, not for Windows, where it drops static initializers in
  COMDAT sections, such as test registrations ([Windows](../design/windows.md#gc-sections-and-static-initializers)):
  `--features=gc_sections` or `features = ["gc_sections"]` turns it on
  where nothing relies on them, `-gc_sections` off.
- **C++20 modules**: `module_interfaces` with `features = ["cpp_modules"]`,
  scanned by clang-scan-deps; module files hold paths relative to the
  execution root, so they are the same wherever they are built. `import
  std` and `import std.compat` come from `@xclang//bazel:std`, libc++'s
  modules built for the target as a library to depend on. It is built with
  the build's flags (`--cxxopt`): clang refuses a module file built with
  other language options (`-std`, `-fno-exceptions`, `-fno-rtti`, ...), so
  those of its importers go there, not in their `copts`; macros, include
  paths and optimization may differ ([C++20 modules](../features/modules.md)).
- Other repositories' headers are system headers (`-isystem`), whose
  warnings are not the build's; `__DATE__` and `__TIME__` are redacted.
- **Sanitizers** are features: `--features=asan` (or `tsan`, `ubsan`,
  `lsan`), for the whole build: asan compiles and links with libc++'s ASan
  build, which every library of the program must share
  ([sanitizers](../features/sanitizers.md)). On macOS, where the
  sanitizers' runtimes are shared libraries, the feature links in the
  absolute path of the toolchain's: those links alone depend on the
  checkout.
- **Strip**: a program's `.stripped` (`bazel build //pkg:tool.stripped`)
  is a release's, by the target's object format: an ELF or COFF program
  loses its debug information and every symbol no relocation needs
  (`--strip-unneeded`); a Mach-O one every symbol dyld does not bind
  (`--strip-all`, what Apple's `strip` does), its global functions too,
  whose names `dladdr` would otherwise give to the local ones' addresses in
  a crash log. `--stripopt` adds to them.

```python
cc_library(
    name = "shapes",
    features = ["cpp_modules"],
    module_interfaces = ["shapes.cppm"],
    deps = ["@xclang//bazel:std"],
)
```

## Cross-compiling

A build for another target names its platform:

```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //...
```

| platform `@xclang//platforms:` | also | target |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-linux-gnu` | Linux x64, glibc 2.17 |
| `aarch64-unknown-linux-gnu` | `aarch64-linux-gnu` | Linux arm64, glibc 2.17 |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu` | Windows x64, MinGW-w64 (UCRT) |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu` | Windows arm64, MinGW-w64 (UCRT) |
| `aarch64-apple-darwin` | `arm64-apple-darwin` | macOS arm64, from macOS hosts |
| `x86_64-apple-darwin` | | macOS x64, from macOS hosts |

The toolchain is the host's archive configured for the target: its config
file, sysroot and runtimes are the inputs, no other archive is downloaded,
and the build is what it is for the host, static runtimes, Windows names,
C++20 modules and keys without absolute paths included. `@xclang//bazel:std`
and `@libclang` follow the target platform: a tool on libclang built for
Windows x64 links `libclang-<version>-x86_64-w64-mingw32`, which only such a
build downloads. What the build runs itself (`cfg = "exec"`) is built for the
host. The sanitizer features work for the targets that have the sanitizers
(not Windows).

The macOS targets need Xcode's SDK, so they build on macOS hosts only; from
Linux or Windows, a build for them fails at once and says so. Building for
macOS from any host, with Apple's SDK fetched by the user, is in research
([roadmap](../design/roadmap.md)).

The toolchains ask a platform for `@platforms`' os and cpu only, so a
platform of one's own with those works too. Those here also have the C
library, `@xclang//platforms/libc:glibc`, `:mingw` or `:macosx`, for
`select()`; a platform without one gets glibc on Linux and MinGW on Windows,
and another C library of an os and cpu (musl, MSVC's) is to have toolchains
of its own that ask for it.

- Bazel 9 puts every platform's outputs in one directory (`k8-fastbuild`),
  so changing `--platforms` rebuilds what the other one built;
  `common --experimental_platform_in_output_dir` gives each its own
  (`x86_64-w64-mingw32-fastbuild`).
- Tests are built for the target, not run: `bazel test` would run them
  here. `cc_test` builds for any target; a test of another rule builds only
  where an execution platform has the target's os and cpu, or anywhere with
  `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain=false`
  (Bazel's former behaviour).
- Code that includes a Windows header by another case than MinGW-w64's
  file (`<Windows.h>`, `<BaseTsd.h>` for `windows.h`, `basetsd.h`) builds on
  Windows only, whose file names ignore case
  ([Windows](../design/windows.md#case-sensitive-headers)).

## Debugging

Every path the toolchain puts in a program's debug information is
relative to the execution root, so the program is the same bytes from
every sandbox and every checkout, debug information included
([debugging](../features/debugging.md)). A debugger needs one mapping, from
`.` to the workspace's `bazel-<workspace>` link (`<workspace>` the name of
the workspace's directory), which holds the workspace's sources and, under
`external/`, the other repositories':

```
# gdb, in ~/.gdbinit or the session
directory /path/to/workspace/bazel-workspace
# lldb, in ~/.lldbinit or the session
settings set target.source-map . /path/to/workspace/bazel-workspace
```

In VS Code, CodeLLDB takes `"sourceMap": {".":
"${workspaceFolder}/bazel-workspace"}`, and the C/C++ extension with gdb
`"setupCommands": [{"text": "directory
${workspaceFolder}/bazel-workspace"}]`. On macOS lldb reads a program's
dSYM (below) from anywhere; without one, it reads the objects the debug map
names, relative to its working directory: run it in the workspace, whose
`bazel-out` link holds them.

## Debug symbols

`xclang_debug_symbols` makes a program's debug symbols for its release with
the toolchain's own tools: GSYM for every target, and the dSYM for macOS
ones ([what they are](../features/debugging.md#debug-symbols-for-a-release)).

```python
load("@xclang//bazel:debug_symbols.bzl", "xclang_debug_symbols")

cc_binary(
    name = "tool",
    srcs = ["main.cpp"],
    copts = ["-gline-tables-only"],
    features = ["generate_dsym_file"],
)

xclang_debug_symbols(
    name = "tool_symbols",
    binary = ":tool",
)
```

- `tool.gsym`: llvm-gsymutil converts the program's DWARF, on the
  platform the build runs on, also for another target. Its warnings go to
  `tool.gsym.log` (output group `gsym_log`); `gsymutil_args =
  ["--merged-functions"]` keeps every name of the functions identical code
  folding merged.
- `tool.dSYM`, for a macOS target: rules_cc's `generate_dsym_file` feature
  (on the `cc_binary`, or `--apple_generate_dsym` for the build) has
  `cc_binary` declare it (output group `dsyms`) and the toolchain write it
  in the link, ThinLTO's objects included, with the names of the functions
  identical code folding merged (`--keep-icf-stabs`). The GSYM comes from
  it.

The program needs debug information (`-g`, or `-gline-tables-only` for
functions and lines alone) and must not be stripped of it: fastbuild strips
it unless `--strip=never`.

## The ThinLTO cache

libclang is ThinLTO bitcode, so the link of a tool on it generates the code
of every module the tool uses: minutes per link. The linker's ThinLTO cache
makes a link after the first take seconds; how it works and what it saves
is in [the ThinLTO cache](../features/thinlto-cache.md).

`--repo_env=XCLANG_THINLTO_CACHE=<absolute directory>` turns it on: the
module makes the directory (again whenever it is gone), and the toolchains'
`thinlto_cache` feature hands it to the target's linker,
`-Wl,--thinlto-cache-dir=<dir>` for Linux and Windows targets,
`-Wl,-cache_path_lto,<dir>` for macOS ones. `--features=-thinlto_cache`
turns it off for a build, `features = ["-thinlto_cache"]` for a target.
Without the variable, no link has such a flag.

The directory is on the links' command lines, so it is part of their keys:
one path on every machine and in every checkout keeps the links shared by a
disk or remote cache. So a project names one per OS in its `.bazelrc`:

```
# .bazelrc
common:linux --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:linux --sandbox_writable_path=/var/tmp/xclang-thinlto
common:macos --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:windows --repo_env=XCLANG_THINLTO_CACHE=C:/xclang-thinlto
try-import %workspace%/user.bazelrc
```

- Linux's sandbox lets a link write the directory only through
  `--sandbox_writable_path`, which is not part of any key, and gives every
  action a `/tmp` of its own: a cache there is lost without a word.
- macOS's sandbox lets `/var/tmp` be written; Windows has no sandbox.

A user with another place for it says so in `user.bazelrc` (whose links then
have keys of their own, which a shared cache does not serve):

```
# user.bazelrc
common:linux --repo_env=XCLANG_THINLTO_CACHE=/data/xclang-thinlto
common:linux --sandbox_writable_path=/data/xclang-thinlto
```

Keeping it in CI is in [CI](ci.md).

## libclang and the option tables

`@libclang`, `@libclang_asan` and `@llvm_option_inc` are the target
platform's libclang archive, its ASan build and the option tables; see
[libclang](../features/libclang.md#bazel).

## A compilation database

Editors and language servers (clice, clangd) read `compile_commands.json`.
The clice registry has a module for it, `compdb`:

```python
bazel_dep(name = "compdb", version = "0.1.0", dev_dependency = True)
```

```sh
bazel run @compdb//:refresh                         # //...
bazel run @compdb//:refresh -- --config=dev //src/...
```

builds the targets with an aspect that compiles nothing and writes each
compile command as rules_cc's actions have it (C, C++, C++20 module
interfaces and their importers), into `compile_commands.json` in the
workspace, every entry's directory the execution root. Its arguments are a
`bazel build`'s. See the [registry's README](https://github.com/clice-io/bazel#compdb);
its own CI tests it on the six hosts.

## Unreleased builds

An unreleased build is used from where it was unpacked, with
`--repo_env=XCLANG_ROOT=<xclang>` for the toolchain and
`XCLANG_LIBCLANG_ROOT` (`XCLANG_LIBCLANG_ASAN_ROOT`) for the host's
libclang; another target's comes from the release.

## Tested by

- tests/bazel builds and tests with the module on every host (bazel.yml),
  and tests/bazel.ts checks that the actions' keys hold no absolute path,
  for the host and for a target of another OS; that such a build fetches
  nothing but the host's toolchain and the target's libclang; that another
  release rebuilds them; that a `-c dbg` program from another checkout is
  the same bytes and that gdb, lldb and llvm-symbolizer find its lines;
  that the registry's archive of the module gives the same actions; the
  ThinLTO cache; strip; `--features=asan`; and that `git_override` with
  `strip_prefix` builds.
- Every host builds tests/bazel for every other target it can, and a
  machine of that target runs the tests (tests/bazel-cross.ts); from Linux
  x64, kotatsu's tests, from the registry, are built for Windows x64 and run
  there ([23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37345631067)).
- examples.yml builds examples/bazel from bazel.clice.io on every host.
