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
hosts; on macOS hosts, the macOS targets use the installed Xcode's SDK,
and on a Windows host with no SDK fetched, the MSVC targets use the
installed Visual Studio, as upstream clang does
([Windows](windows.md#msvc-targets)).
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
- Versions are pinned. `xclang/sdk-versions.json`, built into the program,
  lists every version the vendors offer, with sizes and sha256, and for
  Apple's packages the content of the SDK each carries
  ([below](#apple-s-packages-come-and-go)). Its presets match GitHub's
  runner images (`macos-latest`, `windows-2022`, ...), so a cross build
  gets what a workflow on that image gets.

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

## Apple's Packages Come and Go

Apple's software update catalogs offer the Command Line Tools current for
each macOS. Now and then Apple withdraws a release and posts another in
its place, and its CDN then answers 403 for the withdrawn packages. The
new ones carry the same SDK, packaged and signed anew: their bytes differ,
but not the SDK. When product 142-50405 took the place of 082-83364, the
18516 files of its SDK 26.5 were the same.

So the table pins each of Apple's packages twice: by its sha256, and by
the content digest of the SDK it carries. `xclang sdk fetch` downloads the
package the table pins for a version. When Apple answers 403 or 404 for
it, the command reads Apple's catalogs, and takes a package they list now
that carries the same SDK version, which the start of its payload tells,
once its SDK has the content the table pins. Bazel downloads the pinned
package into its repository cache, and when that fails, the command looks
for the SDK the same way
([the Bazel module](../integrations/bazel.md#vendor-sdks)).

- **A version Apple carries no more fails.** When 27.2 took the place of
  27.0, no package carried 27.0 any longer. Fetching it fails, naming the
  versions the catalogs carry now.
- **One version is not one SDK.** The 26.5 of the earlier Command Line
  Tools releases differs from the one the table pins in 9 files. A
  package of the version with other content is refused.
- **`--version latest` is not reproducible.** It takes the newest SDK the
  catalogs list when it runs, which may be newer than the table, and then
  nothing pins it.
- **xclang keeps no copy.** It mirrors, caches or uploads nothing of
  Apple's. A package you keep yourself, in Bazel's repository cache or a
  `--distdir`, or in the `--cache` directory of `xclang sdk fetch`
  ([CI](../integrations/ci.md#get-the-toolchain)), still builds when Apple
  carries its version no more.

The content digest is the sha256 of the SDK's manifest. The manifest has a
line for each file and symbolic link in the SDK directory of the package's
payload (`Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk/`), the
man pages and tools that xclang leaves out included, sorted by path, byte
by byte:

```text
file <sha256 of its bytes> <path>
link <sha256 of its target> <path>
```

Each line ends with a newline. The path is below the SDK directory, with
`/` between its parts. Directories, modes and times do not count, nor how
xclang makes the links on Windows; a hard link is a file with its data.
`pkgutil --expand-full` on a Mac unpacks the same tree.

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
