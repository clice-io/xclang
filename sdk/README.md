# Vendor SDKs, fetched by the user (probe)

Cross-compiling for macOS and for the MSVC ABI from any host with xclang
23.1.2.5, against SDKs downloaded from Apple and Microsoft themselves after
the user accepts their licenses. xclang distributes neither.
`.github/workflows/sdk-fetch.yml` runs it all; nothing of an SDK leaves the
job that downloaded it.

## macOS

`macos-sdk.py` (Python, standard library only):

```sh
python3 sdk/macos-sdk.py catalog            # SDK packages in Apple's catalog
python3 sdk/macos-sdk.py fetch --accept-license --version 26.5 --out MacOSX.sdk
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

[xwin](https://github.com/Jake-Shadle/xwin) 0.10.0, `--accept-license`,
splats the MSVC CRT + STL and the Windows SDK in `/winsysroot` layout:

```sh
xwin --accept-license --manifest channel.json --sdk-version 10.0.26100 --crt-version 14.44.17.14 \
  --arch x86_64,aarch64 splat --include-debug-libs --use-winsysroot-style --preserve-ms-arch-notation --output winsysroot
clang-cl --target=x86_64-pc-windows-msvc /winsysroot winsysroot -fuse-ld=lld /EHsc main.cpp
clang++ --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root winsysroot -fuse-ld=lld main.cpp
```

- **Pinning**: the channel manifest behind `aka.ms/vs/17/release/channel`
  (VS 17.14.41) by URL and sha256; it pins `VisualStudio.vsman` by sha256,
  which pins every package. MSVC 14.44.17.14, Windows SDK 10.0.26100.
- **Size**: 450 MB download (both archs), 1.4 GB splat with the debug CRT,
  95 s on CI.
- **Works** for x64 and arm64, run on windows-2025 and windows-11-arm: C;
  C++ with the MSVC STL (exceptions, threads, `<filesystem>`, `<format>`;
  /MT, /MD; ThinLTO); both drivers; Win32 API (kernel32, user32, advapi32);
  kotatsu's unit and system tests (`msvc.cmake`).
- **Missing in xclang**: compiler-rt for `*-windows-msvc` (`__int128`
  division needs `__udivti3`, which xclang's MinGW builtins do provide; no
  `clang_rt.profile.lib`, no ASan).
- xclang's empty `<host>-clang-cl.cfg` files do not get in the way: clang-cl
  with an MSVC `--target` reads no config file.
