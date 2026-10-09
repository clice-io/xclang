# Changelog

What changed for xclang's users in each release. Releases are tagged
`<llvm version>.<revision>`; every one of them has the same assets (the
toolchain, libclang and its ASan build, the option tables, the profile and
`SHA256SUMS`, see [Installing](docs/en/guide/install.md)), and LLVM's source with
the [patches](docs/en/reference/patches.md) of its tag.

## Unreleased

## [23.1.2.10](https://github.com/clice-io/xclang/releases/tag/23.1.2.10) — 2026-10-09

Built by 23.1.2.6.

- **libc++ is the C++ library of the MSVC targets**, as of every other
  target, `import std` included; until 23.1.2.9 it was Microsoft's STL.
  This breaks code that passes C++ types to or from libraries built with
  MSVC (or with the STL), whose ABI is the STL's: `-stdlib=platform`
  (clang-cl: `/clang:-stdlib=platform`, CMake: `-DXCLANG_MSVC_STL=ON`)
  selects the STL again. C interfaces are not affected. libc++ is static,
  on Microsoft's vcruntime (exceptions, RTTI) and UCRT, with the hybrid CRT
  as before: a program still loads only Windows' DLLs. One build serves
  every C runtime (`/MT`, `/MD`, `/MTd`, `/MDd`); for x64 there is its ASan
  build too. clang's default standard for MSVC targets stays C++14, where
  libc++ has none of the C++17 library the STL offers early
  (`std::is_integral_v`): build with `-std=c++17` or later
  ([MSVC targets](docs/en/integrations/clang.md#msvc-targets),
  [Windows](docs/en/design/windows.md#msvc-targets)).
- **0015** added: clang's MSVC toolchain takes `-stdlib=libc++` (libc++
  installed with the compiler, or the directories of `-stdlib++-isystem`)
  and `-stdlib=platform` (Microsoft's STL). **0016** added: libc++ on
  vcruntime no longer defines `std::nothrow`, which the C runtime does,
  and has `std::set_new_handler` and `std::get_new_handler`. **0011**
  added: a config file's `/clang:` options are not reported unused by
  clang-cl ([patches](docs/en/reference/patches.md)).
- The MSVC targets' config files define `_STATIC_INLINE_UCRT_FUNCTIONS=0`,
  MSVC 19.50's default: UCRT's inline functions (`ctime`, ...) have
  external linkage, which a module needs to export them.
- **musl targets**, `x86_64-unknown-linux-musl` and
  `aarch64-unknown-linux-musl`, in every toolchain archive: static programs
  with no program interpreter and no shared library, which take nothing
  from the system they run on
  ([musl targets](docs/en/reference/targets.md#musl-targets)). musl 1.2.6
  with the patches of its security advisories and Linux 6.18's UAPI
  headers, built by xclang; libc++, libc++abi, libunwind, compiler-rt and
  `import std` as for the other Linux targets; of the sanitizers UBSan, as
  the others need dynamic linking. `-static` by default, `-static-pie` on
  request. The CMake package (`XCLANG_TARGET`), the Bazel module
  (`@xclang//platforms:<arch>-unknown-linux-musl`,
  `@xclang//platforms/libc:musl`) and cargo
  ([Rust's musl targets](docs/en/integrations/cargo.md#static-programs-with-musl))
  build them. They add 0.6 to 2.1 MB to an archive, and 42 MB unpacked.
  `xclang target list` names them as built in.
- **Bazel: the MSVC targets, and the macOS targets from Linux and
  Windows hosts.** The root module accepts the vendor's license with a
  tag of the extension, `xclang.windows_sdk(accept_license = True)` and
  `xclang.macos_sdk(accept_license = True)`, and the module fetches the
  SDK when a build first needs it: Bazel downloads the vendor's packages
  into its repository cache, and the toolchain's `xclang` command unpacks
  them into the output base, nowhere else. The platforms
  `@xclang//platforms:x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`
  have the C library `@xclang//platforms/libc:msvc`, which their
  toolchains ask for: a Windows platform without it stays MinGW's. Their
  features: `generate_pdb_file` (on with `-c dbg`; the PDB names its
  sources relative to the execution root), `dynamic_link_msvcrt`,
  `debug_msvcrt` and `msvc_stl`, Microsoft's STL for the whole build,
  which `@xclang//bazel:std` follows, and the sanitizers `ubsan` and, for
  x64, `asan`, with the ASan libc++; `xclang_debug_symbols` gives their
  PDB. The macOS targets make their dSYM on every host
  ([Bazel](docs/en/integrations/bazel.md#vendor-sdks)).
- `xclang sdk packages macos|windows [--json]`: what `xclang sdk fetch`
  downloads, for a build system that downloads it itself and has fetch
  take it from `--cache`
  ([the xclang command](docs/en/reference/xclang-command.md#vendor-sdks)).
- The repository's layout: what builds the toolchain is under
  `toolchain/` (its scripts, the CMake caches, the config files'
  templates, the PGO training, the Windows launcher, license texts), the
  scripts of the Bazel module and the conda packages are beside them in
  `packages/`, and the xclang command's build script is in `cli/`. What a
  project takes from the repository has not moved: `packages/bazel` for
  `git_override`, `packages/cmake` for FetchContent.
- Patches: **0010** added, crash stack traces on arm64 Windows go past
  the frames of system DLLs, which sign their return addresses: a crash in
  a `qsort` comparator shows the code that sorted, `sys::PrintStackTrace`
  in a signal handler reaches the crash, and a trace ends at
  `ntdll!RtlUserThreadStart`, in clang, lld and tools on libclang
  (llvm/llvm-project#229371).
- macOS: a crash trace of the toolchain's clang or lld no longer names its
  frames after unrelated functions. `llvm` kept 632 weak definitions,
  which a macOS program exports and strip leaves, and `llvm-symbolizer`
  and `dladdr` named each frame after the nearest of them; now it exports
  nothing and keeps no symbols, and its frames are addresses, as on Linux
  and Windows. LLVM's `__crashreporter_info__` is gone with them: macOS
  crash reports of clang and lld no longer carry its "Application Specific
  Information".
- Bazel: an optimized macOS program exports nothing
  (`-Wl,-no_exported_symbols`, the `no_exported_symbols` feature, on by
  default). A C++ program exported its weak definitions, which
  `--strip-all` leaves for dyld, and a crash log named its frames after
  them. A program whose plugins bind to its symbols turns the feature off
  ([strip](docs/en/features/debugging.md#strip)).
- Bazel: a C++20 module interface's file embeds its sources
  (`-Xclang -fmodules-embed-all-files`, the `modules_embed_all_files`
  feature, on by default). An importer compiled with `-g` reads them, and
  in the sandbox it had the module file but not the source: at `-c opt -g`
  a primary interface importing its partition stopped at "cannot open
  file".
- Patches: **0012** added, clang links MSVC targets with xclang's
  compiler-rt ahead of Visual Studio's own `clang_rt.*.lib`: on a Windows
  host without a fetched SDK, `__int128` division, UBSan and libFuzzer
  link. **0013** added, the `pc` spellings of the Linux and MinGW targets
  (`--target=x86_64-pc-linux-gnu`, GCC's, and `x86_64-pc-windows-gnu`),
  which read config files of their own, find compiler-rt and link.
- Patches: **0014** added, COFF objects for MinGW targets have no compile
  time in their header again: since LLVM 23 clang wrote it for every
  target, so the same source gave another object on every compile
  (llvm/llvm-project#222099, upstream's fix). MSVC targets keep it, as
  `link.exe /INCREMENTAL` wants; `/Brepro` drops it there.
- `clang --version` and LLVM's `VCSRevision.h` name LLVM's release commit
  (`https://github.com/llvm/llvm-project 85ac5602…`), not the commit of
  xclang's checkout, and a rebuild of a revision with its profile gives the
  same archives again, but for the Windows hosts' `llvm.exe`
  ([reproducible builds](docs/en/design/roadmap.md#reproducible-builds)):
  the runtimes for Windows carry no compile or link time.
- Patches: **0017** added, lld-link lays out a program the same way on
  every link: with a call graph profile (PGO), local functions of the same
  name in several objects, such as `static` ones, went where a walk in
  the order of memory addresses put them, so the same objects linked to
  another program now and then (clice's `clice.exe`: three layouts in six
  links).

## [23.1.2.9](https://github.com/clice-io/xclang/releases/tag/23.1.2.9) — 2026-10-06

The compiler and runtimes are 23.1.2.7's.

- The newest release without naming it: `xclang = "*"` in a pixi
  workspace, the toolchain and libclang from `releases/latest` (whose
  `SHA256SUMS` names the version), and `GIT_TAG latest` for CMake's
  FetchContent, a branch at the tag of the newest release
  ([installing](docs/en/guide/install.md), [versions](docs/en/reference/releases.md#versions)).
  The docs and `examples/` use these; a release's version keeps it. The
  Bazel module's version stays the oldest release a project takes.
- MSVC targets without a fetched SDK: the config files load, where every
  compile for `*-pc-windows-msvc` stopped at loading them, also one that
  needs no SDK (`-ffreestanding`, a tool's queries of the compiler). On
  Windows, clang and clang-cl then find Visual Studio as upstream clang
  does, and so does the CMake package; on Linux and macOS a compile stops
  at the first header of Microsoft's it includes. They read the SDK in use
  through `bin/<target>-sdk.cfg`, which `xclang sdk fetch`, `use` and
  `remove` write, for the architectures it has.
- Bazel on Linux and macOS: a library's objects are linked as they are,
  between `--start-lib` and `--end-lib`, not from its archive. On macOS,
  objects of one name in a library (a module's `foo.cppm` and `foo.cpp`,
  or `a/foo.cpp` and `b/foo.cpp`) had the DWARF of only one of them in the
  dSYM: dsymutil tells archive members apart by name and time, and
  Bazel's times are 0.

## [23.1.2.8](https://github.com/clice-io/xclang/releases/tag/23.1.2.8) — 2026-10-06

The compiler and runtimes are 23.1.2.7's.

- Bazel on macOS: a C++20 module unit and its dependency scan get the
  `defines` of the libraries it depends on, as on Linux and Windows. They
  got none: rules_cc leaves macOS the legacy defines feature, which does
  not cover the module actions.

## [23.1.2.7](https://github.com/clice-io/xclang/releases/tag/23.1.2.7) — 2026-10-06

Built by 23.1.2.6.

- **Documentation** at [docs.clice.io/xclang](https://docs.clice.io/xclang),
  from [docs/en](docs/en): a guide (what xclang is and when not to use it,
  why it is built the way it is, a quick start, installing, cross-compiling,
  comparisons, FAQ), the integrations, the features, a reference and the
  design, with how each claim is tested.
- [`examples/`](examples): the projects the docs show (a pixi quick start,
  CMake, CMake with FetchContent, Bazel, Meson, Make, and one per feature:
  C++20 modules, sanitizers, debug symbols, libclang with the ThinLTO cache,
  cargo), built as written on a machine of every host from the published
  release's channels by examples.yml. The programs built for another
  target run on a runner of that target. tests/docs.ts checks that the
  docs show those files and the commands examples.yml runs, and that their
  links reach pages and headings.
- **The `xclang` command** in every toolchain archive, `bin/xclang`
  (`xclang.exe`): `xclang sdk fetch windows --accept-license` and
  `xclang sdk fetch macos --accept-license` fetch Microsoft's and Apple's
  SDKs into the toolchain's `sdk/`, which the MSVC targets and the macOS
  targets from Linux and Windows hosts build against; `xclang sdk list`,
  `use` and `remove` manage them
  ([the xclang command](docs/en/reference/xclang-command.md)). It loads
  nothing but its OS's libraries (glibc 2.17 at most on Linux).
- **MSVC targets**, `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`,
  against Microsoft's CRT, STL and Windows SDK, which the toolchain's own
  `xclang sdk fetch windows --accept-license` fetches into its `sdk/`
  ([MSVC targets](docs/en/integrations/clang.md#msvc-targets)), from every
  host: config files for clang and clang-cl. By default the hybrid CRT:
  the VC runtime and the STL linked statically, UCRT Windows' own DLL, so
  a program loads no `vcruntime140.dll`; the DLLs (`/MD`), all-static and
  the static debug CRT on request. compiler-rt for both, built by xclang
  in `lib/clang/23/lib/windows`: the builtins (named in every object, so
  `__int128` division links), the profile runtime, UBSan, and for x64
  AddressSanitizer (a DLL) and libFuzzer.
- A plain `clang-cl`, and `clang --target=<arch>-pc-windows-msvc`, build
  with the fetched SDK, and without it stop and name `sdk/windows`, where
  they took an installed Visual Studio; `--no-default-config` looks for one
  as before.
- `xclang sdk`: the SDK in use is `sdk/windows` (and `sdk/macos`), a link
  to the one fetched last; `xclang sdk use <name>` switches. A Windows SDK
  holds the config files that name it, the STL's `std` modules and the
  static runtime's PDBs
  ([the xclang command](docs/en/reference/xclang-command.md#the-sdk-in-use)).
- CMake: `XCLANG_TARGET=x86_64-pc-windows-msvc` (or aarch64) builds with
  clang and clang++ and the hybrid CRT (`CMAKE_MSVC_RUNTIME_LIBRARY`
  `MultiThreaded` unless set); `xclang::std` is the STL's `std` and
  `std.compat` for them
  ([CMake](docs/en/integrations/cmake.md#build-for-msvc-targets)).
- **macOS targets from Linux and Windows hosts**:
  `clang++ --target=arm64-apple-macos` (or x86_64) builds against Apple's
  macOS SDK, which the toolchain's own
  `xclang sdk fetch macos --accept-license` fetches into its `sdk/macos`
  ([macOS](docs/en/design/macos.md#the-sdk-on-linux-and-windows-hosts)).
  On those hosts the macOS targets' config files begin with
  `-isysroot <CFGDIR>/../sdk/macos`: an `-isysroot` on the command line
  replaces it, and clang no longer reads `SDKROOT` there. On macOS hosts
  nothing changes. The programs are those of a Mac: xclang's libc++,
  ld64.lld's ad-hoc signature for arm64, dSYMs, universal programs by
  `llvm-lipo`, and the sanitizers' dylibs.
- CMake: `XCLANG_TARGET=aarch64-apple-darwin` (or x86_64) on Linux and
  Windows hosts: `CMAKE_SYSTEM_NAME` `Darwin`, `CMAKE_OSX_SYSROOT` the one
  given, else `SDKROOT`, else the toolchain's `sdk/macos`, and no `xcrun`
  ([CMake](docs/en/integrations/cmake.md#build-for-macos-from-linux-or-windows)).
- `xclang sdk fetch macos` takes the preset's SDK, the macOS 27 one too,
  where it passed over SDKs from 27 on.
- **License notices** in every archive (the toolchain, libclang, the ASan
  libclang, the option tables): `share/licenses/<component>/` holds each
  component's license and notice files, `share/licenses/README.md` says
  what each component is, its version, its license and where its source
  is, and `share/licenses/sbom.spdx.json` the same as an SPDX 2.3
  document: LLVM and its runtimes, glibc 2.17, the kernel's UAPI headers
  and NSS's `libfreebl3` of the Linux sysroots (with the conda-forge
  packages, CentOS 7 source RPMs and upstream releases they come from),
  mingw-w64 and winpthreads, zlib, zstd, and Rust's standard library and
  the crates of `bin/xclang`
  ([layout](docs/en/reference/layout.md#licenses)).
- **Reproducible archives**: the same files make the same `.tar.xz`,
  whatever the machine, the time or the number of threads (sorted entries,
  the commit's time, no owner, xz in fixed blocks); each host's archives
  are made twice, on two machines, and compared before a release.
- **Smaller archives**: the headers that targets share are in the archive
  once: libc++'s in `libc++/include/c++/v1` with each target's
  `__config_site` in `libc++/include/<target>/c++/v1` (LLVM's per-target
  runtime layout, under a prefix of its own), and mingw-w64's, the same
  for x64 and arm64, in `mingw-w64/include`; no links. The config files
  name them, so
  `clang --target=...` builds as before. A build that passes
  `--no-default-config` and its own `--sysroot=$XCLANG/<target>` adds
  them itself ([layout](docs/en/reference/layout.md#shared-headers)).
- macOS archives carry no `lib/libLTO.dylib`, as the Linux and Windows
  ones carry no LTO plugin for their system linkers: macOS targets link
  with ld64.lld, and `-fuse-ld=ld` still selects Apple's `ld`, for links
  without LTO.
- **Debug symbols, the same each run**: `xclang_debug_symbols` (Bazel and
  CMake) runs llvm-gsymutil with one thread, so the same program makes the
  same GSYM file, about 1.4 times as slow; `--num-threads=0` in
  `gsymutil_args` / `GSYM_ARGS` undoes it.
  `bazel run @xclang//bazel:llvm-gsymutil -- <absolute .gsym> --address=0x...`
  reads a GSYM with the toolchain's llvm-gsymutil
  ([debugging](docs/en/features/debugging.md)). The rule's documentation
  asks for `-g`: `-gline-tables-only` gives a GSYM without functions.

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
