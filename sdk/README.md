# Vendor SDKs, fetched by the user (probe)

Cross-compiling for macOS and for the MSVC ABI from any host with xclang
23.1.2.5, against SDKs downloaded from Apple and Microsoft themselves after
the user accepts their licenses. xclang distributes neither.
`vendor-sdk.py` (Python, standard library only) fetches both, on any host;
`.github/workflows/sdk-fetch.yml` runs it all; nothing of an SDK leaves the
job that downloaded it.

## macOS

```sh
python3 sdk/vendor-sdk.py macos catalog     # SDK packages in Apple's catalog
python3 sdk/vendor-sdk.py macos fetch --accept-license --version 26.5 --out MacOSX.sdk
clang++ --target=arm64-apple-macos -isysroot MacOSX.sdk main.cpp -o main
```

- **Source**: the Command Line Tools package `CLTools_macOSNMOS_SDK.pkg` on
  `swcdn.apple.com`, listed in the software update catalog
  (`swscan.apple.com/content/catalogs/others/index-27-26-15-...sucatalog.gz`),
  no Apple ID. Nixpkgs pins the same URLs (`pkgs/by-name/ap/apple-sdk`), by a
  hash of the unpacked tree; here the package's own sha256 is pinned. The
  catalog still lists packages from 2021, so the URLs last.
- **Format**: xar → `Payload` (pbzx: xz chunks) → odc cpio; the SDK is
  `Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk`. Man pages, tools
  and Perl are left out, as Nixpkgs does (`APR::Base64.3pm` cannot exist on
  Windows).
- **Size**: 61.6 MB download, 610 MB unpacked (18.5k files, 7.4k symlinks);
  on CI under 1 s to download, 5 s to unpack on Linux, 15 s on Windows, where
  links become junctions and hard links (no privilege needed; 622 MB; as
  copies 1.9 GB).
- **Works** from Linux and Windows hosts, for arm64 and x86_64, run on
  macOS 15 arm64 and x86_64: C; C++ with exceptions, threads,
  `<filesystem>`, `<format>`; ThinLTO; CoreFoundation; Objective-C with
  Foundation and ARC; `__int128`; the profile runtime; ASan (its dylib next
  to the program); kotatsu's unit and system tests (`darwin.cmake`). arm64
  programs carry ld64.lld's ad-hoc signature, which `codesign --verify`
  accepts. `-isysroot`, `--sysroot` and `SDKROOT` all work.
- **27.0 SDK fails**: its `.tbd` files list the arch `arm64e.x1`, which
  ld64.lld 23.1.2 rejects (`unknown target`); llvm#222721, on release/23.x
  after 23.1.2. The same breaks native builds with Xcode 27.

## Windows, MSVC ABI

```sh
python3 sdk/vendor-sdk.py windows list      # what Microsoft offers now
python3 sdk/vendor-sdk.py windows fetch --accept-license [--arch x86_64,aarch64] --out winsysroot
clang-cl --target=x86_64-pc-windows-msvc /winsysroot winsysroot -fuse-ld=lld /EHsc -- main.cpp
clang++ --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root winsysroot -fuse-ld=lld main.cpp
```

- **Source**, all plain zips, pinned by URL and sha256:
  - MSVC 14.44.17.14 (toolset 14.44.35207), from Visual Studio 17.14.41's
    channel manifest (`aka.ms/vs/17/release/channel` → `VisualStudio.vsman`,
    which lists each package's sha256): the `.vsix` packages
    `CRT.Headers.base` (headers and STL) and per architecture
    `CRT.<arch>.Desktop.base` (static runtime, `setargv.obj`, ...) and
    `CRT.<arch>.Store.base`, which holds the DLL runtime's import libraries
    too (`msvcrt`, `msvcprt`, `vcruntime`, `oldnames`); `store/`, `uwp/`,
    `enclave/` and the `.pdb` files are left out.
  - Windows SDK 10.0.26100.9169, from nuget.org: `Microsoft.Windows.SDK.CPP`
    (`Include/<ver>/{um,shared,ucrt,winrt,cppwinrt}`; its `bin/`, `Redist/`,
    `Source/`, `References/` are left out) and `Microsoft.Windows.SDK.CPP.x64`
    / `.arm64` (`um` and `ucrt` libraries). No MSI or CAB anywhere.
- **License**: `--accept-license` stands for the Visual Studio Build Tools
  license and the Windows SDK's, which the tool names.
- **Layout**: a `/winsysroot`, as Visual Studio installs it:
  `VC/Tools/MSVC/14.44.35207/{include,lib/<x64|arm64>}`,
  `Windows Kits/10/{Include,Lib}/10.0.26100.0/...`.
- **Case**: on a case-sensitive file system (Linux; a macOS or Windows one
  is not), links for what Windows finds whatever the case: every file in
  lower case, every library in upper case (`LIBCMT.lib`), each `#include`
  and `#pragma comment(lib)` of the headers as written (`winbase.h` for
  `WinBase.h`), and xwin's few known spellings (`BaseTsd.h`, `Mstcpip.h`,
  `Kernel32.lib`, `Iphlpapi.lib`): 3.6k links (xwin: 3.5k).
- **Size and time** (both architectures): 512 MB download (x64 only: 295 MB),
  1.44 GB unpacked, 6.2k files. On CI: download 3 s (Linux, Windows) to
  13 s (macOS); unpack 3–5 s (Linux, macOS arm64), 11–13 s (Windows x64,
  macOS x64), 26 s (Windows arm64); links 3 s.
- **Against xwin's splat** (same MSVC, SDK 10.0.26100 from the MSIs): nothing
  missing for what is built here. Not taken: the enclave libraries and the
  C++/CLI `Microsoft.VisualC.STLCLR.dll`. 482 SDK headers differ, NuGet's
  build being a later servicing release (netcx headers moved to
  `netcx/shared/1.0/`); 41 files are new (`corecrt_math.h`, `tgmath.h`,
  `ucrt.osmode*.lib`, ...).
- **Works** from Linux x64 and arm64, macOS arm64 and x64, Windows x64 and
  arm64, for x64 and arm64, run on windows-2025 and windows-11-arm: C; C++
  with the MSVC STL (exceptions, threads, `<filesystem>`, `<format>`; /MT,
  /MD; ThinLTO); both drivers; Win32 API (kernel32, user32, advapi32);
  kotatsu's unit and system tests (`msvc.cmake`).
- **clang-cl on macOS** reads an input path starting with `/U` (`/Users/...`)
  as its `/U` option: inputs go after `--` (CMake does so).
- **Missing in xclang**: compiler-rt for `*-windows-msvc` (`__int128`
  division needs `__udivti3`, which xclang's MinGW builtins do provide; no
  `clang_rt.profile.lib`, no ASan).
- xclang's empty `<host>-clang-cl.cfg` files do not get in the way: clang-cl
  with an MSVC `--target` reads no config file.
