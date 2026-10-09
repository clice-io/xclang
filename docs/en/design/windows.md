# Windows

xclang has two kinds of Windows targets. `x86_64-w64-mingw32` and
`aarch64-w64-mingw32` are MinGW-w64 on UCRT, with their sysroots in every
archive. The MSVC-ABI targets, `x86_64-pc-windows-msvc` and
`aarch64-pc-windows-msvc`, build against the SDK the user fetches. The
Windows toolchains are MinGW programs built on Linux.

## Summary

MinGW lets one Linux machine build every Windows sysroot and toolchain,
and its programs need nothing but Windows 10 or later. The toolchain
archives hold no symbolic links, so every tool name is a small launcher;
that costs a process start per compile. lld's `--gc-sections` drops some
static initializers for MinGW targets, so the Bazel module leaves it off
there. The MSVC targets build against the SDK the user fetches, with libc++ and
the VC runtime linked statically and UCRT from Windows; Microsoft's STL is
a switch.

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
COM-heavy code and vendor SDKs expect the MSVC ABI. So the MSVC targets
are first-class targets too.

## MSVC Targets

The MSVC targets build against Microsoft's CRT and Windows SDK, which
the user fetches from Microsoft with `xclang sdk fetch windows`
([vendor SDKs](vendor-sdks.md)), with xclang's libc++
([below](#libc-and-the-stl)). How to use them is in
[MSVC targets](../integrations/clang.md#msvc-targets).

**The SDK through the config files.** No archive can hold the SDK, so
the config files of the targets hold no path to one. The fetch writes a
file into the SDK it fetched that names the SDK and its versions, for
clang (`-Xmicrosoft-windows-sys-root`) and for clang-cl (`/winsysroot`).
The toolchain reaches it through the fixed path `sdk/windows`, a link to
the SDK in use ([config files](toolchain.md#a-config-file-per-target)).
Config files have no conditions, and one that includes a missing file
fails to load, for every compile. So the config files of the targets
include `bin/<target>-sdk.cfg` (`-clang-cl-sdk.cfg` for clang-cl), which
names no SDK in the archive and which `xclang sdk fetch`, `use` and
`remove` rewrite: it includes the file of the SDK in use, for the
architectures it has. Without an SDK, then, what needs none still compiles: a freestanding
compile, or the queries of a tool such as clice. On Linux and macOS hosts
the config files name `sdk/windows` as the sysroot all the same, so clang
never takes the headers of the machine (`INCLUDE`, a `cl.exe` in `PATH`);
a compile that includes a header of the CRT stops at it
(`'stdio.h' file not found`), and `-v` shows where clang looked. On
Windows hosts they name none, and clang finds Visual Studio and the
Windows SDK as upstream clang does.

**The hybrid CRT.** The VC runtime and the C++ library are linked
statically, as `/MT` has them, and UCRT comes from `ucrtbase.dll`, a component of Windows
10 and later. Microsoft calls this the hybrid CRT. A program then loads
only Windows' DLLs, as the [hermeticity](hermeticity.md) rule asks, and
shares one heap, one `errno` and one stdio with every DLL it loads. The
config files say it in every object: `/nodefaultlib:libucrt.lib` and
`/defaultlib:ucrt.lib`. So lld-link honours it also when CMake has it link
on its own. `/MD` takes `ucrt.lib` anyway. The debug CRTs need
`/nodefaultlib:ucrt.lib` on the link itself, as lld-link reads an object's
directives in order and the objects name `ucrt.lib` first.

**compiler-rt.** xclang builds it for both targets with clang-cl, against
windows-2022's SDK (MSVC 14.44), as newer toolsets link libraries of older
ones, and libc++ the same way. It is in `lib/clang/<major>/lib/windows/clang_rt.<name>-<arch>.lib`,
the one directory lld-link searches by itself. Neither clang driver links
the builtins for MSVC targets, so the config files name them in every
object too; otherwise `__int128` division does not link. The builtins name
no C runtime (`/Zl`); the profile runtime is built `/MT`, and ASan's DLL
`/MD`, as compiler-rt builds them for Windows.

**clang-cl.** A plain `clang-cl` reads the config file of its default
target, `<host triple>-clang-cl.cfg`, before it turns to the MSVC target.
xclang makes that file the clang-cl file of the MSVC target of the host's
architecture, so `clang-cl` builds against the fetched SDK with no
`--target`.

**Visual Studio on Windows hosts.** With a fetched SDK, a Windows host
builds against it too, not an installed Visual Studio: the SDK is pinned,
and the build is the same on every host. Without one, clang finds Visual
Studio by itself, which [patch 0004](../reference/patches.md) makes work
for the MinGW-built clang; so does `--no-default-config`, also with an SDK
fetched.

**CMake uses clang, not clang-cl.** The CMake package compiles and links
the MSVC targets with clang++, as it does every other target. CMake then
links through the clang driver, so every link reads the config file. With
clang-cl, CMake runs lld-link itself, which reads no config file, and
wants `mt` for manifests, which xclang does not have (`llvm-mt` needs
libxml2). The Bazel module does the same
([Bazel](../integrations/bazel.md#vendor-sdks)).

**UCRT's inline functions.** UCRT declares some functions of the C
library (`ctime`, `localtime`, `difftime`, ...) `static inline` unless
`_STATIC_INLINE_UCRT_FUNCTIONS` is 0, which MSVC 19.50 makes the default.
A module cannot export a function of internal linkage, so the `std`
module did not build. The config files define it 0 for every compile.

## libc++ and the STL

The MSVC targets' C++ library is libc++, as every other target's, since
23.1.2.10: one C++ library and one `import std` on every target, and the
same behavior of `std::format`, `<filesystem>` and the containers.
Microsoft's STL stays a choice: C++ types passed between a program and a
library built with MSVC need the STL on both sides.

**libc++ on vcruntime.** libc++ is built with clang-cl against the SDK,
static, with Microsoft's vcruntime as its ABI library, as libc++'s own
clang-cl configuration has it: vcruntime throws and catches the exceptions,
holds the type information and `operator new`, and UCRT is the C library.
There is no libc++abi or libunwind. libc++ counted on Microsoft's STL
library for `std::set_new_handler` and repeated the C runtime's
`std::nothrow`; [patch 0016](../reference/patches.md) gives it the one and
not the other.

**One build for every C runtime.** libc++ is compiled `/MT` with `/Zl`: it
names no C runtime, and its calls to UCRT and vcruntime are direct ones,
which both their static libraries and their import libraries resolve. So
the one `libc++-<arch>.lib` links with the hybrid CRT, `/MT`, `/MD` and
the debug CRTs alike; each program's own objects name the C runtime. It
is also built with `_CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS`, UCRT's advice
for static libraries, not libc++'s `_CRT_STDIO_ISO_WIDE_SPECIFIERS`, which
would put a `/failifmismatch` in it that the objects of every program
compiled without it contradict. The wide `printf` of a program keeps
Microsoft's specifiers unless it chooses the ISO ones.

**Found by the linker alone.** The library is
`lib/clang/<major>/lib/windows/libc++-<arch>.lib`, next to compiler-rt, the
one directory lld-link searches by itself; both architectures share it.
The target's `__config_site` names it with `#pragma comment(lib, ...)`, as
libc++'s own auto-linking does with `libc++.lib`. So every object that
includes libc++ links it, also when lld-link links without clang (CMake
with clang-cl, MSBuild), and no C object or object built with the STL
does.

**`-stdlib=` selects the library.** clang's MSVC toolchain did nothing
with `-stdlib=`: the STL comes with the C runtime's headers, in the VC
tools' include directory. [Patch 0015](../reference/patches.md) makes it
take `-stdlib=libc++` and `-stdlib=platform`, the platform's library, the
STL. The config files say `-stdlib=libc++` and give libc++'s headers with
`-stdlib++-isystem`, as for the other targets; `-stdlib=platform` on the
command line drops them, and the STL's are found as before. clang-cl has
neither option, so its config files pass them with `/clang:`, which
clang-cl reported unused in every C compile until
[patch 0011](../reference/patches.md).

**`import std`.** libc++'s `std` and `std.compat` modules are in
`<target>/share/libc++/v1`, with `<target>/lib/libc++.modules.json`, as for
the other targets. clang's `-print-library-module-manifest-path` does not
report them for MSVC targets (it looks for a `libc++.a`), so the CMake
package takes them from there. With `-stdlib=platform`, `xclang::std` is
the STL's: clang 23 builds `std.ixx` and `std.compat.ixx` of Microsoft's
STL. For arm64 it takes the `_alloca` of `<malloc.h>`, which the STL
includes inside the module, for a second declaration; the CMake package's
copy of `std.ixx` includes `<malloc.h>` before the module, with the other
C headers.

**The C++ standard.** clang's default for MSVC targets is C++14, as
cl's. The STL has parts of C++17's library there already (the `_v`
variable templates of `<type_traits>`), libc++ only from C++17 on. Code
that relied on them builds with `-std=c++17` or later.

## The Launchers

A Windows archive has no symbolic links. Windows creates them only with
developer mode or administrator rights, so an archive with links fails to
unpack for most users, and conda packages for Windows cannot carry them.
Instead, every name of `llvm.exe` (`clang.exe`, `clang++.exe`, `ld.lld.exe`,
...) is a small program,
[`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c).
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

The MSVC CRT, STL and Windows SDK that `xclang sdk fetch windows` lays
out on Linux do get case links, 3.6k of them. Microsoft's own headers and
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
- **PGO-built programs were not always the same bytes**, until
  23.1.2.10. PE files carry a link timestamp, and Bazel links pass
  `--no-insert-timestamp`, so small programs linked to the same bytes
  every time; a large PGO-built one did not always: clice's 600 MB
  `clice.exe`, linked six times by lld with ThinLTO from the same inputs,
  came out in three different layouts. lld-link records the place the
  call graph profile gives each function under the function's name, and
  local functions of the same name in several objects all took the place
  of one of them, which one depending on where lld-link's memory happened
  to put them. [Patch 0017](../reference/patches.md) takes the first.
- **Visual Studio's compiler-rt came first without an SDK**, until
  23.1.2.10. On a Windows host with no fetched SDK, clang gave lld-link
  Visual Studio's library directory before xclang's compiler-rt, and
  Visual Studio has its own `clang_rt.*.lib` there (Microsoft's builds,
  for its own clang), which took the place of xclang's: on windows-2025
  (Visual Studio 18, MSVC 14.51), `__int128` division, UBSan and
  libFuzzer did not link. [Patch 0012](../reference/patches.md) puts
  compiler-rt first.
