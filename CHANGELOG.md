# Changelog

What changed for xclang's users in each release. Releases are tagged
`<llvm version>.<revision>`; every one of them has the same assets (the
toolchain, libclang and its ASan build, the option tables, the profile and
`SHA256SUMS`, see [Installing](docs/en/guide/install.md)), and LLVM's source with
the [patches](docs/en/reference/patches.md) of its tag.

## Unreleased

- **Documentation** at [docs.clice.io/xclang](https://docs.clice.io/xclang),
  from [docs/en](docs/en): a guide (what xclang is and when not to use it,
  why it is built the way it is, a quick start, installing, cross-compiling,
  comparisons, FAQ), the integrations, the features, a reference and the
  design, with the evidence for each claim.
- [`examples/`](examples): the projects the docs show (a pixi quick start,
  CMake, CMake with FetchContent, Bazel, Meson, Make), built as written on a
  machine of every host from the published release's channels by
  examples.yml; tests/docs.ts checks that the docs show those files and
  that their links reach pages and headings.

## [23.1.2.6](https://github.com/clice-io/xclang/releases/tag/23.1.2.6) — 2026-10-05

Built by 23.1.2.5.

- **CMake package** ([docs/en/integrations/cmake.md](docs/en/integrations/cmake.md)), in every toolchain
  archive as `lib/cmake/xclang`, and so in the conda package:
  `find_package(xclang)` gives `xclang::std`, libc++'s `std` and
  `std.compat` modules built for the build, so `import std` works without
  CMake's experimental switches (CMake 3.28, Ninja 1.11); `xclang_add_std()`
  makes one for other language options; `toolchain.cmake` makes the tree a
  build's toolchain, for any of its targets with `XCLANG_TARGET`. A build
  without xclang installed fetches this repository's tag with FetchContent,
  and `packages/cmake/xclang.cmake` downloads the host's toolchain, checked
  against the release's `SHA256SUMS`, into the user's cache.
- **ThinLTO link cache**: `XCLANG_THINLTO_CACHE`, an absolute directory,
  makes the links of libclang's bitcode after the first take seconds
  instead of minutes, with the same program: in Bazel,
  `--repo_env=XCLANG_THINLTO_CACHE=<dir>`, the module makes the directory
  and the toolchains' `thinlto_cache` feature passes it to the target's
  linker ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md#speed-up-libclang-links), with the
  `.bazelrc` and CI setup); in CMake, `-DXCLANG_THINLTO_CACHE=<dir>` (or the
  environment variable) before `find_package(xclang)`
  ([docs/en/integrations/cmake.md](docs/en/integrations/cmake.md#speed-up-libclang-links)).
- What users build with is under [`packages/`](packages): the Bazel module
  in `packages/bazel`, the CMake package in `packages/cmake`, the conda
  package's activation scripts in `packages/conda`. The module's labels
  (`@xclang//bazel:std`, ...) are the same and the registry's archive holds
  the same tree; a `git_override` of a commit needs `strip_prefix =
  "packages/bazel"` ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md)).
- **Bazel cross-compiling** ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md#build-for-another-target)):
  the module registers the host's toolchain for every target of its
  archive, and `@xclang//platforms:<triple>` (`x86_64-w64-mingw32`,
  `aarch64-unknown-linux-gnu`, ...) are platforms for them, with a C library
  constraint (`@xclang//platforms/libc`); `bazel build
  --platforms=@xclang//platforms:x86_64-w64-mingw32 //...` builds for Windows
  from Linux with nothing downloaded but the host's toolchain. The macOS
  targets build on macOS hosts only, and say so elsewhere. `@libclang`,
  `@libclang_asan` and `@xclang//bazel:std` are the target platform's; a
  target's libclang is downloaded only by a build for it.
- **Debug symbols** for a program's release, by the toolchain's own
  dsymutil and llvm-gsymutil (names of `llvm` in every archive): GSYM for
  every target, the dSYM for macOS ones. Bazel: `xclang_debug_symbols`
  (`@xclang//bazel:debug_symbols.bzl`), and rules_cc's `generate_dsym_file`
  feature makes a macOS program's dSYM in its link, ThinLTO's code
  included ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md#ship-debug-symbols-and-stripped-programs)); CMake:
  `xclang_debug_symbols(<target>)` ([docs/en/integrations/cmake.md](docs/en/integrations/cmake.md#ship-debug-symbols)).
- **Bazel: debug information that holds wherever the build ran.** Paths
  in it are relative to the execution root (`-ffile-compilation-dir=.`;
  Mach-O debug maps with `-oso_prefix`), and PE programs have no link time,
  so a program is the same bytes from any sandbox or checkout; debuggers
  map `.` to the workspace's `bazel-<workspace>` ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md#debug-in-gdb-lldb-and-vs-code)).
- Bazel: a program's `.stripped` is a release's, by the target's object
  format: ELF and COFF `--strip-unneeded`, Mach-O `--strip-all`, not
  keeping the globals that misname local functions in macOS crash logs
  ([docs/en/features/debugging.md](docs/en/features/debugging.md#strip)).
- Bazel: `@libclang` is the ASan build with `--features=asan`, libraries,
  headers and resource directory together; `xclang_resource_dir` lays the
  resource directory out in `lib/clang` next to a program's `bin/`
  ([docs/en/features/libclang.md](docs/en/features/libclang.md#bazel)).
- libclang: `clang-tidy/clang-tidy-config.h`, as clang-tidy's build
  generates it for xclang's configuration.
- libclang: every target's MC layer (TargetInfo, MC descriptions, assembly
  parser, disassembler), not X86's only, as its headers list: a tool
  registers them all (`InitializeAllTargetInfos()`, `InitializeAllTargetMCs()`,
  `InitializeAllAsmParsers()`, `InitializeAllDisassemblers()`, CMake's
  components of those names) and looks any target up by triple. Bazel:
  `@libclang//:AllTargetsInfos`, `:AllTargetsDescs`, `:AllTargetsAsmParsers`,
  `:AllTargetsDisassemblers`.
- libclang's ASan build is of every target, as the release, with the same
  headers and libraries.
- libclang no longer has Sema's private headers (`TreeTransform.h`,
  `TypeLocBuilder.h`, `CoroutineStmtBuilder.h`), which clice no longer uses.
- Patches: **0009** added, ld64.lld reads the `.tbd` stubs of the macOS 27
  SDK (Xcode 27), which list `arm64e.x1`: macOS programs link against it
  (release/23.x's backport of llvm/llvm-project#222721, in 23.1.3).
- Bazel: the module loads archives without libc++'s ASan build (releases
  before 23.1.2.5) too.
- The README keeps to what xclang is and where it is going; the rest is
  in [docs/](docs). The [roadmap](docs/en/design/roadmap.md) has the targets, their
  tiers and where each stands.

## [23.1.2.5](https://github.com/clice-io/xclang/releases/tag/23.1.2.5) — 2026-10-03

Built by 23.1.2.3.

- **Bazel module** (Bazel 9, rules_cc 0.2.25), published to the clice
  registry, [bazel.clice.io](https://bazel.clice.io): the host's toolchain
  by its sha256 as a hermetic C++ toolchain, `@xclang//bazel:std` for
  `import std`, sanitizer features, libclang (`@libclang`,
  `@libclang_asan`) with the link interfaces of its CMake packages, and the
  option tables (`@llvm_option_inc`) ([docs/en/integrations/bazel.md](docs/en/integrations/bazel.md)).
- **macOS targets link with ld64.lld on macOS too**; before, only Linux and
  Windows hosts did, and macOS used the system's `ld`. `-fuse-ld=ld` still
  selects it, with xclang's `libLTO.dylib`.
- **libc++'s ASan build** for the Linux and macOS targets, in `lib/asan`
  of the target directory (`usr/lib/asan` on Linux): an ASan build
  compiles and links with it (`-isystem <asan>/include`, `-nostdlib++
  <asan>/libc++.a`), and gets `std::string`'s container checks without
  false container-overflow reports. The ASan libclang is built with it.
- Patches: **0007** added, ld64.lld keeps a function's unwind entry when an
  empty section's symbol shares its address, so ThinLTO programs compiled
  and linked by one clang command catch their exceptions on arm64 macOS
  (llvm/llvm-project#225055). **0008** added, `clang -E` writes a raw
  string literal's CRLF line breaks as `\n` and counts its lines, so
  compiling its output gives the same strings and line numbers
  (llvm/llvm-project#122070). **0005** dropped: libc++'s ASan build
  replaces it.

## [23.1.2.4](https://github.com/clice-io/xclang/releases/tag/23.1.2.4) — 2026-09-29

Built by 23.1.2.3; the patches do what 23.1.2.3's did (0004 as sent upstream).

- Windows: `clang++.exe` and the other names of `llvm.exe` start it inside
  their kill-on-close job from the moment it is created. Before, a launcher
  killed while starting it (a build tool's timeout, or its parent's job
  closing) could leave `llvm.exe` suspended, holding its working directory
  and handles.

## [23.1.2.3](https://github.com/clice-io/xclang/releases/tag/23.1.2.3) — 2026-09-27

Built by 23.1.2.2. The first release with [`patches/`](patches):

- **0001**: signature help in a class template whose parameter pack
  follows another parameter no longer crashes clang (clice-io/clice#701,
  llvm/llvm-project#226788).
- **0002**, **0003**: member-access completion hands the consumer an
  unresolved base too, and the base expression as written, for tools that
  resolve dependent types themselves.
- **0004**: a MinGW-built clang, and every tool built on its libraries,
  finds Visual Studio 2017 and later through the Setup API, as an
  MSVC-built clang does (clice-io/clice#714, llvm/llvm-project#226794).
- **0005**: an ASan program no longer shares libc++'s internal functions
  with the uninstrumented `libc++.a`, which gave false container-overflow
  reports (llvm/llvm-project#226789).
- **0006**: `std::format_to` into a string, vector or deque no longer
  writes past its stack buffer after output whose length is a multiple of
  256 (llvm/llvm-project#154670, llvm/llvm-project#226791).

Also:

- A macOS target on a Linux or Windows host links with ld64.lld again;
  23.1.2.2 took the system linker there.
- clang-cl no longer reads the host target's config file, and no longer
  warns about every option in it.
- Config files for `<arch>-pc-linux-gnu` and `<arch>-apple-macosx` too.
- The libclang archives carry compiler-rt's headers, like the toolchain.

## [23.1.2.2](https://github.com/clice-io/xclang/releases/tag/23.1.2.2) — 2026-09-27

Built by 23.1.2.1, the first release built by xclang itself.

- compiler-rt's headers are in clang's resource directory again:
  `<sanitizer/asan_interface.h>`, `<fuzzer/FuzzedDataProvider.h>` and the
  rest.
- clang has no built-in defaults for the C++ library, runtimes and linker;
  the config files choose libc++, compiler-rt, libunwind and lld as before.
  Without them (`--no-default-config`, or libclang's driver inside a tool),
  clang behaves like upstream clang: clice's driver standing in for `g++`
  uses libstdc++.

## [23.1.2.1](https://github.com/clice-io/xclang/releases/tag/23.1.2.1) — 2026-09-26

The first release: LLVM 23.1.2, built by LLVM's own release builds, with
PGO and ThinLTO, for six hosts, each carrying every target.

- Hosts and targets: `x86_64-unknown-linux-gnu`,
  `aarch64-unknown-linux-gnu`, `x86_64-w64-mingw32`, `aarch64-w64-mingw32`,
  `aarch64-apple-darwin`, `x86_64-apple-darwin`; `clang++ --target=<triple>`
  needs nothing else (macOS targets use Xcode's SDK).
- clang and lld are linked statically against xclang's own libc++; the
  Linux toolchain needs glibc 2.17, the macOS one macOS 13.
- Programs link libc++, libc++abi, libunwind and compiler-rt statically.
  Linux targets: glibc 2.17 (`-static` works); Windows targets: mingw-w64
  with UCRT; macOS targets: 13.0.
- compiler-rt: builtins with wide atomics, profile, and for Linux and macOS
  ASan, TSan, LSan, UBSan and libFuzzer.
- GCC's library names (`-latomic`, `-lgcc*`, `-lssp`, `-lstdc++`) and
  `windres` work.
- Windows archives hold no symlinks: every name of `llvm.exe` is a small
  launcher.
- libclang (PGO and ThinLTO bitcode, found by `find_package(Clang)`), its
  ASan build for Linux x64 and macOS arm64, and the option tables.

clice ([clice#712](https://github.com/clice-io/clice/pull/712)) and catter
([catter#154](https://github.com/clice-io/catter/pull/154)) build with it.

From 2026-09-27, every release is a conda package on
[conda.clice.io](https://conda.clice.io), 23.1.2.1 too (build 1): one
`xclang` package per host with every target, under `$PREFIX/opt/xclang`,
and the noarch `llvm-option-inc`.
