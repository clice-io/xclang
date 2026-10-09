# Bazel

xclang is a Bazel module: the C++ toolchain of the host for every target. It
downloads the toolchain by sha256 from the release of the module version,
and libclang and the option tables as repositories. Every release is on the
clice Bazel registry, [bazel.clice.io](https://bazel.clice.io).

Requires: Bazel 9 and rules_cc 0.2.25. Run Bazel through
[bazelisk](https://github.com/bazelbuild/bazelisk), which reads the version
from `.bazelversion`: `npm install -g @bazel/bazelisk`, or `npx bazelisk`
from a devDependency. conda-forge has no bazelisk, and its bazel runs only
with `--batch`.

## Set Up a Project

The project is
[examples/bazel](https://github.com/clice-io/xclang/tree/main/examples/bazel).
`MODULE.bazel` depends on xclang:

<!-- file: examples/bazel/MODULE.bazel -->
```python
module(name = "hello")

bazel_dep(name = "rules_cc", version = "0.2.25")
bazel_dep(name = "xclang", version = "23.1.2.8")
```

The version is the oldest release the project takes: Bazel uses the newest
one that a module of the build asks for
([releases](https://github.com/clice-io/xclang/releases) has the newer
ones). `.bazelrc` adds the registry, and the options `import std` needs:

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

`BUILD.bazel` builds a program that imports `std`:

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

`main.cpp` is the one of the [CMake example](cmake.md#set-up-a-project).

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel run //:hello
```

It prints `hello from xclang: 3 targets, the first linux`. The module
registers its toolchains itself. A library that only builds with xclang
makes the `bazel_dep` a `dev_dependency`.

## On a Windows Host

Put two startup options in `%USERPROFILE%\.bazelrc`, since startup
options have no per-platform form. The first gives a short output root,
because the default one is too deep for Windows paths. The second makes
runfiles symlinks rather than copies.

<!-- excerpt: .github/workflows/examples.yml -->
```
startup --output_user_root=C:/b
startup --windows_enable_symlinks
```

<a id="cross-compiling"></a>

## Build for Another Target

A build for another target names its platform:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-w64-mingw32 //:hello
```

The platforms are listed in the
[Bazel API](../reference/bazel-api.md#platforms). The toolchain is the host
archive configured for the target, so no other archive is downloaded.
`@xclang//bazel:std` and `@libclang` follow the target platform. What the
build runs itself (`cfg = "exec"`) is built for the host. A platform of your
own works too: the toolchains ask only for its os and cpu, and without a C
library constraint, Linux gets glibc and Windows MinGW;
`@xclang//platforms/libc:musl` gets musl.

- **musl targets build static programs**, from 23.1.2.10 on, from every
  host: `--platforms=@xclang//platforms:x86_64-unknown-linux-musl`.
  `bazel test` runs their tests on a Linux host of their architecture.
  There is no libclang for them, and no shared library.

- **The MSVC targets, and macOS targets off macOS, need the vendor's
  SDK**, which the project accepts the license of in its `MODULE.bazel`
  ([below](#vendor-sdks)). Without it, a build for them fails at once and
  says why.
- **One output directory.** Bazel 9 puts the outputs of every platform in
  one directory (`k8-fastbuild`), so changing `--platforms` rebuilds what
  the other platform built. `common --experimental_platform_in_output_dir`
  gives each its own, such as `x86_64-w64-mingw32-fastbuild`.
- **Tests are built, not run.** `bazel test` runs tests on the host, so run
  tests for another target on a machine of that target
  ([CI](ci.md#build-on-one-runner-run-on-another)). `cc_test` builds for any
  target. A test of another rule builds only where an execution platform has
  the os and cpu of the target, or anywhere with
  `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain=false`,
  the former behaviour of Bazel.

<a id="vendor-sdks"></a>

## Build for MSVC, and for macOS Anywhere

The MSVC targets build against Microsoft's CRT, STL and Windows SDK, and
the macOS targets on Linux and Windows hosts against Apple's macOS SDK.
Neither may be redistributed. The module fetches them from the vendor once
the root module accepts the vendor's license, with a tag of its extension
in `MODULE.bazel`:

```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
xclang.windows_sdk(accept_license = True)
xclang.macos_sdk(accept_license = True)
```

<!-- not run: test-bazel.yml's sdk jobs build tests/bazel for these platforms, the license accepted as above -->
```sh
bazel build --platforms=@xclang//platforms:x86_64-pc-windows-msvc //:hello
bazel build --platforms=@xclang//platforms:aarch64-apple-darwin //:hello
```

- **The license is the project's to accept.** Only the root module's tags
  count; a dependency's do nothing. Without `accept_license = True`, a
  build that needs the SDK prints the vendor's terms and stops. Apple's
  terms allow the SDK's use on Apple hardware; building for macOS from
  Linux or Windows with it is the project's decision
  ([vendor SDKs](../design/vendor-sdks.md)).
- **Versions are pinned.** By default the SDKs of `windows-latest` and
  `macos-latest`; `preset = "windows-2022"` takes another GitHub runner
  image's, and `msvc_version`, `sdk_version` (Windows) and `version`
  (macOS) name a version, as `xclang sdk fetch` takes them
  ([the xclang command](../reference/xclang-command.md#versions)).
- **Fetched when first needed.** Each SDK is a repository, the Windows SDK
  one per architecture. Bazel downloads the vendor's packages into its
  repository cache, 310 MB for the MSVC x64 target, 380 MB for arm64 and
  62 MB for macOS, and the toolchain's `xclang` command unpacks them into
  the output base. A build for other targets fetches none. On macOS hosts the
  macOS targets keep Xcode's SDK.
- **Keep them to yourself.** The repository cache holds the vendor's
  packages, and remote execution uploads an action's inputs, the SDK's
  files among them. A shared or public cache of either passes the SDK on;
  a remote cache of outputs alone does not.

The MSVC targets link the hybrid CRT, as the config files have it: the VC
runtime and the C++ library linked in, UCRT from Windows
([Windows](../design/windows.md#msvc-targets)). Their C++ compiles are
C++17 unless `--cxxopt` or `copts` say otherwise, as for the other
targets: clang's own default for them, C++14, is older than libc++ takes
there. Their features:

- `generate_pdb_file`, on with `-c dbg`: the link writes `<name>.pdb`
  (output group `pdb_file`), which names its sources relative to the
  execution root, as the DWARF of the other targets does; the program
  names it without a directory.
- `dynamic_link_msvcrt`: the VC runtime's DLLs (`/MD`), and
  `debug_msvcrt`: the debug CRT (`/MTd`, or `/MDd` with the other).
- `msvc_stl`: Microsoft's STL in place of libc++, for the whole build
  (`--features=msvc_stl`), `@xclang//bazel:std` included, which is then
  the STL's `std` module.
- `gc_sections` is lld-link's `/opt:ref`, off by default as for MinGW.

The macOS targets' deployment target is `--macos_minimum_os`, but never
below 13.0, the oldest macOS xclang's libc++ runs on: Bazel's default is
the SDK's version on macOS hosts, 11.0 elsewhere. Their dSYMs are made on
every host.

A Windows platform is MinGW's unless it has the C library constraint
`@xclang//platforms/libc:msvc`, as `@xclang//platforms:x86_64-pc-windows-msvc`
has. `@libclang` has no build for the MSVC targets: what depends on it is
incompatible with them, and `//...` skips it.

## Use C++20 Modules and `import std`

`@xclang//bazel:std` is the `std` and `std.compat` modules of libc++, as a
library to depend on. The C++ modules of a library are its
`module_interfaces`, with the `cpp_modules` feature:

<!-- excerpt: examples/modules/BUILD.bazel -->
```python
cc_library(
    name = "math",
    features = ["cpp_modules"],
    module_interfaces = [
        "math.cppm",
        "math-ops.cppm",
    ],
    deps = ["@xclang//bazel:std"],
)
```

`std` is built with the `--cxxopt` of the build. clang refuses a module
file built with other language options than its importer's. So put
`-std`, `-fno-exceptions` and `-fno-rtti` in `--cxxopt`, not in the
`copts` of one Bazel target ([C++20 modules](../features/modules.md#bazel)).

## Use Sanitizers

The sanitizers are features of the whole build: `--features=asan`,
`tsan`, `ubsan` or `lsan`. `asan` compiles and links with the ASan libc++
([sanitizers](../features/sanitizers.md#bazel)). The MinGW targets have no
sanitizers. The MSVC targets have `ubsan`, and x64 also has `asan`. ASan's
runtime there is a DLL, which a program finds beside itself or on `PATH`
([MSVC targets](../features/sanitizers.md#msvc-targets)).

## Debug in gdb, lldb and VS Code

Every path in the debug information is relative to the execution root
([paths in debug information](../features/debugging.md#paths-in-debug-information)).
A debugger needs one mapping, from `.` to the `bazel-<workspace>` link of
the workspace, where `<workspace>` is the name of its directory. That link
holds the sources of the workspace, and under `external/` those of the other
repositories.

```
# gdb, in ~/.gdbinit or the session
directory /path/to/workspace/bazel-workspace
# lldb, in ~/.lldbinit or the session
settings set target.source-map . /path/to/workspace/bazel-workspace
```

In VS Code, CodeLLDB takes a `sourceMap` in `launch.json`:

```json
"sourceMap": { ".": "${workspaceFolder}/bazel-workspace" }
```

The C/C++ extension with gdb takes `setupCommands`:

```json
"setupCommands": [{ "text": "directory ${workspaceFolder}/bazel-workspace" }]
```

On macOS, lldb reads the dSYM of a program from anywhere. Without one, it
reads the objects that the debug map names, relative to its working
directory. Run it in the workspace, whose `bazel-out` link holds them.

## Ship Debug Symbols and Stripped Programs

`xclang_debug_symbols` makes GSYM for every target, and the
`generate_dsym_file` feature makes the dSYM of a macOS target in the link:

<!-- excerpt: examples/debug-symbols/BUILD.bazel -->
```python
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

<!-- excerpt: .github/workflows/examples.yml -->
```sh
bazel build --strip=never //:tool_symbols //:tool.stripped
```

- `bazel-bin/tool.gsym` is the GSYM. llvm-gsymutil runs on the host, also
  for another target, with one thread, so the same program makes the same
  file. Its warnings go to `tool.gsym.log`, in the output group
  `gsym_log`. `bazel run @xclang//bazel:llvm-gsymutil -- <absolute path of
  the .gsym> --address=0x<address>` reads it.
- `bazel-bin/tool.dSYM`, for a macOS target, is in the output group
  `dsyms`. `--apple_generate_dsym` turns the feature on for the whole
  build. It is made on every host.
- For an MSVC target, `tool_symbols` is `bazel-bin/tool.pdb`, of the
  link with `generate_pdb_file`: llvm-gsymutil does not read PDBs.
- `bazel-bin/tool.stripped` is the program to ship, stripped by object
  format ([strip](../features/debugging.md#strip)).

The fastbuild mode strips debug information unless `--strip=never` is
given. `gsymutil_args = ["--merged-functions"]` keeps every name of the
functions that identical code folding merged.

## Speed Up libclang Links

Name one cache directory per OS in the `.bazelrc` of the project:

<!-- excerpt: examples/libclang/.bazelrc -->
```
common:linux --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:linux --sandbox_writable_path=/var/tmp/xclang-thinlto
common:macos --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:windows --repo_env=XCLANG_THINLTO_CACHE=C:/xclang-thinlto
try-import %workspace%/user.bazelrc
```

- The module makes the directory, and the `thinlto_cache` feature of the
  toolchains passes it to the linker. A link after the first takes
  seconds.
- The path is part of the key of every link, so keep it the same on every
  machine. Do not put it under `/tmp`
  ([why one fixed path](../features/thinlto-cache.md#why-one-fixed-path)).

## Link libclang

`@libclang` is the libclang of the target platform, and `@llvm_option_inc`
the option tables. Take them from the module extension in `MODULE.bazel`:

<!-- excerpt: examples/libclang/MODULE.bazel -->
```python
xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
use_repo(xclang, "libclang", "llvm_option_inc")
```

A tool names the libraries it uses, such as `@libclang//:clangBasic`
([libclang](../features/libclang.md#bazel)).

## Generate compile_commands.json

Editors and language servers, such as clice and clangd, read
`compile_commands.json`. The clice registry has a module for it, `compdb`:

```python
bazel_dep(name = "compdb", version = "0.1.0", dev_dependency = True)
```

<!-- not run: compdb's own CI, in the registry, runs it on the six hosts -->
```sh
bazel run @compdb//:refresh
bazel run @compdb//:refresh -- //:hello
```

Without arguments, it covers `//...`; with them, the given Bazel targets.
It builds them with an aspect that compiles nothing.

It writes each compile command into `compile_commands.json` in the
workspace, as the actions of rules_cc have it: C, C++, C++20 module
interfaces and their importers. The directory of every entry is the
execution root. The arguments are those of a `bazel build`, such as
`--config=dev //src/...`. See the
[README of the registry](https://github.com/clice-io/bazel#compdb); the CI
of the registry tests it on the six hosts.

## Use a Commit or an Unpacked Toolchain

A commit of this repository works through `git_override`. The module is
the `packages/bazel` directory, and the `packages/bazel/bazel/versions.bzl`
of the commit names the release it downloads:

```python
bazel_dep(name = "xclang", version = "23.1.2.8")
git_override(
    module_name = "xclang",
    remote = "https://github.com/clice-io/xclang",
    commit = "<commit>",
    strip_prefix = "packages/bazel",
)
```

A toolchain that is not a release, such as a CI build, is used from where it
was unpacked. `--repo_env=XCLANG_ROOT=<dir>` names the toolchain, and
`XCLANG_LIBCLANG_ROOT` or `XCLANG_LIBCLANG_ASAN_ROOT` the host libclang.
Another target's libclang comes from the release.

## Troubleshooting

- **Paths too long on Windows**: set the short output root
  ([on a Windows host](#on-a-windows-host)).
- **`'Windows.h' file not found`** when building for the MinGW targets
  from Linux or macOS: include Windows headers in lower case
  ([case-sensitive headers](../design/windows.md#case-sensitive-headers)).
  The MSVC targets' SDK has links for Windows' spellings.
- **A build for an MSVC target, or for macOS off macOS, fails at once,
  naming `xclang.windows_sdk` or `xclang.macos_sdk`**: the root module
  needs the tag ([vendor SDKs](#vendor-sdks)).
- **Test registrations disappear in Windows release builds**: leave
  `gc_sections` off for them
  ([why](../design/windows.md#gc-sections-and-static-initializers)).
- **The ThinLTO cache does nothing on Linux**: the directory is under
  `/tmp`, or lacks `--sandbox_writable_path`.
- More symptoms are in the [FAQ](../guide/faq.md).

## Not Yet Supported

| | status |
|---|---|
| [MSVC-ABI targets in the module](../design/roadmap.md#msvc-bazel) | Unreleased |
| [macOS targets from Linux or Windows in the module](../design/roadmap.md#macos-any-host-bazel) | Unreleased |
| [Fetched targets](../design/roadmap.md#fetched-targets-in-build-systems) in the module | Planned |
| [Sanitizer features for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |

## Known Limitations

- C++20 modules need `--experimental_cpp_modules`, and header units are not
  built.
- Bazel runs Windows actions without a sandbox by default, so an
  undeclared input goes unnoticed there. The Linux and macOS builds
  enforce the declarations.
- On macOS hosts, the macOS SDK is Xcode's, the one `xcrun` finds, and
  the sanitizer features link the absolute path of the toolchain. Only
  those links depend on the checkout.

## See Also

- [Bazel API](../reference/bazel-api.md): every rule, feature, platform
  and repository.
- [The Bazel module](../design/bazel-module.md): why the module is built
  the way it is.
- [CI](ci.md): caches and runners.
