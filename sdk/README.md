# Vendor SDKs, fetched by the user (probe)

Cross-compiling for macOS and for the MSVC ABI from any host with xclang
23.1.2.5, against SDKs downloaded from Apple and Microsoft themselves after
the user accepts their licenses. xclang distributes neither.
`vendor-sdk.py` (Python, standard library only) fetches both, on any host,
with a generic User-Agent (`xclang-vendor-sdk`);
`.github/workflows/sdk-fetch.yml` runs it all; nothing of an SDK leaves the
job that downloaded it.

## Versions

`versions.json` lists every version the vendors offer: where each package
is, its size and sha256, nothing from inside the packages but the version of
the macOS SDK a Command Line Tools package carries. `update-versions.py`
makes it and only ever appends (2 min on CI, `sdk-table.yml`):

- **Windows SDK**: the 38 stable `Microsoft.Windows.SDK.CPP` versions on
  nuget.org, 10.0.17763.4 to 10.0.28000.2705, each with its `.x64`, `.arm64`
  and `.x86` package; sha256 computed (nuget.org gives SHA-512 only).
- **MSVC**: the 20 toolsets of Visual Studio's stable channels, 14.29.16.10
  to 14.52: VS 2026 (`aka.ms/vs/18/stable`, 18.10.3) carries 14.29 to 14.52
  (14.51 by default; its packages have two-part versions, `14.51`), VS 2022
  the same up to 14.44, VS 2019 (16.11.60) 14.29.16.10 too; a
  toolset comes from the newest channel that has it (each signs its own
  copy). Per architecture (x64, arm64, x86) the `Desktop`, `Store` and, for
  arm64, `Desktop.debug` packages, with the sha256 the vsman lists. The
  channel manifests and vsmans are pinned too; the CDN serves each vsman
  smaller than the size and sha256 its channel manifest lists, whatever the
  request, so the table pins what it serves (and keeps the listed values),
  and takes each vsix's size from the CDN, not the vsman.
- **macOS SDK**: the 29 distinct SDK packages of Apple's catalogs (macOS
  10.14 to 27 catalogs; `CLTools_macOSNMOS_SDK.pkg`, `..LMOS..` and, from
  2019, `CLTools_SDK_macOS1014.pkg`), 16 SDK versions from 10.14 to 27.0;
  when several packages carry one version, the newest product's comes first.

**Presets** are what GitHub's runner images build with, read from
actions/runner-images' software lists (its README's labels, each image's
Visual Studio and Windows SDK, or default Xcode and that Xcode's macOS SDK);
a Visual Studio's MSVC is the one its `VC.Tools.x86.x64` component installs,
found in its channel's vsman. Unlike versions, presets follow the images:
each records the image, its labels, the image version it mirrors and the
day that was read (`read`, kept while the preset stays the same).

| preset | labels | versions |
|---|---|---|
| windows-2025-vs2026 | `windows-latest`, `windows-2025`, `windows-2025-vs2026` | VS 2026 18.10: MSVC 14.51, SDK 10.0.26100.8249 |
| windows-11-vs2026-arm64 | `windows-11-vs2026-arm` | the same |
| windows-2022 | `windows-2022` | VS 2022 17.14: MSVC 14.44, SDK 10.0.26100.7705 |
| windows-11-arm64 | `windows-11-arm` | the same |
| macOS-26-arm64, macOS-26 | `macos-latest`, `macos-26`, `macos-26-intel`, ... | Xcode 26.6: SDK 26.5 |
| macOS-15-arm64, macOS-15 | `macos-15`, `macos-15-intel`, ... | Xcode 16.4: SDK 15.5 |
| xcode-27 | `xcode-27`, `xcode-27-xlarge` | Xcode 27.0: SDK 27.0 (xclang cannot use it yet) |

`vendor-sdk.py` takes the `windows-latest` and `macos-latest` presets
unless told otherwise, rather than the newest versions xclang works with:
what a workflow gets without naming an image, so a cross build matches the
native build most CI users have. For macOS the two are the same (SDK 26.5).
For Windows the newest (MSVC 14.52, SDK 10.0.28000) are on no image, not
even Visual Studio 2026's default, and give nothing the preset lacks: the
STL of MSVC 14.50 and later, 14.51 and 14.52 alike, supports Windows 10 and
later only. `--preset windows-2022` (MSVC 14.44) is the one for programs
that also run on Windows 7 SP1 and 8.1. `--preset` names another (an image or any of its
labels); `--version`, `--sdk-version`, `--msvc-version` (whole or in part:
`26`, `10.0.26100`, `14.44`) replace a preset's; `macos list` and
`windows list` show presets and versions.

`sdk-versions.yml` checks all of it:

- all 345 packages download with their size and sha256 and hold what the
  tool takes from them;
- every Windows SDK with the newest MSVC (14.52), and every MSVC with the
  newest SDK (10.0.28000), builds C and C++ (MSVC STL, /MT and /MD) hello
  programs for x64 and arm64 on Linux, which run on windows-2025 and
  windows-11-arm: all 38 SDKs and all 20 toolsets work;
- each preset builds the hello programs and kotatsu for both architectures,
  which run and pass (xcode-27's SDK 27.0 excepted);
- kotatsu, with the newest of each SDK line (10.0.17763 ... 10.0.28000) and
  MSVC 14.52, and with MSVC 14.44: builds and passes its tests on both. With
  MSVC 14.29 (VS 2019) it does not build: its STL has no `<expected>`, which
  kotatsu (C++23) needs and MSVC has from 14.33;
- every macOS SDK builds C and C++ hello programs for arm64 and x86_64,
  which run on macos-15 and macos-15-intel, and kotatsu with the newest of
  each major: 11.1 to 26.5 work for both (kotatsu: 11.3 ... 26.5). 10.15.6
  has no arm64 (it predates Apple silicon): x86_64 only, kotatsu included.
  10.14 builds C only: xclang's libc++ calls `aligned_alloc`, which 10.14's
  `libSystem` does not have (macOS 10.15 does). 27.0 fails (`arm64e.x1`).

Oldest that works with xclang 23.1.2.5: Windows SDK 10.0.17763.4 (the
oldest on nuget.org), MSVC 14.29.16.10 (the oldest offered), macOS SDK 11.1
(10.15.6 for x86_64).

## macOS

```sh
python3 sdk/vendor-sdk.py macos list        # the versions of versions.json
python3 sdk/vendor-sdk.py macos fetch --accept-license [--version 26.5] --out MacOSX.sdk
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
python3 sdk/vendor-sdk.py windows list      # the versions of versions.json
python3 sdk/vendor-sdk.py windows fetch --accept-license [--sdk-version 10.0.26100] [--msvc-version 14.44] \
  [--arch x86_64,aarch64,x86] --out winsysroot
clang-cl --target=x86_64-pc-windows-msvc /winsysroot winsysroot -fuse-ld=lld /EHsc -- main.cpp
clang++ --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root winsysroot -fuse-ld=lld main.cpp
```

- **Source**, all plain zips (what the first probe pinned; versions.json
  now lists every version):
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
