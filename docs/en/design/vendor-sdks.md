# Vendor SDKs

::: warning Unreleased
The `xclang sdk fetch` command this page describes is in no release; CI
builds and tests it from `main`
([the xclang command](../reference/xclang-command.md)). Today the macOS
targets use the installed Xcode's SDK, on macOS hosts.
:::

Some targets need an SDK only its vendor may distribute: Apple's for macOS,
Microsoft's MSVC libraries and Windows SDK for the MSVC ABI. xclang never
redistributes them. Its design is that the user fetches them from the
vendor, by a pinned version and digest, after accepting the vendor's
license. The targets that need them are [planned](roadmap.md#msvc) (MSVC)
and [in research](roadmap.md#macos-any-host) (macOS from Linux and Windows
hosts).

## Why Fetch, Not Ship

Apple's SDK agreement and Microsoft's Visual Studio license allow use, not
redistribution. A toolchain that bundles them, or a Docker image that
contains them, passes them on; cross-rs, for one, provides no images for
Apple targets "due to licensing reasons" and leaves building one to the
user. xclang goes the other way: it downloads from the vendor's own
servers, so each user gets the SDK from the vendor under the vendor's
terms, and xclang's archives stay free to share.

What that means for the user of `xclang sdk fetch`:

- `xclang sdk fetch` prints the vendor's license terms and stops, until
  given `--accept-license`.
- Apple's terms allow use of the SDK on Apple hardware. Building for macOS
  from Linux or Windows with it is the user's decision under those terms;
  xclang does not make it for them.
- Versions are pinned: `cli/sdk-versions.json`, built into the program,
  lists every version the vendors offer with sizes and sha256, and presets
  that match GitHub's runner images (`macos-latest`, `windows-2022`, ...),
  so a cross build gets what a workflow on that image gets.

## Apple's SDK without Xcode

The macOS SDK comes in Apple's Command Line Tools package, on
`swcdn.apple.com`, found through Apple's software update catalogs, with no
Apple ID. The package is a xar archive whose payload is pbzx (a stream of
xz chunks) holding a cpio archive; xclang reads all three with its own
code, a few hundred lines, so it works on every host without macOS tools.
Man pages, tools and Perl are left out: 62 MB downloaded, 610 MB unpacked.

**The iOS family is a hard limit.** The SDKs for iOS, tvOS, watchOS,
visionOS and their simulators come only with full Xcode, downloaded with an
Apple ID. No unattended fetch can get them, so those targets are
[in research](roadmap.md#ios), and are likely to need their runtimes built
on demand.

## Microsoft's SDK without Visual Studio

MSVC's CRT and STL come from Visual Studio's own `.vsix` packages, named in
its channel manifest, and the Windows SDK from NuGet's
`Microsoft.Windows.SDK.CPP` packages. Both are zip archives. The usual
route, Visual Studio's installer or the SDK's MSI and CAB files, needs
Windows or tools that read MSI and CAB; zips are read by xclang's own code
on every host. The files are laid out as Visual Studio installs them, for
`/winsysroot`. Against xwin, which unpacks the MSI and CAB route, nothing
these builds need was missing, and xwin has no macOS or Windows-on-Arm
binaries, which xclang needed. 600 MB is downloaded for x64 and arm64,
1.8 GB unpacked.

On a case-sensitive file system, links are added for the spellings
Windows code uses (`windows.h`, `WinBase.h` as `winbase.h`, `LIBCMT.lib`,
...): 3.6k of them, so code written on Windows builds unchanged.

## Tested By

cli.yml fetches both SDKs on every host, compiles C, C++ and Objective-C
programs against them there, and runs the programs on macOS and Windows
runners. tests/cargo.ts builds xclang's own Rust command for macOS and MSVC
targets from Linux with them ([Rust and Cargo](../integrations/cargo.md)).
