# Bazel

xclang is a Bazel module too (Bazel 9, rules_cc 0.2.25): the C++ toolchain
of the host for each of its targets, downloaded from the release of the
module's version by its sha256, with libclang and the option tables as
repositories. Every release is published to the clice Bazel registry,
[bazel.clice.io](https://github.com/clice-io/bazel):

```
# .bazelrc
common --registry=https://bazel.clice.io/
common --registry=https://bcr.bazel.build/
```

```starlark
# MODULE.bazel
bazel_dep(name = "xclang", version = "23.1.2.5")

# Only to link libclang or include the option tables.
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

A commit of this repository works too, through `git_override`. The module
is the repository's `packages/bazel` directory, and the commit's
`packages/bazel/bazel/versions.bzl` names the release it downloads:

```starlark
bazel_dep(name = "xclang", version = "23.1.2.5")
git_override(
    module_name = "xclang",
    remote = "https://github.com/clice-io/xclang",
    commit = "<commit>",
    strip_prefix = "packages/bazel",
)
```

Older commits (the tags up to 23.1.2.5) have the module at the top of the
repository, and no `strip_prefix`.

The module registers its toolchains itself, and a library that only builds
with xclang makes the `bazel_dep` a `dev_dependency`. Also in `.bazelrc`:

```
common --enable_platform_specific_config
# The C++ toolchain is xclang's; rules_cc's detection of another is off.
common --repo_env=BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1
# C++20 modules: module_interfaces with features = ["cpp_modules"].
common --experimental_cpp_modules
common:windows --enable_runfiles
```

and on Windows, in `%USERPROFILE%\.bazelrc` (startup options have no
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

## What the toolchain does

- **Hermetic.** Every file of the toolchain an action reads is one of its
  inputs, so another release builds anew, and no path on a command line is
  absolute: a disk or remote cache serves every checkout. The one input from
  the machine is the macOS SDK, which `xcrun` finds; `--macos_minimum_os`
  sets the deployment target.
- **Static.** Libraries link into tests and programs statically: libc++ is
  in every shared object on its own, so memory one shared library allocates
  another would free. `cc_binary(linkshared = True)` still makes one
  (`libfoo.so`, `libfoo.dylib`, `foo.dll`); `features =
  ["supports_dynamic_linker"]` gives a target Bazel's dynamic linking back.
- **Windows** programs are MinGW ones, named `.exe`, with `.dll` shared
  libraries.
- Optimized builds link with lld's `--gc-sections` (the `gc_sections`
  feature) for Linux, not for Windows, where it drops static initializers in
  COMDAT sections: `--features=gc_sections` or `features = ["gc_sections"]`
  turns it on where nothing relies on them, `-gc_sections` off.
- **C++20 modules**: `module_interfaces` with `features = ["cpp_modules"]`,
  scanned by clang-scan-deps; module files hold paths relative to the
  execution root, so they are the same wherever they are built. `import
  std` and `import std.compat` come from `@xclang//bazel:std`, libc++'s
  modules built for the target as a library to depend on. It is built with
  the build's flags (`--cxxopt`): clang refuses a module file built with
  other language options (`-std`, `-fno-exceptions`, `-fno-rtti`, ...), so
  those of its importers go there, not in their `copts`; macros, include
  paths and optimization may differ.
- Other repositories' headers are system headers (`-isystem`), whose
  warnings are not the build's; `__DATE__` and `__TIME__` are redacted.
- **Sanitizers** are features: `--features=asan` (or `tsan`, `ubsan`,
  `lsan`), for the whole build: asan compiles and links with libc++'s ASan
  build, which every library of the program must share. On macOS, where
  the sanitizers' runtimes are shared libraries, the feature links in the
  absolute path of the toolchain's: those links alone depend on the
  checkout.

```starlark
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
([roadmap](roadmap.md)).

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
  Windows only, whose file names ignore case.

## libclang and the option tables

`@libclang`, `@libclang_asan` and `@llvm_option_inc` are the target
platform's libclang archive, its ASan build and the option tables; see
[libclang](libclang.md#bazel).

## Unreleased builds

An unreleased build is used from where it was unpacked, with
`--repo_env=XCLANG_ROOT=<xclang>` for the toolchain and
`XCLANG_LIBCLANG_ROOT` (`XCLANG_LIBCLANG_ASAN_ROOT`) for the host's
libclang; another target's comes from the release.

tests/bazel builds and tests with the module on every host (bazel.yml),
and tests/bazel.ts checks that the actions' keys hold no absolute path, for
the host and for a target of another os, that such a build fetches nothing
but the host's toolchain and the target's libclang, that another release
rebuilds them, that the registry's archive of the module gives the same
actions, and that `git_override` with `strip_prefix` builds. Every host also
builds tests/bazel for every other target it can, and a machine of that
target runs the tests (tests/bazel-cross.ts); from Linux x64, kotatsu's
tests, from the registry, are built for Windows x64 and run there.
