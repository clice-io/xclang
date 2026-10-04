# Bazel

xclang is a Bazel module too (Bazel 9, rules_cc 0.2.25): the C++ toolchain
of the host, downloaded from the release of the module's version by its
sha256, with libclang and the option tables as repositories. Every release
is published to the clice Bazel registry,
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

A commit of this repository works too, through `git_override`: its
`bazel/versions.bzl` names the release it downloads. The module registers
its toolchains itself, and a library that only builds with xclang makes the
`bazel_dep` a `dev_dependency`. Also in `.bazelrc`:

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

## libclang and the option tables

`@libclang`, `@libclang_asan` and `@llvm_option_inc` are the libclang
archive, its ASan build and the option tables; see
[libclang](libclang.md#bazel).

## Unreleased builds

An unreleased build is used from where it was unpacked, with
`--repo_env=XCLANG_ROOT=<xclang>` for the toolchain and
`XCLANG_LIBCLANG_ROOT` (`XCLANG_LIBCLANG_ASAN_ROOT`) for libclang.

tests/bazel builds and tests with the module on every host (bazel.yml),
and tests/bazel.ts checks that the actions' keys hold no absolute path and
that another release rebuilds them.
