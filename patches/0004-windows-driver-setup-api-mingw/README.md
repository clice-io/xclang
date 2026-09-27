# Visual Studio lookup through the Setup API on MinGW

clang finds Visual Studio 2017 and later through the Visual Studio Setup
API (`findVCToolChainViaSetupConfig`, llvm/lib/WindowsDriver/MSVCPaths.cpp),
which LLVM builds only with MSVC (`#ifdef _MSC_VER`, since 2017's "Don't
use MSVC Setup Api on MinGW"). A MinGW-built clang, and every tool built
on its libraries, then falls back to the registry and finds the include
directories of Visual Studio 2010, 2008 and 2005 instead, unless a
Developer Command Prompt set `VCToolsInstallDir` or put `cl.exe` in PATH
([clice#714](https://github.com/clice-io/clice/issues/714)).

mingw-w64 has the COM support classes the lookup uses (comdef.h, comip.h,
comutil.h, also without exceptions). What it lacks is the interface IDs:
its `__uuidof` is emulated (always, unless `_MSC_VER`) and takes them from
`__CRT_UUID_DECL`, not from `DECLSPEC_UUID`. The patch enables the lookup
on MinGW, declares the IDs, and links LLVMWindowsDriver with ole32 and
oleaut32.

Everything else of the MSVC environment (the Windows SDK, the UCRT,
ATL/MFC, lld-link's library paths, `_MSC_VER` from `cl.exe`'s version)
is looked up only once the VC tools are found, with code that is the same
on MinGW; without them a MinGW-built clang also fell back to a hard-coded
list of Visual Studio 2010 to 2005 directories (clang's MSVC.cpp).

- Upstream: [#226794](https://github.com/llvm/llvm-project/pull/226794),
  this patch as sent. GCC needs no pragma of its own: LLVM turns on
  `-Wnon-virtual-dtor` only for clang. Separately, not reported:
  `sys::InitializeCOMRAII` calls `CoUninitialize` even when
  `CoInitializeEx` failed (a thread already in another apartment), which
  releases the caller's reference; the same in MSVC builds.
- Checked: MSVCPaths.cpp compiles without warnings for x86_64 and aarch64
  MinGW, with and without `-fms-extensions`, every `__uuidof` resolves, and
  the seven IDs match MSVCSetupApi.h's `DECLSPEC_UUID`s. The lookup,
  built for MinGW with xclang, found Visual Studio 18 on windows-2025 and
  Visual Studio 2022 on windows-11-arm with no Visual Studio environment,
  as LLVM's MSVC-built clang does, where xclang 23.1.2.2's clang found
  Visual Studio 2010's directories.
