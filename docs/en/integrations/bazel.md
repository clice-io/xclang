# Bazel

xclang is a Bazel module on the clice registry ([bazel.clice.io](https://bazel.clice.io)) that registers the host's C++ toolchain for every target, and provides repositories for `libclang` and the LLVM option tables.

Requires: Bazel 9 and `rules_cc` 0.2.25 or later. Run Bazel through [bazelisk](https://github.com/bazelbuild/bazelisk), which reads the version from `.bazelversion`: `npm install -g @bazel/bazelisk`, or `npx bazelisk` from a `devDependency`. conda-forge has no `bazelisk`, and its `bazel` package runs only with `--batch`.

## Set Up a Project

Add `rules_cc` and `xclang` to `MODULE.bazel`, and configure the clice registry and C++20 module flags in `.bazelrc`. The project is [examples/bazel](https://github.com/clice-io/xclang/tree/main/examples/bazel):

<!-- file: examples/bazel/MODULE.bazel -->
```python
module(name = "hello")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.5.1")
```

The `version` in `bazel_dep` is the oldest release the project requires; Bazel selects the newest version requested across the dependency graph ([versions](../reference/releases.md#versions)). `.bazelrc` adds the registry and the flags needed for `import std`:

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

`BUILD.bazel` builds a binary that imports `std`:

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

`main.cpp` is the same file as in the [CMake example](cmake.md#set-up-a-project).

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:hello
```

It prints `hello from xclang: 3 targets, the first linux`. The module registers its toolchains itself. Bazel evaluates toolchains in `bazel_dep` order, so `.bazelrc` disables `rules_cc`'s local compiler detection (`BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1`), and a project that lists `apple_support` before `xclang` also sets `--repo_env=BAZEL_NO_APPLE_CPP_TOOLCHAIN=1` ([Bazel API](../reference/bazel-api.md)). A library module that uses `xclang` only for its own development and tests marks the `bazel_dep` with `dev_dependency = True`.

## On a Windows Host

Put two `startup` options in `%USERPROFILE%\.bazelrc`, since `startup` options have no per-platform form. The first sets a short output root because the default path is too deep for Windows path limits; the second creates symlink runfiles instead of file copies:

<!-- excerpt: .github/workflows/examples.yml -->
```
startup --output_user_root=C:/b
startup --windows_enable_symlinks
```

Bazel runs actions on Windows without a sandbox, so an action may read a
file it does not declare there; the Linux and macOS builds of the same
targets check the declarations.

## Build for Another Target

Pass `--platforms=@xclang//platforms:<target>` to build for another target:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:hello
```

The ten target platforms are listed in the [Bazel API](../reference/bazel-api.md) and in [Cross-Compiling](../guide/cross-compiling.md#targets-and-hosts). Cross-compiling uses the host's toolchain archive configured for the target, so Bazel downloads no second toolchain archive. `@xclang//bazel:std` and `@libclang` follow the target platform automatically, while tools built in the exec configuration (`cfg = "exec"`) build for the host. You can also define your own `platform` target: the toolchains match on OS and CPU, and without a C library constraint Linux selects `glibc` and Windows selects MinGW; add `@xclang//platforms/libc:musl` for musl or `@xclang//platforms/libc:msvc` for MSVC.

- **musl targets**: `--platforms=@xclang//platforms:x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` build static programs from any host ([musl targets](../guide/cross-compiling.md#musl-targets)). On a Linux host of the same architecture, `bazel test` runs their tests directly.
- **MSVC targets, and macOS targets off macOS**: require accepting the vendor's license in the root `MODULE.bazel` ([below](#build-for-msvc-and-for-macos-anywhere)). Without the tag, a build for them fails immediately and says what to add.
- **One output directory by default**: Bazel 9 writes outputs for different platforms into the same CPU output directory (`k8-fastbuild`), so switching `--platforms` overwrites previous outputs. Add `common --experimental_platform_in_output_dir` to `.bazelrc` to give each platform its own directory, such as `x86_64-w64-mingw32-fastbuild`.
- **Building tests for another target**: `bazel test` runs tests on the host, so run cross-compiled tests on a machine of the target ([CI](ci.md#build-on-one-runner-run-on-another)). `cc_test` builds for any target platform; other test rules build only when an execution platform matches the target's OS and CPU, or anywhere with `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain=false`.


## Build for MSVC, and for macOS Anywhere

Add `xclang.windows_sdk` and `xclang.macos_sdk` to the root `MODULE.bazel` to accept the vendor's license and let the module extension fetch Microsoft's CRT and Windows SDK ([MSVC targets](../guide/cross-compiling.md#msvc-targets)) and Apple's macOS SDK ([macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)):

```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
xclang.windows_sdk(accept_license = True)
xclang.macos_sdk(accept_license = True)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-pc-windows-msvc //:hello
bazel build --platforms=@xclang//platforms:aarch64-apple-darwin //:hello
```

- **Root module only**: Only tags in the root module take effect; tags in dependencies are ignored. Without `accept_license = True`, a build that needs the SDK prints the vendor's terms and stops ([vendor SDKs](../guide/cross-compiling.md#vendor-sdks)).
- **Pinned versions**: By default the extension uses the `windows-latest` and `macos-latest` presets. Pass `preset = "windows-2022"` for another runner preset, or pass `msvc_version` and `sdk_version` (Windows) and `version` (macOS) to pin specific versions ([presets, versions and `latest`](../guide/cross-compiling.md#presets-and-versions), [Bazel API](../reference/bazel-api.md)).
- **Fetched when first needed**: Each SDK is a separate repository (`xclang_windows_sdk_x86_64`, `xclang_windows_sdk_aarch64`, `xclang_macos_sdk`). Bazel downloads the vendor packages into its repository cache only when a build targets that platform, and the toolchain's `xclang` command unpacks them into the output base. On macOS hosts, macOS targets use Xcode's SDK instead. When Apple has withdrawn a pinned macOS package, `xclang` locates the replacement package by content digest and downloads it directly ([packages Apple withdraws](../design/macos.md#packages-apple-withdraws-and-content-digests)).
- **Do not share vendor SDK caches publicly**: The repository cache holds the vendor's archives, and remote execution uploads action inputs including SDK files. Do not expose a shared or public repository cache or remote execution cache containing them; a remote cache of action outputs alone does not distribute the SDK.

For MSVC targets, C++ compiles default to `-std=c++17` (unless `--cxxopt` or `copts` specify a standard) and link the [hybrid CRT](../guide/cross-compiling.md#msvc-targets). Their toolchain features are:

- `generate_pdb_file` (on by default with `-c dbg`): writes `<name>.pdb` (output group `pdb_file`) with source paths relative to the execution root, and embeds only the filename in the binary.
- `dynamic_link_msvcrt`: links the VC runtime DLLs (`/MD`).
- `debug_msvcrt`: links the debug CRT (`/MTd`, or `/MDd` with `dynamic_link_msvcrt`).
- `gc_sections`: passes `/opt:ref` to `lld-link` (off by default, as on MinGW).

`@libclang` has no prebuilt archive for MSVC targets, so targets that depend on `@libclang` are marked incompatible with MSVC platforms and skipped by `//...`.

For macOS targets, the deployment target is `--macos_minimum_os`, clamped to at least `13.0` ([macOS](../guide/cross-compiling.md#stdlib-platform-and-the-deployment-target)). Unlike `rules_cc`'s built-in macOS toolchain, xclang's toolchain does not pass `-fobjc-link-runtime` on every link, so C++ programs link only the frameworks they and their dependencies name. A library that uses CoreFoundation names `linkopts = ["-Wl,-framework,CoreFoundation"]`; for dependencies that omit it, the `macos_default_link_flags` feature restores `-fobjc-link-runtime`.

`--@xclang//bazel:stdlib=platform` builds against the [platform's C++ library](../guide/cross-compiling.md#the-platform-s-c-library) instead of xclang's `libc++`: Microsoft's STL for MSVC targets (where `@xclang//bazel:std` builds the STL's module) and the SDK's `/usr/lib/libc++.1.dylib` for macOS targets (where `@xclang//bazel:std` is unavailable). Linux, musl and MinGW targets reject the flag because their platform `libstdc++` is outside the toolchain.


## Features

- **C++20 modules and `import std`**: Depend on `@xclang//bazel:std` for `import std`, and list module interfaces in `module_interfaces` with `features = ["cpp_modules"]` ([C++20 Modules](../features/modules.md#bazel)).
- **Sanitizers**: Pass `--features=asan`, `ubsan`, `tsan`, `lsan` or `msan` to instrument the build and link the matching runtime ([Sanitizers](../features/sanitizers.md#bazel)).
- **Runtimes from source**: Pass `--@xclang//runtimes:source` to compile `libc++`, `libc++abi` and `libunwind` from the toolchain's sources with hardening modes, custom ABI options, no exceptions or RTTI, or MemorySanitizer ([Runtimes from Source](../features/runtimes-from-source.md#bazel)).
- **Debugging, GSYM, dSYM and stripping**: Map `.` to `bazel-<workspace>` in gdb, lldb or VS Code ([debug in gdb, lldb and VS Code](../features/debugging.md#debug-in-gdb-lldb-and-vs-code)), and use `xclang_debug_symbols`, `generate_dsym_file` and `<binary>.stripped` to ship debug symbols and stripped binaries ([Debugging](../features/debugging.md#bazel)).
- **libclang and the ThinLTO cache**: Load `libclang` and `llvm_option_inc` from the `xclang` module extension, and set `--repo_env=XCLANG_THINLTO_CACHE=<dir>` (with `--sandbox_writable_path=<dir>` on Linux) to cache ThinLTO links ([libclang](../features/libclang.md#bazel), [the ThinLTO cache](../features/libclang.md#the-thinlto-cache)).

## Generate compile_commands.json

Add the `compdb` module from the clice registry to generate `compile_commands.json` for editors and language servers such as clice and clangd:

```python
bazel_dep(name = "compdb", version = "0.1.0", dev_dependency = True)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run @compdb//:refresh
bazel run @compdb//:refresh -- //:hello
```

Without arguments, `@compdb//:refresh` covers `//...`; with arguments, it accepts `bazel build` flags and target patterns such as `--config=dev //src/...`. It evaluates an aspect that compiles nothing and writes `compile_commands.json` in the workspace root, with the execution root as `directory`, covering C, C++, C++20 module interfaces and their importers. See the [registry README](https://github.com/clice-io/bazel#compdb).

## Use a Commit or an Unpacked Toolchain

Use `git_override` with `strip_prefix = "packages/bazel"` to test a commit of this repository; `packages/bazel/bazel/versions.bzl` in that commit names the release archives it downloads (`main` tracks the newest release):

```python
bazel_dep(name = "xclang", version = "23.1.2.8")
git_override(
    module_name = "xclang",
    remote = "https://github.com/clice-io/xclang",
    commit = "<commit>",
    strip_prefix = "packages/bazel",
)
```

To use a locally unpacked toolchain archive such as a CI build, pass `--repo_env=XCLANG_ROOT=<dir>`, and `XCLANG_LIBCLANG_ROOT` or `XCLANG_LIBCLANG_ASAN_ROOT` for an unpacked host `libclang`. Cross-compiled targets still download their `libclang` archive from the release.
