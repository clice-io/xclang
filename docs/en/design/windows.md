# Windows

The Windows targets, `x86_64-w64-mingw32` and `aarch64-w64-mingw32`, are
MinGW-w64 on UCRT, and the Windows toolchains are MinGW programs built on
Linux. This page says why, and what Windows took that the other targets
did not.

## MinGW today, MSVC to be first-class

xclang began as clice's toolchain, and clice needed one build of itself
for all six hosts, with PGO, from one kind of machine. MinGW-w64 makes that
possible: its headers and import libraries are free to redistribute, so a
Windows sysroot ships in every archive; clang and lld build for it from
Linux; libc++ and libunwind link into the program as on Linux. The Windows
toolchains themselves are built that way, on Linux x64.

MinGW is not the only Windows ABI people need: libraries built with MSVC,
COM-heavy code and vendor SDKs expect the MSVC ABI. MSVC-ABI targets are to
be first-class too, against the user's own MSVC and Windows SDK, fetched
from Microsoft by the user ([vendor SDKs](vendor-sdks.md)), with the VC
runtime and STL linked statically and UCRT dynamically, Microsoft's
"hybrid CRT". They are in research; the fetching and cross builds work in
tests ([roadmap](roadmap.md#targets)).

The C runtime is **UCRT**, not msvcrt: UCRT is part of Windows 10 and
later, has the C99 and later functions msvcrt lacks, and is what MSVC
programs use too. Programs need Windows 10 or later.

## The launchers

A Windows archive has no symbolic links: Windows creates them only with
developer mode or administrator rights, so an archive with links fails to
unpack for most users, and conda packages for Windows cannot carry them.
Every name of `llvm.exe` (`clang.exe`, `clang++.exe`, `ld.lld.exe`, ...) is
instead a small program, [`windows/alias.c`](https://github.com/clice-io/xclang/blob/main/windows/alias.c),
that starts `llvm.exe <name> <arguments>`.

- **The name goes in as an argument.** The multi-call `llvm` picks the tool
  by the name it was started as, but on Windows LLVM replaces the file name
  in `argv[0]` with its own module's before reading it: started as
  `clang++.exe`, it saw `clang`, the C driver, which does not link the C++
  library; as `ld.lld.exe`, the generic `lld`, which asks which flavour it
  should be. So the launcher passes the name as a subcommand.
- **It does not outlive its build.** The launcher puts `llvm.exe` in a
  kill-on-close job, so killing the launcher kills the compiler. Until
  23.1.2.4 it started `llvm.exe` suspended and then assigned it to the job;
  a kill between the two (a build tool's timeout, or the parent's own job
  closing) left `llvm.exe` suspended forever, outside any job, holding its
  working directory and inherited handles. It is now created inside the job
  (`PROC_THREAD_ATTRIBUTE_JOB_LIST`).
- **It costs a process start.** Each compile starts two processes instead of
  one. On C files that compile in milliseconds that shows: 2 to 6% on x64
  and 10 to 22% on arm64 in xclang's benchmark ([PGO](pgo.md#what-it-buys));
  on C++ files with real work it does not. A build tool can run
  `llvm.exe clang++ ...` directly.

## gc-sections and static initializers

lld's `--gc-sections`, for MinGW targets, drops the static initializers of
COMDAT sections that nothing references, for example the registration
objects of inline or templated test cases. ELF keeps them, as `.init_array`
is a root of the garbage collection; for MinGW targets lld collects them.
`[[gnu::used]]` does not help, as it does not reach the linker's
`/include` on MinGW.

clice found it the hard way: turning `--gc-sections` on for MinGW took its
Windows unit tests from 1619 to 1551, silently, as two whole suites stopped
registering. Without it, the stripped test binary grew from 64 to 82 MB.
So the Bazel module turns `gc_sections` on in optimized builds for Linux
targets and leaves it off for Windows ones; `--features=gc_sections` turns
it on where nothing relies on such initializers.

## Case-sensitive headers

Windows file names ignore case, and code written on Windows includes
`<Windows.h>`, `<BaseTsd.h>`, `<WinSock2.h>`; MinGW-w64's files are
`windows.h`, `basetsd.h`, `winsock2.h`. Built on Windows, that works; built
from Linux, the include fails. The fix is in the code (the lower-case
spelling, which works everywhere); xclang does not add links for every
spelling to the MinGW sysroots. kotatsu, built from Linux by xclang's CI,
changed its `<BaseTsd.h>` for this. (The MSVC SDK that `xclang sdk fetch
windows` lays out on Linux does get case links, 3.6k of them, because
Microsoft's own headers and libraries use mixed spellings.)

## Visual Studio from a MinGW-built clang

A clang built with MinGW, and every tool built on its libraries, could not
find Visual Studio 2017 or later: LLVM builds the Setup API lookup only
with MSVC, and the MinGW build fell back to the registry, where it found
the headers of Visual Studio 2010 and older. clice, a MinGW-built tool that
runs clang's driver on MSVC projects' commands, got the wrong headers.
[Patch 0004](patches.md) enables the lookup on MinGW (sent upstream as
llvm/llvm-project#226794); tests/smoke.ts checks that `--target=<arch>-pc-windows-msvc`
finds Visual Studio on the Windows runners.

## Reproducible links

PE files carry a link timestamp; Bazel links pass `--no-insert-timestamp`,
and small programs then link to the same bytes every time. A large one did
not: clice's 600 MB `clice.exe`, linked six times by lld with ThinLTO from
the same inputs, came out in three different layouts, with and without the
ThinLTO cache. The cause is open.

## What Windows lacks

- Sanitizers for Windows targets.
- A Bazel sandbox: on Windows an action can read files it did not declare,
  and nothing notices. Hermeticity is enforced by the Linux and macOS
  builds of the same targets.
- MSVC-ABI targets, Windows x86, arm64ec, older Windows: in the
  [roadmap](roadmap.md#targets).
