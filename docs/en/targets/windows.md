# Windows

xclang provides two pairs of Windows targets: the MinGW targets
(`x86_64-w64-mingw32` and `aarch64-w64-mingw32`), whose sysroots ship in every
toolchain archive, and the MSVC targets (`x86_64-pc-windows-msvc` and
`aarch64-pc-windows-msvc`), which build against the Windows SDK fetched with
`xclang sdk fetch windows` or an installed Visual Studio. Both target the
Universal C Runtime (UCRT) on Windows 10 or later, link xclang's `libc++` and
`compiler-rt` statically by default, and link with `lld` (`ld.lld` for MinGW,
`lld-link` for MSVC). The Windows host toolchains themselves are MinGW programs
cross-compiled on Linux x64 ([cross-compiling](cross-compiling.md)).

## MinGW Targets

Build for `x86_64-w64-mingw32` and `aarch64-w64-mingw32` from any host (or
natively on a Windows host without `--target`):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

`x86_64-w64-windows-gnu`, `x86_64-pc-windows-gnu`, `aarch64-w64-windows-gnu`,
`aarch64-pc-windows-gnu`, `arm64-w64-mingw32`, `arm64-w64-windows-gnu` and
`arm64-pc-windows-gnu` use the same config files.

- **MinGW-w64 14.0.0 on UCRT**: the bundled sysroots are configured with
  `--with-default-msvcrt=ucrt` and `--with-default-win32-winnt=0x0A00`
  (Windows 10 and later). UCRT ships with Windows 10 and later and provides the
  C99 and later library functions that `msvcrt.dll` lacks.
- **Static C++ and runtime libraries**: `libc++`, `libc++abi`, `libunwind`,
  `winpthreads` (`libpthread.a`) and `compiler-rt` link statically into the
  executable. The resulting binary loads only Windows system DLLs
  (`KERNEL32.dll` and `api-ms-win-crt-*`), with no `libc++.dll`,
  `libwinpthread-1.dll` or `libstdc++-6.dll` alongside it
  ([hermeticity](../design/hermeticity.md)).
- **Output file names**: a MinGW link adds `.exe` to an output name without
  an extension, on every host: `-o hello` writes `hello.exe`.
- **GCC compatibility**: `-latomic`, `-lgcc`, `-lgcc_s`, `-lgcc_eh`, `-lssp` and
  `-lssp_nonshared` resolve to empty archives in the sysroot, `-lstdc++` links
  `libc++`, and `windres` is `llvm-windres`.
- **Rust targets**: use `x86_64-pc-windows-gnullvm` and
  `aarch64-pc-windows-gnullvm` rather than `*-pc-windows-gnu`. The `-gnullvm`
  targets link `libunwind` and UCRT, matching xclang's MinGW sysroots
  ([Rust and Cargo](../integrations/cargo.md)).
- **`-stdlib=platform` on MinGW**: passing `-stdlib=platform` (or
  `-stdlib=libstdc++`) selects `bin/<triple>-system.cfg`, which keeps
  `-fuse-ld=lld` and leaves out xclang's sysroot and `libc++`. Pass `--sysroot`
  pointing to a MinGW root that carries `libstdc++`, such as MSYS2's `ucrt64`,
  or on Debian and Ubuntu a directory containing two symbolic links,
  `x86_64-w64-mingw32` to `/usr/x86_64-w64-mingw32` and `lib/gcc` to
  `/usr/lib/gcc` (passing `--sysroot=/usr` directly would add the Linux host's
  `/usr/include` and `/usr/lib`).

## MSVC Targets

`x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` (and their
`-unknown-windows-msvc`, `-windows-msvc` and `arm64-*` spellings) build for the
MSVC ABI, which is required when linking libraries compiled with MSVC,
COM-heavy code or Windows vendor SDKs. Fetch Microsoft's CRT, STL and Windows
SDK once with `xclang sdk fetch windows --accept-license`; then build from any
host with `clang++` or `clang-cl`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch windows --accept-license
clang++ -O2 --target=x86_64-pc-windows-msvc hello.cpp -o hello-msvc-x64.exe
clang-cl /O2 /EHsc hello.cpp /Fehello-cl.exe
clang-cl /O2 /EHsc --target=aarch64-pc-windows-msvc hello.cpp /Fehello-cl-arm64.exe
```

- **Selecting SDK versions**: by default, `xclang sdk fetch windows` fetches the
  `windows-latest` preset (`windows-2025-vs2026`: MSVC 14.51 and Windows SDK
  10.0.26100). Pass `--preset windows-2022` for that runner image's toolset
  (MSVC 14.44), or pass `--msvc-version`, `--sdk-version` and `--arch x86_64,aarch64,x86`.
  `xclang sdk use <name>` switches the active SDK (`<toolchain>/sdk/windows`)
  ([the `xclang` command](../reference/xclang-command.md)).
- **Without a fetched SDK**: on a Windows host, `clang` and `clang-cl` find an
  installed Visual Studio and Windows SDK just as upstream `clang` does
  (passing `--no-default-config` also uses Visual Studio even when an SDK is
  fetched). On Linux and macOS hosts, the target config files point `clang` at
  `<toolchain>/sdk/windows` regardless, so `clang` never reads host directories
  from `INCLUDE`, `LIB` or a `cl.exe` on `PATH`; compiling a file that includes
  a CRT header stops immediately (`'stdio.h' file not found`, with `-v` showing
  where `clang` looked), while freestanding compiles (`-ffreestanding`) work
  without an SDK.

### `clang-cl`

A plain `clang-cl` command reads `<host-triple>-clang-cl.cfg` before switching
to its MSVC target triple. xclang makes that file the `clang-cl` config file of
the host architecture's MSVC target, so `clang-cl` builds for the host
architecture against the fetched SDK without `--target`.

On macOS, `clang-cl` takes an input such as `/Users/me/hello.cpp` for its
`/U` option: put inputs after `--`, or name them with `/Tp`.

In [CMake](../integrations/cmake.md) and [Bazel](../integrations/bazel.md),
xclang compiles and links the MSVC targets with the GNU-style `clang++` driver
rather than `clang-cl`. Linking through `clang++` reads the target config file
on every link, whereas CMake with `clang-cl` invokes `lld-link` directly (which
reads no config file) and requires `mt.exe` for manifests (which xclang omits
because `llvm-mt` depends on `libxml2`).

### libc++ and Microsoft's STL

The MSVC targets use xclang's `libc++` by default (`import std` included), so
every target shares one C++ standard library and consistent behavior for
`std::format`, `<filesystem>` and containers.

Pass `-stdlib=platform` (in `clang-cl`, `/clang:-stdlib=platform`) to use
Microsoft's STL from the fetched SDK or Visual Studio instead, when passing C++
types across an interface to a library built with MSVC
([cross-compiling](cross-compiling.md#the-platform-s-c-library)).

`clang` defaults to C++14 for MSVC targets, matching `cl.exe`. Microsoft's STL
exposes some C++17 library templates such as `std::is_integral_v` in C++14
mode, whereas `libc++` provides them only from C++17 onward; pass `-std=c++17`
(`/std:c++17`) or later when code relies on them.

### The Hybrid CRT and C Runtime Flags

By default, a binary links `libc++` (or Microsoft's STL) and the VC runtime
(`libvcruntime.lib` and `libcmt.lib`) statically, and links UCRT dynamically
against Windows' `ucrtbase.dll` (`api-ms-win-crt-*`). Microsoft calls this the
hybrid CRT: the binary needs no `vcruntime140.dll` or `msvcp140.dll`
redistributable ([hermeticity](../design/hermeticity.md)), while sharing one
heap, `errno` and `stdio` with every DLL in the process.

To select another C runtime with either `libc++` or Microsoft's STL:

| C runtime | `clang`, `clang++` | `clang-cl` |
|---|---|---|
| hybrid CRT (default) | (default) | `/MT` (default) |
| DLL runtime (`vcruntime140.dll`, plus `msvcp140.dll` with the STL) | `-fms-runtime-lib=dll` | `/MD` |
| all static, UCRT included | `-Wl,/nodefaultlib:ucrt.lib -llibucrt` | `/link /nodefaultlib:ucrt.lib libucrt.lib` |
| static debug CRT | `-fms-runtime-lib=static_dbg -Wl,/nodefaultlib:ucrt.lib` | `/MTd /link /nodefaultlib:ucrt.lib` |

The debug CRTs are Visual Studio's debug libraries for the build machine;
`/MDd` loads `ucrtbased.dll`, which only Visual Studio installs.

## Sanitizers

Both the MinGW and MSVC targets support UndefinedBehaviorSanitizer on `x86_64`
and `aarch64` and AddressSanitizer (with the ASan `libc++`) on `x86_64`; the
`x86_64` MSVC target also supports libFuzzer
([sanitizers](../features/sanitizers.md)).

## How the Windows SDK and MSVC Runtimes Work

### Microsoft's SDK without Visual Studio

`xclang sdk fetch windows` downloads the MSVC CRT and STL from Visual Studio's
`.vsix` packages (listed in Visual Studio's channel manifest) and the Windows
SDK from NuGet's `Microsoft.Windows.SDK.CPP` packages, pinned in
`xclang/sdk-versions.json`. Whereas Visual Studio's
installer and tools such as `xwin` unpack MSI and CAB files (and `xwin` has no
macOS or Windows-on-Arm binaries), both `.vsix` and `.nupkg` packages are zip
archives that `xclang` unpacks with its own code on every host.

The unpacked directory (`<toolchain>/sdk/windows-msvc<ver>-sdk<ver>`) is laid
out as a `/winsysroot` tree matching a Visual Studio installation: the CRT and
STL headers, the STL's `std.ixx` and `std.compat.ixx` module sources, the
per-architecture static and DLL runtime libraries, the `.pdb` files of the
static runtime (which debug links look for and warn with `LNK4099` if absent),
and the Windows SDK headers and import libraries (`um`, `ucrt`, `shared`,
`winrt`, `cppwinrt`). Download and unpacked sizes are listed in
[the `xclang` command](../reference/xclang-command.md).

### Config Files and Object Directives

A `clang` config file has no conditionals and fails to load if an included
`@file` does not exist. The MSVC target config files therefore include
`bin/<triple>-sdk.cfg` (and `<triple>-clang-cl-sdk.cfg`), which is empty in the
release archive and rewritten by `xclang sdk fetch`, `use` and `remove` to
include the per-architecture config file inside `sdk/windows`.

The MSVC target config files also record linker directives in every compiled
object file:

- `--dependent-lib=clang_rt.builtins-<arch>.lib`: neither `clang` nor
  `clang-cl` links `compiler-rt` builtins automatically on MSVC targets, and
  without them `__int128` division fails to link.
- `--linker-option=/nodefaultlib:libucrt.lib` and `--dependent-lib=ucrt.lib`:
  the hybrid CRT, named inside each object so `lld-link` honours it even when a build system invokes `lld-link`
  directly. Because `lld-link` reads an object's directives in order and the
  objects name `ucrt.lib` first, switching to `/MTd` or static UCRT passes
  `/nodefaultlib:ucrt.lib` on the link command line (`/MD` uses `ucrt.lib`
  already).
- `-D_STATIC_INLINE_UCRT_FUNCTIONS=0`: UCRT declares functions such as `ctime`,
  `localtime` and `difftime` as `static inline` unless
  `_STATIC_INLINE_UCRT_FUNCTIONS` is `0` (MSVC 19.50 makes `1` the default). A
  C++ module cannot export a function with internal linkage, so the config files
  define `_STATIC_INLINE_UCRT_FUNCTIONS=0` to allow `import std` to build.

### `libc++` on `vcruntime`

xclang builds `libc++` and `compiler-rt` for both MSVC architectures with
`clang-cl` against the `windows-2022` SDK (MSVC 14.44), since newer MSVC
toolsets link libraries built against older ones:

- **Built on `vcruntime`**: `libc++` uses Microsoft's `vcruntime` as its ABI
  library rather than `libc++abi` and `libunwind`; `vcruntime` handles
  exceptions, RTTI and `operator new`, while UCRT is the C library.
  [Patch 0016](../reference/patches.md) gives `libc++` its own
  `std::set_new_handler` without Microsoft's STL library and drops its duplicate
  `std::nothrow` definition.
- **One library for every CRT**: `libc++` is compiled with `/MT /Zl` so it embeds
  no default C runtime directive; its calls to UCRT and `vcruntime` resolve
  against either the static libraries or the DLL import libraries. It is also
  built with `_CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS` rather than
  `_CRT_STDIO_ISO_WIDE_SPECIFIERS`, avoiding `/failifmismatch` errors when
  linked with objects that use Microsoft's default wide `printf` specifiers.
  The single `lib/clang/<major>/lib/windows/libc++-<arch>.lib` therefore links
  with the hybrid CRT, `/MT`, `/MD` and the debug CRTs alike.
- **Auto-linked by `#pragma comment(lib, ...)`**: `libc++-<arch>.lib` lives next
  to `compiler-rt` in `lib/clang/<major>/lib/windows/`, the directory `lld-link`
  searches on its own, and the target's `__config_site` names it with
  `#pragma comment(lib, ...)`. Every translation unit that includes a `libc++`
  header links `libc++-<arch>.lib` automatically (even when CMake or MSBuild
  invokes `lld-link` directly), while C objects and `-stdlib=platform` objects
  do not.
- **`-stdlib++-isystem` and `import std`**: `clang`'s MSVC toolchain ignores
  `-stdlib=`, so the default config files supply `libc++`'s headers via
  `-stdlib++-isystem` (`/clang:-stdlib++-isystem` in `clang-cl`, silenced on C
  compiles by [patch 0011](../reference/patches.md)). Passing
  `-stdlib=platform` switches to `<triple>-system.cfg`
  ([patch 0018](../reference/patches.md)), which omits `-stdlib++-isystem` so
  `clang` finds the SDK's STL headers. For `import std`, the CMake package
  takes `libc++`'s module manifest from `<target>/lib/libc++.modules.json` and
  `<target>/share/libc++/v1` (since `clang -print-library-module-manifest-path`
  looks only for `libc++.a`), and with `-stdlib=platform` compiles the STL's
  `std.ixx` and `std.compat.ixx` (including `<malloc.h>` before the module on
  `arm64` so `_alloca` is not declared twice).

## The Launchers

Windows toolchain archives contain no symbolic links because creating symbolic
links on Windows requires Developer Mode or Administrator privileges, and conda
packages for Windows cannot carry them. Instead, each tool executable in `bin/`
(`clang.exe`, `clang++.exe`, `ld.lld.exe`, ...) is a small launcher compiled
from
[`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c)
that spawns `llvm.exe <name> <arguments>`:

- **Subcommand name**: the multicall `llvm` binary selects its tool from the
  invocation name, and on Windows LLVM replaces `argv[0]` with the file name of
  its own module (`llvm.exe`) before inspecting it. Passing `<name>` as the
  first argument preserves the tool identity (`clang++` vs `clang`, `ld.lld` vs
  generic `lld`).
- **Kill-on-close job object**: the launcher creates `llvm.exe` directly inside
  a kill-on-close Windows job object (`PROC_THREAD_ATTRIBUTE_JOB_LIST`), so
  when a build system times out or kills the launcher, the compiler process is
  terminated with it without leaving suspended processes holding handles or
  working directories.
- **Process creation cost**: each compile starts two processes instead of one.
  That overhead is visible on tiny C files that compile in milliseconds and
  negligible on C++ translation units ([PGO](../design/pgo.md)). Build tools
  that want to avoid the extra process start can invoke `llvm.exe clang++ ...`
  directly.

## `gc-sections` and Static Initializers

On MinGW targets, `ld.lld --gc-sections` discards COMDAT sections whose symbols
nothing references, including the static initializers that register inline or
templated test cases. On ELF targets `.init_array` is a garbage-collection root
so those initializers are kept; on MinGW `[[gnu::used]]` does not emit a linker
`/include` directive. In clice, enabling `--gc-sections` for MinGW silently
reduced the Windows unit test count from 1,619 to 1,551 as two test suites
stopped registering, while leaving it off increased the stripped test binary
from 64 MB to 82 MB.

The Bazel module therefore enables `gc_sections` in optimized builds for Linux
targets and leaves it off for Windows targets (`--features=gc_sections` opts in
when a target does not rely on unreferenced COMDAT initializers). In other build
systems, avoid passing `-Wl,--gc-sections` for MinGW targets unless the same
holds.

## Case-Sensitive Headers

Windows file systems are case-insensitive, so Windows code often writes
`#include <Windows.h>`, `<BaseTsd.h>` or `<WinSock2.h>`, whereas MinGW-w64's
header files are lowercase (`windows.h`, `basetsd.h`, `winsock2.h`). xclang does
not add mixed-case links to the MinGW sysroots; use the lowercase header names
so MinGW builds succeed on case-sensitive Linux file systems.

Microsoft's own CRT, STL and Windows SDK headers and import libraries use mixed
spellings internally. When `xclang sdk fetch windows` unpacks the Windows SDK on
a case-sensitive file system, it creates around 3,600 links (`windows.h`,
`winbase.h` for `WinBase.h`, `libcmt.lib` for `LIBCMT.lib`, and others) so
Windows code builds without changes.

## Visual Studio and `compiler-rt`

- **Finding Visual Studio from a MinGW-built `clang`**: upstream LLVM builds the
  Visual Studio Setup API lookup only when compiled with MSVC; a MinGW-built
  `clang` fell back to registry keys for Visual Studio 2010 and older.
  [Patch 0004](../reference/patches.md) (`llvm/llvm-project#226794`) enables the
  Setup API lookup on MinGW so `clang` and `libclang`-based tools such as clice
  find Visual Studio 2017 and later on Windows hosts.
- **`compiler-rt` before Visual Studio's**: on a Windows host without a fetched
  SDK, upstream `clang` passed Visual Studio's library directory to `lld-link`
  before xclang's `compiler-rt` directory, so Visual Studio's own
  `clang_rt.*.lib` shadowed xclang's and broke `__int128` division, UBSan and
  libFuzzer on Visual Studio 18 (MSVC 14.51).
  [Patch 0012](../reference/patches.md) places xclang's `compiler-rt` directory
  first.

## The Same Bytes from Every Link

xclang omits PE/COFF link timestamps ([patch 0014](../reference/patches.md)) so
repeated links produce identical binaries. In large PGO and ThinLTO links (such
as clice's 600 MB `clice.exe`), `lld-link` previously indexed call-graph
profile ordering by function name, causing `static` functions with the same
name in different objects to overwrite one another's profile weight depending
on hash-table memory addresses; [patch 0017](../reference/patches.md) keeps the
first entry so every link produces the same bytes.

## ASan's DLL

`compiler-rt` builds only a dynamic AddressSanitizer runtime on Windows, for
MinGW and MSVC targets alike: `libclang_rt.asan_dynamic.dll` and
`clang_rt.asan_dynamic-x86_64.dll`. Every
ASan-instrumented binary loads that DLL at startup from its own directory or
`PATH`, as a test-only exception to [hermeticity](../design/hermeticity.md):

- **MinGW's ASan DLL links `libc++` and `libunwind` statically**: unlike
  `llvm-mingw`'s ASan DLL, which loads `libc++.dll`, xclang's DLL depends only
  on Windows system DLLs and UCRT, while the program links the ASan-instrumented
  `libc++` ([sanitizers](../features/sanitizers.md)).
- **Included in `bin/` on the `x86_64` Windows host**: the `x86_64` Windows
  toolchain archive places copies of both the MinGW and MSVC ASan DLLs in
  `bin/`, so ASan binaries find their runtime whenever the toolchain is on
  `PATH`. When copying an ASan binary to another machine, copy the DLL beside
  it.
- **Copied beside binaries in Bazel**: a Bazel build with `--features=asan`
  receives the DLL from `@bazel_tools//tools/cpp:cc_runtimes_toolchain_type`,
  and the `copy_dynamic_libraries_to_binary` feature copies it next to the
  binary in `bazel-bin` and in its runfiles for `bazel run` and `bazel test`.
- **Not supported under Windows on Arm's `x86_64` emulator**: an `x86_64` ASan
  binary cannot intercept UCRT functions when running under `arm64` Windows'
  emulation of `x86_64`.

## Limitations

- **Windows 10 or later**: both MinGW and MSVC targets use UCRT, a part of
  Windows 10 and later. Support for
  [Windows 7 and XP](../design/roadmap.md#windows-7) is in research, and a MinGW
  target on `msvcrt.dll` is [not planned](../design/roadmap.md#msvcrt).
- **Other Windows targets and runtimes**: 32-bit
  [`i686-pc-windows-msvc`](../design/roadmap.md#windows-x86-msvc) is in
  research, [`i686-w64-mingw32`](../design/roadmap.md#windows-x86-mingw) and
  [`arm64ec-pc-windows-msvc`](../design/roadmap.md#arm64ec) are considered, and
  [building runtimes from source for the MSVC targets](../design/roadmap.md#runtimes-msvc)
  is planned.
