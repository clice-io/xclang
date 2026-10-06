# How xclang Is Tested

Every claim the docs make about what xclang does is checked by a test that
runs on CI, on GitHub-hosted runners of every host. This page maps the
claims to the tests and the workflows that run them. The other pages link
here instead of naming tests.

## Summary

- Before a release, each host archive is tested on a machine of that host
  (`tests/smoke.ts`, `tests/libclang.ts`). The CMake package and the Bazel
  module are tested with the archives (`tests/cmake.ts`, `tests/bazel`),
  and so are the MSVC targets and the macOS targets from Linux and Windows
  hosts (`tests/msvc.ts`, `tests/macos.ts`). The `xclang` command is
  tested on every host (`tests/cli.ts`).
- On publishing, the Bazel module is checked further (`tests/bazel.ts`),
  and cross-built programs run on a machine of their target, with no
  emulator: 22 host-to-target pairs.
- After a release is published, examples.yml runs the commands of the docs
  as written, from conda.clice.io, the archives, the tag and bazel.clice.io.
  What they build for another target then runs on a runner of that target.
- `tests/docs.ts` checks that the files the docs show are the files CI
  builds, that their commands are the steps examples.yml runs, and that
  every link reaches its page and heading.

## When Tests Run

| workflow | when | what |
|---|---|---|
| main.yml, stage `package` (package.yml) | every release candidate | each host's archives made again on another machine, in another directory, with other file times, umask 077 and three xz threads (the first has four): the same bytes |
| main.yml, stage `test` (test.yml) | every release candidate | `tests/smoke.ts` and `tests/libclang.ts` on a machine of each host |
| bazel.yml | every release candidate | `tests/bazel` with the module |
| bazel.yml | on publishing, and by hand | also `tests/bazel.ts`, and cross builds run on the target (`tests/bazel-cross.ts`) |
| cmake.yml | every release candidate, and on publishing | `tests/cmake.ts`: the package by `PATH`, through the toolchain file, and from FetchContent of the tag |
| conda.yml | before the conda packages are published | each package installed with pixi and used, on every host |
| examples.yml | after publishing, and on pushes that change `examples/` or the workflow | the commands and `examples/` of the docs, as written; the programs for other targets on their runners |
| docs.yml | pushes that change the docs, `examples/`, `tests/docs.ts` or a workflow, on every branch | `tests/docs.ts`; on `main`, then publishing to docs.clice.io |
| cli.yml | every release candidate, with main.yml's `cli` (on by default), and by hand | the `xclang` command: `tests/cli.ts`, `tests/cargo.ts` |
| main.yml, stage `msvc` (msvc.yml) | every release candidate; needs `cli`, as the archives' `xclang` fetches the SDK | the MSVC targets: `tests/msvc.ts` |
| main.yml, stage `macos` (macos.yml) | every release candidate; needs `cli` | the macOS targets from Linux and Windows hosts: `tests/macos.ts` |
| bench.yml | by hand, for the notes or the docs | compile speed against LLVM's and Apple's builds (`tests/bench.ts`) |

How the stages fit together is in the [build pipeline](release-build.md).

## The Toolchain on Each Host

`tests/smoke.ts` checks an unpacked toolchain on a machine of its host:

- Its own programs load no C++ runtime, and on Linux need glibc 2.17 at
  most.
- C and C++ programs (exceptions, iostreams, threads) build for every
  target the host can build for, and run where the machine can run them.
  That includes x86_64 macOS programs on arm64 macOS through Rosetta, and
  x86_64 Windows programs on Windows on Arm.
- Natively: `import std`, a precompiled header, ThinLTO, wide atomics,
  hardening flags (`_LIBCPP_HARDENING_MODE_DEBUG`), a version resource,
  and `-static` on Linux.
- The [GCC library names](../design/hermeticity.md#gcc-library-names) link:
  `-latomic`, `-lgcc`, `-lgcc_eh`, `-lgcc_s`, `-lssp` on Windows,
  `-lstdc++`, and `windres`.
- The checks each [LLVM patch](../reference/patches.md) was made against.
  For example, `--no-default-config --target=<arch>-pc-windows-msvc` finds
  Visual Studio on the Windows runners (patch 0004).
- The MSVC targets: their compiler-rt is there, and without a fetched SDK
  clang and a plain clang-cl stop and name `sdk/windows`.
- ASan, TSan and libFuzzer on Linux and macOS hosts. An overflow within
  the capacity of a `std::string` is reported, and a program that shares
  the `std::filesystem` instantiations of `libc++.a` gets no false report
  ([why an ASan libc++](../features/sanitizers.md#why-an-asan-libc)).
- dSYM and GSYM debug symbols made by the toolchain's `dsymutil` and
  `llvm-gsymutil`, for every target.

`tests/libclang.ts` builds and runs `tests/libclang`, a small tool on
libclang. It finds libclang through `find_package(Clang)`, links the ThinLTO
bitcode, and registers every target's MC layer.

## Programs and What They Load

examples.yml builds the [quick start](../guide/quick-start.md) programs for
every target on every host, and lists what each loads with
`llvm-readobj --needed-libs`. Linux programs load `libc.so.6`, `libm.so.6`,
`libdl.so.2`, `libpthread.so.0` and the dynamic loader. Windows programs
load `KERNEL32.dll` and UCRT. macOS programs load `libSystem.B.dylib`.
The job fails if any program loads a C++ runtime. That is the
[hermeticity](../design/hermeticity.md) rule, checked.

## Cross-Compiling

- `tests/smoke.ts` and `tests/cmake.ts` build for every target on every
  host.
- bazel.yml builds `tests/bazel` on every host for every other target it
  can build for: 22 host-to-target pairs. A machine of the target then runs
  the tests (`tests/bazel-cross.ts`): Linux-built Windows programs on
  Windows, Windows-built Linux programs on Linux, and so on.
- From Linux x64, bazel.yml builds kotatsu's tests, from the registry, for
  Windows x64, and runs them on Windows.
- examples.yml builds the programs of the docs for other targets, with
  clang, CMake, FetchContent, Meson, Make, Bazel and cargo, and uploads
  them. Its `on-target` job runs each on a runner of its target, with
  nothing installed, and compares what it prints with the `expected.txt`
  of its example. That covers every host to every Linux and Windows
  target, and both macOS targets from both macOS hosts. Its `sdk` job
  fetches the vendor SDKs with the release's `xclang` on Linux x64,
  Windows x64 and macOS arm64, as the docs show, and builds for both MSVC
  targets (clang, clang-cl, CMake, cargo) and, on Linux and Windows, for
  both macOS targets (clang, CMake, cargo); `on-target` runs those programs
  on Windows x64 and arm64 and on Macs too. Nothing of an SDK leaves the
  job.

## CMake Package

`tests/cmake.ts` builds `tests/cmake` on every host, with CMake 3.28 and
Ninja 1.11, and with the newest of both:

1. `find_package(xclang)` found by `PATH`, with
   `CMAKE_CXX_COMPILER=clang++`.
2. Every other target the host builds for, through the toolchain file and
   `XCLANG_TARGET`. The programs run where the machine can run them.
3. Nothing installed: FetchContent of the tag, whose `xclang.cmake`
   downloads `SHA256SUMS` and the host toolchain.
4. `tests/libclang` with the ThinLTO cache. A second link takes every
   module's code from the cache, and the program is the same.

`tests/cmake` covers a C++ module of partitions, `xclang::std` with
`std.compat`, `xclang_add_std` with `-fno-exceptions`, and
`xclang_debug_symbols`.

## Bazel Module

`tests/bazel` builds and tests with the module on every host.
`tests/bazel.ts` then checks, with the same disk cache:

1. **No absolute paths.** A copy of the checkout elsewhere, with another
   output base, builds the programs from the disk cache alone. So do they
   built for a target of another OS, which fetches no other host toolchain
   and only that target's libclang. A macOS target off macOS fails and
   says why.
2. **The registry archive.** The module as `scripts/bazel.ts` packs it for
   bazel.clice.io gives the same actions, from the disk cache.
3. **`git_override`** of a commit, with `strip_prefix = "packages/bazel"`,
   builds the programs.
4. **A new release rebuilds.** The copy at the previous release runs every
   compile and link again.
5. **`gc_sections`**: on by default for Linux in optimized links, off for
   Windows unless asked for.
6. **The cost of declared inputs**: the programs built in the sandbox and
   outside it, one action at a time, on Linux and macOS.
7. **The ThinLTO cache** on the link of libclang's bitcode: the module
   makes the directory, again once it is gone. A second link takes every
   module's code from it, and the program is the same without it.
8. **Debug symbols** by `xclang_debug_symbols`: GSYM, and dSYM on macOS,
   with lines of the program's code and of libclang after ThinLTO, for
   another OS's target too.
9. **Debug information wherever the build ran.** A `-c dbg` program is the
   same bytes from another checkout, and so is the DWARF of its dSYM on
   macOS. gdb (Linux), lldb with and without a dSYM (macOS) and
   llvm-symbolizer (Linux, Windows) find a source in the workspace and one
   in an external repository.
10. **Strip** by object format, for the host target and another OS's.
11. **`@libclang` follows `--features=asan`**: its libraries and resource
    directory switch together.

examples.yml builds `examples/bazel` from bazel.clice.io on every host, and
for another target.

## C++20 Modules

- `tests/cmake` builds a module of partitions and `import std` on every
  host, for every target, with CMake 3.28 and the newest.
- `tests/bazel` builds a module of partitions, a module importing another,
  a module unit reading the defines of a library it depends on, and
  `import std`, on every host and for every other target.
- examples.yml builds `examples/modules`, a module with a partition and
  `import std`, by hand with one-step compiles, with CMake and with Bazel,
  on every host, and for Windows x64 with CMake and Bazel.
- examples.yml's `ccache` job runs the command lines CMake gives a module
  and its importer three times, under ccache 4.13.6 and 4.14.1. The job
  fails when either version stops behaving as
  [build caches and modules](../features/modules.md#build-caches-and-modules)
  says.

## The xclang Command

cli.yml builds the `xclang` command for every host, with a released xclang
as the C compiler and linker (`scripts/cli.ts`). On a machine of each
host, `tests/cli.ts` then:

- fetches both vendor SDKs;
- cross-compiles C, C++ and Objective-C programs against them, for both
  macOS architectures and for x64 and arm64 Windows (MSVC ABI), and runs
  them on macOS and Windows runners;
- adds and removes targets against a test index.

From Linux, `tests/cargo.ts` builds `cli/` with cargo for macOS and the MSVC
ABI against the fetched SDKs ([Rust and Cargo](../integrations/cargo.md)).

## MSVC Targets

msvc.yml tests the MSVC targets with a run's archives, from Linux x64,
macOS arm64 and Windows x64 hosts. On each, `tests/msvc.ts`:

- checks that clang and clang-cl stop without the SDK and name
  `sdk/windows`;
- fetches the SDK of `windows-latest` with the archive's `xclang`, and
  windows-2022's for x64, and switches between them with `sdk use`;
- builds, for x64 and arm64, C and C++ (exceptions, threads,
  `<filesystem>`, `<format>`) with clang, clang++ and clang-cl, `__int128`
  division, a Win32 program, ThinLTO, debug information, UBSan, the profile
  runtime, and for x64 ASan with the static and the DLL CRT and libFuzzer;
- checks the DLLs each program imports: the hybrid CRT imports UCRT's API
  sets and no `vcruntime140.dll` or `msvcp140.dll`; `/MD` and
  `-fms-runtime-lib=dll` import both; all-static, `/MTd` and
  `-fms-runtime-lib=static_dbg` import neither; none imports a debug DLL;
- builds `tests/cmake` for both targets through the toolchain file, and
  from Linux kotatsu and its tests for x64.

The programs of every host then run on windows-2025 and windows-11-arm,
and kotatsu's tests in its source tree. Only programs leave a job, never
anything of the SDK.

## macOS from Linux and Windows

macos.yml tests the macOS targets from Linux and Windows hosts with a
run's archives, on Linux x64 and arm64 and Windows x64 and arm64 hosts. On
each, `tests/macos.ts`:

- checks that clang without the SDK names `sdk/macos`, and that the CMake
  package stops and says how to fetch it;
- fetches the SDK of `macos-latest` with the archive's `xclang`, and checks
  that an `-isysroot` of the command line replaces `sdk/macos`;
- builds, for arm64 and x86_64, with a bare `--target`: C, C++
  (exceptions, threads, `<filesystem>`, `<format>`), `import std`,
  ThinLTO, debug information in a dSYM, with ThinLTO too, CoreFoundation,
  Objective-C with Foundation, a dylib and a program that
  `llvm-install-name-tool` gives an rpath, UBSan, ASan, TSan, libFuzzer and
  the profile runtime;
- checks with `llvm-otool` that each program loads `libSystem` and only
  what else it uses (its frameworks, `libobjc`, xclang's sanitizer
  runtimes, its dylib), never `libc++.dylib`, and that it names macOS 13.0
  and the fetched SDK's version;
- builds `tests/cmake` for both targets through the toolchain file, and
  reads its GSYM, made from the dSYM;
- makes universal programs of both with `llvm-lipo`.

The programs of every host then run on macos-15 (arm64) and
macos-15-intel, with the sanitizers' dylibs next to them. On arm64 each is
checked for the linker's ad-hoc signature, with no `codesign` run; Apple's
`dwarfdump` and `atos` read the dSYMs. Only programs leave a job, with
their dSYMs, never anything of the SDK.

## The Feature Examples

examples.yml builds the example of each feature page, in `examples/`, and
checks what the page says it prints:

- **Sanitizers**, on Linux and macOS hosts: by hand, with CMake and with
  Bazel. ASan with the ASan libc++ reports the container-overflow and exits
  1; without it, no report. TSan reports the data race and exits 66. On
  macOS, both abort after the report. libFuzzer runs 1000 inputs.
- **Debug symbols**, on every host: a GSYM by hand, looked up by the
  address of a function, and with `xclang_debug_symbols` in CMake (with the
  dSYM on macOS) and in Bazel.
- **libclang and the ThinLTO cache**, on every host: the tool on the
  release archive of libclang with CMake, and on `@libclang` with Bazel. The
  job records the link times and the entries of the cache.
- **Cargo**, from Linux x64 and macOS arm64: Rust programs with C code for
  Windows x64 and arm64 and for Linux arm64, run on their targets. The
  Windows programs load no runtime DLL.

## The Docs

- `node tests/docs.ts` checks that every code block under a
  `<!-- file: -->` marker is that file of the repository, and every block
  under `<!-- excerpt: -->` consecutive lines of its file. Each command
  block outside these Development pages is a step of examples.yml, or
  says why CI does not run it (`<!-- not run: -->`). It also checks that
  every directory of `examples/` is built and shown, that every relative
  link reaches its page and heading, and that the status of every
  unshipped item is one of the [roadmap](../design/roadmap.md) words.
- examples.yml runs the commands of the docs and `examples/` on every
  host, against the published release. Make runs on Linux and macOS hosts.
  Windows hosts also build the CMake and Meson projects for
  `aarch64-unknown-linux-gnu`.

## Checked by Hand

Some claims were checked once, by hand, and are not part of a workflow:

- The dSYM and the program came out the same bytes with and without the
  ThinLTO cache, cold or warm, for 23.1.2.6 on arm64 and x86_64 macOS
  ([debugging](../features/debugging.md#why-a-dsym-comes-from-the-link)).
- llvm-gsymutil wrote three different files in three runs on one program,
  and the same file every run with `--num-threads=1`
  ([debugging](../features/debugging.md#known-limitations)).
- lld linked clice's 600 MB `clice.exe` with ThinLTO six times from the same
  inputs, in three layouts
  ([Windows](../design/windows.md#known-limitations)).

## Speed

bench.yml compares the compile speed of a release with LLVM's own build of
the same version, and with Apple's clang on macOS. The method and the
numbers are in [PGO](../design/pgo.md#what-it-buys).

## Runs for 23.1.2.7

| workflow | run |
|---|---|
| main.yml (build, `test`, `bazel`, `cmake`, `msvc` and `macos` stages) | [37454002667](https://github.com/clice-io/xclang/actions/runs/37454002667) |
| bazel.yml, on publishing | [37481563479](https://github.com/clice-io/xclang/actions/runs/37481563479) |
| cmake.yml, on publishing | [37481563519](https://github.com/clice-io/xclang/actions/runs/37481563519) |
| conda.yml | [37481672889](https://github.com/clice-io/xclang/actions/runs/37481672889) |
| examples.yml | [37494316755](https://github.com/clice-io/xclang/actions/runs/37494316755) |
| bench.yml | 23.1.2.6's: [37356476645](https://github.com/clice-io/xclang/actions/runs/37356476645) |
