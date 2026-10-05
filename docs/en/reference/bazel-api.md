# Bazel API

Everything the `xclang` Bazel module offers. How to use it is
[Bazel](../integrations/bazel.md); this page is the list. The module needs
Bazel 9 and rules_cc 0.2.25; it is `packages/bazel` of the repository and is
published to [bazel.clice.io](https://bazel.clice.io) for every release.

## Toolchains

The module registers, for every host, one C++ toolchain per target:
`@xclang//bazel/toolchains:<host>` for the host itself and
`<host>-to-<target>` for the others. Each is the host's archive configured
for the target; only the archive of the machine Bazel runs on is
downloaded. The macOS targets have a toolchain on macOS hosts only;
elsewhere their toolchain fails the build with that reason.

## Platforms

`@xclang//platforms:<triple>`, for `--platforms`:

| platform | also | target |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `x86_64-linux-gnu` | Linux x64, glibc 2.17 |
| `aarch64-unknown-linux-gnu` | `aarch64-linux-gnu` | Linux arm64, glibc 2.17 |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu` | Windows x64, MinGW-w64 (UCRT) |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu` | Windows arm64, MinGW-w64 (UCRT) |
| `aarch64-apple-darwin` | `arm64-apple-darwin` | macOS arm64, from macOS hosts |
| `x86_64-apple-darwin` | | macOS x64, from macOS hosts |

Each has `@platforms//os`, `@platforms//cpu` and a C library,
`@xclang//platforms/libc:glibc`, `:mingw` or `:macosx`. The toolchains ask
a platform for os and cpu only, so a platform of one's own with those
works too.

## Features

| feature | default | |
|---|---|---|
| `asan`, `tsan`, `ubsan`, `lsan` | off | sanitizers, for the whole build (`--features=asan`); `asan` compiles and links with libc++'s ASan build. Not for Windows targets |
| `cpp_modules` | off | C++20 modules: `module_interfaces` of a `cc_library`/`cc_binary`, scanned by clang-scan-deps; needs `--experimental_cpp_modules` |
| `gc_sections` | Linux targets: on in `opt`; Windows targets: off | lld's `--gc-sections` |
| `thinlto_cache` | on | the linker's ThinLTO cache, with flags only when `XCLANG_THINLTO_CACHE` names a directory |
| `generate_dsym_file` | off | macOS targets: the link makes `<name>.dSYM` (output group `dsyms`); `--apple_generate_dsym` turns it on for the build |
| `supports_dynamic_linker` | off | Bazel's dynamic linking of libraries into tests and programs; off, they link statically |
| `release_strip` | on | what `<name>.stripped` does: `--strip-unneeded` for ELF and COFF, `--strip-all` for Mach-O |

A feature is turned on for a build with `--features=<name>`, off with
`--features=-<name>`, and for one target with `features = ["<name>"]` or
`["-<name>"]`.

## Targets and rules

| label | |
|---|---|
| `@xclang//bazel:std` | libc++'s `std` and `std.compat` modules of the target platform, as a library to depend on; built with the build's `--cxxopt` |
| `xclang_debug_symbols(name, binary, gsymutil_args)` in `@xclang//bazel:debug_symbols.bzl` | `<binary>.gsym` for every target, and `<binary>.dSYM` for macOS ones (with `generate_dsym_file` on the `cc_binary`); llvm-gsymutil's output in the output group `gsym_log` |
| `xclang_resource_dir(name, srcs)` in `@xclang//bazel:resource_dir.bzl` | clang's resource directory laid out as `lib/clang/<major>/` in the rule's package, for a program `bin/<name>` of that package; `@libclang`'s by default |

## Repositories

From the module extension, `use_extension("@xclang//bazel:extensions.bzl",
"xclang")`; each is fetched only when a build uses it.

| repository | |
|---|---|
| `@libclang` | the target platform's libclang: `@libclang//:clangBasic`, `:LLVMSupport`, ... with their link interfaces; `:headers`; `:resource_dir`; `:AllTargetsInfos`, `:AllTargetsDescs`, `:AllTargetsAsmParsers`, `:AllTargetsDisassemblers`. With `--features=asan`, the ASan build |
| `@libclang_asan` | the ASan build (Linux x64 and macOS arm64 targets) |
| `@libclang_<triple>` | one target's libclang |
| `@llvm_option_inc` | the option tables of clang, lld, llvm-lib and llvm-dlltool, as a header-only library |

## Environment

Given with `--repo_env=<name>=<value>`:

| variable | |
|---|---|
| `XCLANG_THINLTO_CACHE` | an absolute directory for the linker's ThinLTO cache; the module makes it |
| `XCLANG_ROOT` | an unpacked toolchain of the host to use instead of the release's |
| `XCLANG_LIBCLANG_ROOT`, `XCLANG_LIBCLANG_ASAN_ROOT` | an unpacked libclang (ASan build) of the host to use instead of the release's |
| `BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1` | Bazel's own: turns rules_cc's detection of a local compiler off, recommended |

## The release

`packages/bazel/bazel/versions.bzl` names the release the module
downloads and the sha256 of each of its archives, from the release's
`SHA256SUMS`. The module's version is the release's.
