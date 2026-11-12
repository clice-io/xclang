# Windows

How xclang's MinGW and MSVC Windows targets, the Windows host toolchains,
and `xclang sdk fetch windows` are built and configured. How to compile for
Windows targets is in [cross-compiling](../guide/cross-compiling.md#windows).

## Why MinGW and MSVC

xclang provides two pairs of Windows targets because they serve different
ABIs:

- **MinGW targets** (`x86_64-w64-mingw32` and `aarch64-w64-mingw32`): use
  the Itanium C++ ABI with MinGW-w64 14.0.0 configured on UCRT
  (`--with-default-msvcrt=ucrt`, `--with-default-win32-winnt=0x0A00`).
  Because MinGW-w64's headers and import libraries are redistributable,
  their sysroots, `libc++`, `libc++abi`, `libunwind`, `winpthreads`
  (`libpthread.a`) and `compiler-rt` ship in every toolchain archive and
  link statically with `ld.lld` out of the box
  ([hermeticity](hermeticity.md)).
- **MSVC targets** (`x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`):
  use the Microsoft C++ ABI and link with `lld-link` against Microsoft's
  CRT and the Windows SDK, fetched once with `xclang sdk fetch windows` or
  taken from an installed Visual Studio on Windows. Use the MSVC targets
  when linking libraries compiled with MSVC, COM-heavy code or Windows
  vendor SDKs.

The Windows host toolchains (`x86_64-w64-mingw32` and `aarch64-w64-mingw32`)
are themselves MinGW programs cross-compiled on Linux x64 with PGO and
ThinLTO ([PGO](pgo.md)).

## The SDK without Visual Studio

`xclang sdk fetch windows` downloads the MSVC CRT and STL from Visual
Studio's `.vsix` packages (listed in Visual Studio's channel manifest) and
the Windows SDK from NuGet's `Microsoft.Windows.SDK.CPP` packages, pinned in
`xclang/sdk-versions.json`. Whereas Visual Studio's installer and tools such
as `xwin` unpack MSI and CAB files (and `xwin` has no macOS or
Windows-on-Arm binaries), both `.vsix` and `.nupkg` packages are zip
archives that `xclang` unpacks with its own code on every host.

The unpacked directory (`<toolchain>/sdk/windows-msvc<ver>-sdk<ver>`) is
laid out as a `/winsysroot` tree matching a Visual Studio installation: the
CRT and STL headers, the STL's `std.ixx` and `std.compat.ixx` module
sources, the per-architecture static and DLL runtime libraries, the `.pdb`
files of the static runtime (which debug links look for and warn with
`LNK4099` if absent), and the Windows SDK headers and import libraries
(`um`, `ucrt`, `shared`, `winrt`, `cppwinrt`;
[the `xclang` command](../reference/xclang-command.md)).

### Config Files and Object Directives

A `clang` config file has no conditionals and fails to load if an included
`@file` does not exist. The MSVC target config files therefore include
`bin/<triple>-sdk.cfg` (and `<triple>-clang-cl-sdk.cfg`), which is empty in
the release archive and rewritten by `xclang sdk fetch`, `use` and `remove`
to include the per-architecture config file inside `sdk/windows`
([toolchain structure](toolchain.md)).

The MSVC target config files also record linker directives in every compiled
object file:

- `--dependent-lib=clang_rt.builtins-<arch>.lib`: neither `clang` nor
  `clang-cl` links `compiler-rt` builtins automatically on MSVC targets, and
  without them `__int128` division fails to link.
- `--linker-option=/nodefaultlib:libucrt.lib` and
  `--dependent-lib=ucrt.lib`: the hybrid CRT, named inside each object so
  `lld-link` honours it even when a build system invokes `lld-link`
  directly. Because `lld-link` reads an object's directives in order and the
  objects name `ucrt.lib` first, switching to `/MTd` or static UCRT passes
  `/nodefaultlib:ucrt.lib` on the link command line (`/MD` uses `ucrt.lib`
  already).
- `-D_STATIC_INLINE_UCRT_FUNCTIONS=0`: UCRT declares functions such as
  `ctime`, `localtime` and `difftime` as `static inline` unless
  `_STATIC_INLINE_UCRT_FUNCTIONS` is `0` (MSVC 19.50 makes `1` the default).
  A C++ module cannot export a function with internal linkage, so the config
  files define `_STATIC_INLINE_UCRT_FUNCTIONS=0` to allow `import std` to
  build.

In [CMake](../integrations/cmake.md) and [Bazel](../integrations/bazel.md),
xclang compiles and links the MSVC targets with the GNU-style `clang++`
driver rather than `clang-cl`. Linking through `clang++` reads the target
config file on every link, whereas CMake with `clang-cl` invokes `lld-link`
directly (which reads no config file) and requires `mt.exe` for manifests
(which xclang omits because `llvm-mt` depends on `libxml2`).

## The Hybrid CRT

By default on MSVC targets, a binary links `libc++` (or Microsoft's STL) and
the VC runtime (`libvcruntime.lib` and `libcmt.lib`) statically, and links
UCRT dynamically against Windows' `ucrtbase.dll` (`api-ms-win-crt-*`).
Microsoft calls this the hybrid CRT: the binary needs no `vcruntime140.dll`
or `msvcp140.dll` redistributable ([hermeticity](hermeticity.md)), while
sharing one heap, `errno` and `stdio` with every DLL in the process. The
flags for selecting another C runtime are in
[cross-compiling](../guide/cross-compiling.md#msvc-targets).

## `libc++` on `vcruntime`

xclang builds `libc++` and `compiler-rt` for both MSVC architectures with
`clang-cl` against the `windows-2022` SDK (MSVC 14.44), since newer MSVC
toolsets link libraries built against older ones:

- **Built on `vcruntime`**: `libc++` uses Microsoft's `vcruntime` as its ABI
  library rather than `libc++abi` and `libunwind`; `vcruntime` handles
  exceptions, RTTI and `operator new`, while UCRT is the C library.
  [Patch 0016](../reference/patches.md) gives `libc++` its own
  `std::set_new_handler` without Microsoft's STL library and drops its
  duplicate `std::nothrow` definition.
- **One library for every CRT**: `libc++` is compiled with `/MT /Zl` so it
  embeds no default C runtime directive; its calls to UCRT and `vcruntime`
  resolve against either the static libraries or the DLL import libraries.
  It is also built with `_CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS` rather than
  `_CRT_STDIO_ISO_WIDE_SPECIFIERS`, avoiding `/failifmismatch` errors when
  linked with objects that use Microsoft's default wide `printf` specifiers.
  The single `lib/clang/<major>/lib/windows/libc++-<arch>.lib` therefore
  links with the hybrid CRT, `/MT`, `/MD` and the debug CRTs alike.
- **Auto-linked by `#pragma comment(lib, ...)`**: `libc++-<arch>.lib` lives
  next to `compiler-rt` in `lib/clang/<major>/lib/windows/`, the directory
  `lld-link` searches on its own, and the target's `__config_site` names it
  with `#pragma comment(lib, ...)`. Every translation unit that includes a
  `libc++` header links `libc++-<arch>.lib` automatically (even when CMake
  or MSBuild invokes `lld-link` directly), while C objects and
  `-stdlib=platform` objects do not.
- **`-stdlib++-isystem` and `import std`**: `clang`'s MSVC toolchain ignores
  `-stdlib=`, so the default config files supply `libc++`'s headers via
  `-stdlib++-isystem` (`/clang:-stdlib++-isystem` in `clang-cl`, silenced on
  C compiles by [patch 0011](../reference/patches.md)). Passing
  `-stdlib=platform` switches to `<triple>-system.cfg`
  ([patch 0018](../reference/patches.md)), which omits `-stdlib++-isystem`
  so `clang` finds the SDK's STL headers. For `import std`, the CMake
  package takes `libc++`'s module manifest from
  `<target>/lib/libc++.modules.json` and `<target>/share/libc++/v1` (since
  `clang -print-library-module-manifest-path` looks only for `libc++.a`),
  and with `-stdlib=platform` compiles the STL's `std.ixx` and
  `std.compat.ixx` (including `<malloc.h>` before the module on `arm64` so
  `_alloca` is not declared twice).

## The Launchers

Windows toolchain archives contain no symbolic links because creating
symbolic links on Windows requires Developer Mode or Administrator
privileges, and conda packages for Windows cannot carry them. Instead, each
tool executable in `bin/` (`clang.exe`, `clang++.exe`, `ld.lld.exe`, ...) is
a small launcher compiled from
[`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c)
that spawns `llvm.exe <name> <arguments>`:

- **Subcommand name**: the multicall `llvm` binary selects its tool from the
  invocation name, and on Windows LLVM replaces `argv[0]` with the file name
  of its own module (`llvm.exe`) before inspecting it. Passing `<name>` as
  the first argument preserves the tool identity (`clang++` vs `clang`,
  `ld.lld` vs generic `lld`).
- **Kill-on-close job object**: the launcher creates `llvm.exe` directly
  inside a kill-on-close Windows job object
  (`PROC_THREAD_ATTRIBUTE_JOB_LIST`), so when a build system times out or
  kills the launcher, the compiler process is terminated with it without
  leaving suspended processes holding handles or working directories.
- **Process creation cost**: each compile starts two processes instead of
  one. That overhead is visible on tiny C files that compile in milliseconds
  and negligible on C++ translation units ([PGO](pgo.md)). Build tools that
  want to avoid the extra process start can invoke `llvm.exe clang++ ...`
  directly.

## `gc-sections` and Static Initializers

On MinGW targets, `ld.lld --gc-sections` discards COMDAT sections whose
symbols nothing references, including the static initializers that register
inline or templated test cases. On ELF targets `.init_array` is a
garbage-collection root so those initializers are kept; on MinGW
`[[gnu::used]]` does not emit a linker `/include` directive. In clice,
enabling `--gc-sections` for MinGW silently reduced the Windows unit test
count from 1,619 to 1,551 as two test suites stopped registering, while
leaving it off increased the stripped test binary from 64 MB to 82 MB.

The Bazel module therefore enables `gc_sections` in optimized builds for
Linux targets and leaves it off for Windows targets (`--features=gc_sections`
opts in when a target does not rely on unreferenced COMDAT initializers).

## Case-Sensitive Headers

Windows file systems are case-insensitive, so Windows code often writes
`#include <Windows.h>`, `<BaseTsd.h>` or `<WinSock2.h>`, whereas MinGW-w64's
header files are lowercase (`windows.h`, `basetsd.h`, `winsock2.h`). xclang
does not add mixed-case links to the MinGW sysroots; MinGW code must use
lowercase header names on case-sensitive Linux file systems.

Microsoft's own CRT, STL and Windows SDK headers and import libraries use
mixed spellings internally. When `xclang sdk fetch windows` unpacks the
Windows SDK on a case-sensitive file system, it creates around 3,600 links
(`windows.h`, `winbase.h` for `WinBase.h`, `libcmt.lib` for `LIBCMT.lib`,
`BaseTsd.h`, `Mstcpip.h`, `Kernel32.lib`, `Iphlpapi.lib`, and others) so
Windows code builds without changes.

## Visual Studio and `compiler-rt`

- **Finding Visual Studio from a MinGW-built `clang`**: upstream LLVM builds
  the Visual Studio Setup API lookup only when compiled with MSVC; a
  MinGW-built `clang` fell back to registry keys for Visual Studio 2010 and
  older. [Patch 0004](../reference/patches.md) (`llvm/llvm-project#226794`)
  enables the Setup API lookup on MinGW so `clang` and `libclang`-based
  tools such as clice find Visual Studio 2017 and later on Windows hosts.
- **`compiler-rt` before Visual Studio's**: on a Windows host without a
  fetched SDK, upstream `clang` passed Visual Studio's library directory to
  `lld-link` before xclang's `compiler-rt` directory, so Visual Studio's own
  `clang_rt.*.lib` shadowed xclang's and broke `__int128` division, UBSan
  and libFuzzer on Visual Studio 18 (MSVC 14.51).
  [Patch 0012](../reference/patches.md) places xclang's `compiler-rt`
  directory first.

## The Same Bytes from Every Link

xclang omits PE/COFF timestamps ([patch 0014](../reference/patches.md)) so
repeated compiles and links produce identical binaries. In large PGO and
ThinLTO links (such as clice's 600 MB `clice.exe`), `lld-link` previously
indexed call-graph profile ordering by function name, causing `static`
functions with the same name in different objects to overwrite one another's
profile weight depending on hash-table memory addresses;
[patch 0017](../reference/patches.md) keeps the first entry so every link
produces the same bytes.

## ASan's DLL

`compiler-rt` builds only a dynamic AddressSanitizer runtime on Windows, for
MinGW and MSVC targets alike: `libclang_rt.asan_dynamic.dll` and
`clang_rt.asan_dynamic-x86_64.dll`. Every ASan-instrumented binary loads
that DLL at startup from its own directory or `PATH`, as a test-only
exception to [hermeticity](hermeticity.md)
([sanitizers](../features/sanitizers.md)):

- **MinGW's ASan DLL links `libc++` and `libunwind` statically**: unlike
  `llvm-mingw`'s ASan DLL, which loads `libc++.dll`, xclang's MinGW DLL
  depends only on Windows system DLLs and UCRT, while the program links the
  ASan-instrumented `libc++`. MSVC's ASan DLL
  (`clang_rt.asan_dynamic-x86_64.dll`) is linked by `compiler-rt` against
  the dynamic VC runtime (`vcruntime140.dll`).
- **Included in `bin/` on the `x86_64` Windows host**: the `x86_64` Windows
  toolchain archive places copies of both the MinGW and MSVC ASan DLLs in
  `bin/`, so ASan binaries find their runtime whenever the toolchain is on
  `PATH`. When copying an ASan binary to another machine, copy the DLL
  beside it.
- **Copied beside binaries in Bazel**: a Bazel build with `--features=asan`
  receives the DLL from `@bazel_tools//tools/cpp:cc_runtimes_toolchain_type`,
  and the `copy_dynamic_libraries_to_binary` feature copies it next to the
  binary in `bazel-bin` and in its runfiles for `bazel run` and
  `bazel test`.
- **Not supported under Windows on Arm's `x86_64` emulator**: an `x86_64`
  ASan binary cannot intercept UCRT functions when running under `arm64`
  Windows' emulation of `x86_64`.
