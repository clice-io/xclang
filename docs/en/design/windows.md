# Windows

The Windows targets, `x86_64-w64-mingw32` and `aarch64-w64-mingw32`, are
MinGW-w64 on UCRT. The Windows toolchains are MinGW programs built on
Linux.

## Summary

MinGW lets one Linux machine build every Windows sysroot and toolchain,
and its programs need nothing but Windows 10 or later. The toolchain
archives hold no symbolic links, so every tool name is a small launcher;
that costs a process start per compile. lld's `--gc-sections` drops some
static initializers for MinGW targets, so the Bazel module leaves it off
there. MSVC-ABI targets are planned.

## MinGW and MSVC

xclang began as the toolchain of clice, and clice needed one build of
itself for all six hosts, with PGO, from one kind of machine. MinGW-w64
makes that possible:

- Its headers and import libraries are free to redistribute, so a Windows
  sysroot ships in every archive.
- clang and lld build for it from Linux.
- libc++ and libunwind link into the program, as on Linux.

The Windows toolchains themselves are built that way, on Linux x64.

The C runtime is **UCRT**, not msvcrt. UCRT is part of Windows 10 and
later, and has the C99 and later functions that msvcrt lacks. It is what
MSVC programs use too. Programs need Windows 10 or later.

MinGW is not the only Windows ABI people need. Libraries built with MSVC,
COM-heavy code and vendor SDKs expect the MSVC ABI. MSVC-ABI targets are
[planned](roadmap.md#msvc) as first-class targets, and are in no release.

They build against the user's own MSVC and Windows SDK, fetched from
Microsoft by the user ([vendor SDKs](vendor-sdks.md)). The VC runtime and
the STL are linked statically and UCRT dynamically, which Microsoft calls
the "hybrid CRT". Until then, use clang-cl with Visual Studio for the MSVC
ABI.

## The Launchers

A Windows archive has no symbolic links. Windows creates them only with
developer mode or administrator rights, so an archive with links fails to
unpack for most users, and conda packages for Windows cannot carry them.
Instead, every name of `llvm.exe` (`clang.exe`, `clang++.exe`, `ld.lld.exe`,
...) is a small program,
[`windows/alias.c`](https://github.com/clice-io/xclang/blob/main/windows/alias.c).
It starts `llvm.exe <name> <arguments>`.

- **The name goes in as an argument.** The multi-call `llvm` picks the tool
  by the name it was started as. On Windows, LLVM replaces the file name in
  `argv[0]` with the name of its own module before reading it. So
  `clang++.exe` became `clang`, the C driver, which does not link the C++
  library, and `ld.lld.exe` the generic `lld`, which asks which flavour it
  should
be. The launcher passes the name as a subcommand instead.
- **It does not outlive its build.** The launcher puts `llvm.exe` in a
  kill-on-close job, so killing the launcher kills the compiler. Until
  23.1.2.4, it started `llvm.exe` suspended and then assigned it to the
  job. A kill between the two left `llvm.exe` suspended forever, outside
  any job, holding its working directory and inherited handles. Such a
  kill comes from a build tool's timeout, or from the parent's own job
  closing. Now `llvm.exe` is created inside the job
  (`PROC_THREAD_ATTRIBUTE_JOB_LIST`).
- **It costs a process start.** Each compile starts two processes instead
  of one. That shows on C files that compile in milliseconds, and not on
  C++ files with real work; [PGO](pgo.md#what-it-buys) has the numbers. A
  build tool can run `llvm.exe clang++ ...` directly.

## gc-sections and Static Initializers

For MinGW targets, lld's `--gc-sections` drops the static initializers of
COMDAT sections that nothing references. The registration objects of
inline or templated test cases are such initializers. ELF keeps them,
because `.init_array` is a root of the garbage collection. `[[gnu::used]]`
does not help, because on MinGW it does not reach the `/include` of the
linker.

clice found this the hard way. Turning `--gc-sections` on for MinGW took
its Windows unit tests from 1619 to 1551, silently, as two whole suites
stopped registering. Without it, the stripped test binary grew from 64 to
82 MB.

So the Bazel module turns the `gc_sections` feature on in optimized builds
for Linux targets, and leaves it off for Windows ones.
`--features=gc_sections` turns it on where nothing relies on such
initializers. In another build system, do not pass `-Wl,--gc-sections` for
Windows targets unless the same holds.

## Case-Sensitive Headers

Windows file names ignore case. Code written on Windows includes
`<Windows.h>`, `<BaseTsd.h>` or `<WinSock2.h>`, while the files of
MinGW-w64 are `windows.h`, `basetsd.h` and `winsock2.h`. Built on
Windows, that works. Built from Linux, the include fails.

The fix is in the code: the lower-case spelling, which works everywhere.
xclang does not add links for every spelling to the MinGW sysroots.
kotatsu, built from Linux by xclang's CI, changed its `<BaseTsd.h>` for
this.

The MSVC CRT, STL and Windows SDK that the
[unreleased](roadmap.md#xclang-command) `xclang sdk fetch windows` lays out
on Linux do get case links, 3.6k of them. Microsoft's own headers and
libraries use mixed spellings.

## Visual Studio from a MinGW-Built Clang

A clang built with MinGW could not find Visual Studio 2017 or later, and
neither could any tool built on its libraries. LLVM builds the Setup API
lookup only with MSVC, and the MinGW build fell back to the registry. There
it found the headers of Visual Studio 2010 and older. clice, a MinGW-built
tool that runs the clang driver on the commands of MSVC projects, got the
wrong headers.

[Patch 0004](../reference/patches.md) enables the lookup on MinGW. It was
sent upstream as llvm/llvm-project#226794.

## Not Yet Supported

| | status |
|---|---|
| [MSVC-ABI targets, x64 and arm64, with their sanitizers](roadmap.md#msvc) | Planned |
| [Windows x86 (MSVC)](roadmap.md#windows-x86-msvc) | In research |
| [Windows 7 and XP](roadmap.md#windows-7) | In research |
| [Windows x86 (MinGW)](roadmap.md#windows-x86-mingw) | Considered |
| [Windows arm64ec](roadmap.md#arm64ec) | Considered |
| [Sanitizers for MinGW targets](roadmap.md#mingw-sanitizers) | Considered |

A MinGW variant on msvcrt, for Windows before 10, is
[not planned](roadmap.md#msvcrt).

## Known Limitations

- **No Bazel sandbox by default.** Bazel runs actions on Windows without a
  sandbox unless an experimental one is set up
  (`--experimental_use_windows_sandbox`). An action can then read files it
  did not declare, and nothing notices. The Linux and macOS builds of the
  same targets enforce the declarations.
- **Large ThinLTO links are not always the same bytes.** PE files carry a
  link timestamp, and Bazel links pass `--no-insert-timestamp`, so small
  programs link to the same bytes every time. A large one does not always.
  clice's 600 MB `clice.exe`, linked six times by lld with ThinLTO from
  the same inputs, came out in three different layouts, with and without
  the ThinLTO cache. The cause is not known.
