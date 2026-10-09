# Vendor SDKs

Some targets need an SDK that only its vendor may distribute: Apple's for
macOS, and Microsoft's MSVC libraries and Windows SDK for the MSVC ABI.

## Summary

xclang never redistributes a vendor SDK. Its design is that the user fetches
it from the vendor, by a pinned version and digest, after accepting the
vendor's license. The command for that is `xclang sdk fetch`, which every
toolchain archive carries
([the xclang command](../reference/xclang-command.md)). The targets that
need it are the MSVC targets, and the macOS targets on Linux and Windows
hosts; on macOS hosts, the macOS targets use the installed Xcode's SDK.
The SDK in use is a link in the toolchain's `sdk/`, so config files name a
fixed path while versions change
([the SDK in use](../reference/xclang-command.md#the-sdk-in-use)). In
Bazel, the project's `MODULE.bazel` accepts the license, and the SDK is a
repository the same command unpacks
([the Bazel module](bazel-module.md#vendor-sdks-as-repositories)).

## Why Fetch, Not Ship

Apple's SDK agreement and Microsoft's Visual Studio license allow use, not
redistribution. A toolchain that bundles them, or a Docker image that
contains them, passes them on. cross-rs, for one, provides no images for
Apple targets "due to licensing reasons", and leaves building one to the
user.

xclang goes the other way. It downloads from the vendor's own servers, so
each user gets the SDK from the vendor, under the vendor's terms, and
xclang's archives stay free to share. For the user of `xclang sdk fetch`,
that means:

- It prints the vendor's license terms and stops, until given
  `--accept-license`.
- Apple's terms allow use of the SDK on Apple hardware. Building for macOS
  from Linux or Windows with it is the user's decision under those terms;
  xclang does not make it for them.
- Versions are pinned. `cli/sdk-versions.json`, built into the program,
  lists every version the vendors offer, with sizes and sha256. Its
  presets match GitHub's runner images (`macos-latest`, `windows-2022`,
  ...), so a cross build gets what a workflow on that image gets.

## Apple's SDK without Xcode

The macOS SDK is in Apple's Command Line Tools package, on
`swcdn.apple.com`. Apple's software update catalogs name it, and no Apple
ID is needed. The package is a xar archive. Its payload is pbzx, a stream
of xz chunks, holding a cpio archive. xclang reads all three with its own
code, a few hundred lines, so the fetch works on every host without macOS
tools. Man pages, tools and Perl are left out.

On Linux and Windows hosts, the config files of the macOS targets use the
SDK in use, `sdk/macos`; on macOS hosts, Xcode's
([macOS](macos.md#the-sdk-on-linux-and-windows-hosts)). The Command Line
Tools hold the SDK and its compilers, not Xcode's other tools: app
bundles' asset catalogs and nibs, which need `actool` and `ibtool`, do not
build off macOS.

**The iOS family is a hard limit.** The SDKs for iOS, tvOS, watchOS,
visionOS and their simulators come only with full Xcode, downloaded with
an Apple ID. No unattended fetch can get them. So those targets are
[in research](roadmap.md#ios), and are likely to need their runtimes built
on demand.

## Microsoft's SDK without Visual Studio

The MSVC CRT and STL come from Visual Studio's own `.vsix` packages, named
in its channel manifest. The Windows SDK comes from NuGet's
`Microsoft.Windows.SDK.CPP` packages. Both are zip archives.

The usual route is Visual Studio's installer, or the MSI and CAB files of
the SDK. It needs Windows, or tools that read MSI and CAB. Zips are read by
xclang's own code on every host. The files are laid out as Visual Studio
installs them, for `/winsysroot`.

xwin is the known tool for this, and unpacks the MSI and CAB route.
Against it, nothing these builds need was missing. xwin also has no macOS
or Windows-on-Arm binaries, which xclang needed.

On a case-sensitive file system, links are added for the spellings that
Windows code uses (`windows.h`, `WinBase.h` as `winbase.h`, `LIBCMT.lib`,
...). So code written on Windows builds unchanged.

Download and unpacked sizes are in
[the xclang command](../reference/xclang-command.md#vendor-sdks).
