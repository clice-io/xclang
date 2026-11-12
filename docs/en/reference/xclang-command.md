# The xclang Command

`xclang` fetches what the toolchain does not carry, the vendor SDKs that
cannot be redistributed, and runs cargo with the toolchain as the C
compiler and linker of its targets. Every toolchain archive carries it, as
`bin/xclang` (`xclang.exe` on Windows). Why SDKs are fetched and not
shipped is in [cross-compiling](../guide/cross-compiling.md).

```text
xclang sdk list [macos|windows]
xclang sdk fetch macos --accept-license [--preset P] [--version V]
xclang sdk fetch windows --accept-license [--preset P] [--msvc-version V] [--sdk-version V] [--arch x86_64,aarch64,x86]
xclang sdk path macos|windows [the selection options of fetch]
xclang sdk packages macos|windows [the selection options of fetch] [--json]
xclang sdk use <name>
xclang sdk remove <name>
xclang target list
xclang target add <target>...
xclang target remove <target>...
xclang cargo <cargo's arguments>
xclang --version
```

## Vendor SDKs

`xclang sdk fetch` downloads an SDK from its vendor. It checks each
download against the size and sha256 its version table pins, with three
tries, since a download now and then comes short or damaged. A macOS
SDK whose package Apple withdrew, it finds in another package Apple's
catalogs list, checked by the SDK's content
([why](../design/macos.md#packages-apple-withdraws-and-content-digests)). Then it
unpacks the SDK into a directory of its own:

| SDK | directory | use |
|---|---|---|
| macOS | `$XCLANG/sdk/macos-<version>` | `clang++ --target=arm64-apple-macos` on Linux and Windows hosts ([macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)); on macOS hosts, and for an SDK outside the toolchain, `-isysroot <dir>` |
| MSVC and the Windows SDK | `$XCLANG/sdk/windows-msvc<version>-sdk<version>` | `clang++ --target=x86_64-pc-windows-msvc`, `clang-cl`: the [MSVC targets](../guide/cross-compiling.md#msvc-targets) |

| command or option | |
|---|---|
| `--accept-license` | without it, fetch prints the vendor's license terms and stops |
| `sdk path` | prints the directory that fetch, given the same selection options (`--preset`, `--version`, `--msvc-version`, `--sdk-version`, `--arch`), fetches to: `-isysroot "$(xclang sdk path macos)"`. With `--arch`, it fails if the SDK there lacks one of those architectures |
| `sdk packages` | prints what fetch, given the same selection options, downloads for an SDK not fetched yet: each package's sha256, size and URL, or with `--json` `{"name": <the SDK's directory>, "packages": [{"url", "size", "sha256", "file"}]}`. A build system downloads them itself, under the names `file`, into a directory that `fetch --cache` then takes them from; the Bazel module does ([Bazel](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)). What it cannot download, a package Apple withdrew or one with no sha256 (`--version latest` past the table), fetch downloads itself |
| `--cache <dir>` | fetch keeps its downloads in the directory, and takes from it those already there, by their sha256 |
| `sdk list` | the presets and versions xclang knows, the defaults marked, the fetched SDKs, and those in use; `.xclang-sdk.json`, written last, records what an SDK was fetched from, and a directory without it is listed as incomplete |
| `sdk use <name>` | makes a fetched SDK the one in use (below) |
| `sdk remove <name>` | removes a fetched SDK, and its link if it is in use |
| `--preset <image>` | the SDK versions of a GitHub runner image or label (`windows-2022`, `macos-15`); by default `windows-latest` and `macos-latest` |
| `--version`, `--sdk-version`, `--msvc-version` | a version, whole or in part (`15`, `10.0.26100`, `14.44`), in place of the preset's; the newest that matches is taken. `--version latest` takes the newest macOS SDK Apple's catalogs list now, which may be newer than the table, and is not reproducible |
| `--arch <archs>` | the architectures of a Windows SDK, of `x86_64`, `aarch64` and `x86`; by default `x86_64,aarch64`. Fetched again, an SDK keeps the architectures it has: `--arch x86` adds x86 |
| `--sdk-dir <dir>` | another directory for SDKs, for a toolchain installed read-only |
| `--links <how>` | how fetch makes the macOS SDK's links: `junction`, junctions and hard links, the default on Windows; `symlink`, symbolic links, the default elsewhere; or `copy` |
| `--root <dir>` | the toolchain the command acts on; by default the one it is in |

Fetching an SDK that is there already unpacks it anew, and keeps the old
one aside, as `.<name>.old`, until the new one is whole. If the fetch
fails, the old one is put back, and stays usable. An interrupted fetch
leaves that to the next one. The disk needs room for both meanwhile. If
the old one cannot be moved aside, as on Windows while a program has one
of its files open, the fetch stops, and the SDK stays as it was.

### The SDK in Use

The SDK fetched last, or the one `sdk use` names, is the one in use:
`$XCLANG/sdk/windows` and `$XCLANG/sdk/macos` point to it, a symbolic
link, or on Windows a junction, which needs no privilege. That gives the
config files a fixed path. A Windows SDK holds a config file per
architecture fetched and per driver, `<arch>-pc-windows-msvc.cfg` and
`<arch>-pc-windows-msvc-clang-cl.cfg`, which name the SDK and its versions.
The MSVC targets' own config files read them through
`bin/<arch>-pc-windows-msvc-sdk.cfg` and
`bin/<arch>-pc-windows-msvc-clang-cl-sdk.cfg`, which `fetch`, `use` and
`remove` rewrite: they include the files of the SDK in use, through
`sdk/windows`, or say there is none for the architecture
([why](../guide/cross-compiling.md#msvc-targets)). An update of a conda package
writes them anew, naming none; `sdk use` names the SDK again. On Linux and
macOS hosts the config files read `sdk/windows` meanwhile all the same. On
Linux and Windows hosts the
macOS targets' config files name `sdk/macos` as their `-isysroot`
([why](../guide/cross-compiling.md#on-linux-and-windows-hosts)); on macOS
hosts they use Xcode's SDK, and a fetched one takes `-isysroot`. An SDK
fetched with `--sdk-dir` is outside the toolchain, where its config files
do not look.

On Windows, a junction holds an absolute path. When the toolchain
directory moves, `xclang sdk use <name>` points `sdk/windows` or
`sdk/macos` to the SDK at its new place again. A macOS SDK fetched with
junctions, the default on Windows, has more of them inside: fetch it
again after the move, or fetch it with `--links copy`, which makes none.

### Versions

`xclang/sdk-versions.json`, built into the program, lists every
version the vendors offer:

- the Windows SDKs on NuGet;
- the MSVC toolsets of the Visual Studio channels;
- the macOS SDK packages of Apple's software update catalogs;
- presets: the versions GitHub's runner images build with, so a cross
  build matches what a workflow gets. `windows-2022` has MSVC 14.44, whose
  STL still serves Windows 7 SP1 and 8.1.

With no version given, the preset's is taken.

### What Is Fetched

**macOS** comes from a Command Line Tools package on `swcdn.apple.com`,
without an Apple ID. Man pages, tools and Perl are left out. On Windows,
symlinks become junctions (to directories) and hard links (to files),
which need no privilege. The download is 62 MB, 610 MB unpacked.

**Windows** comes from the `.vsix` packages of Visual Studio and NuGet's
`Microsoft.Windows.SDK.CPP` packages, laid out as a `/winsysroot`, as
Visual Studio installs it. The `.vsix` packages hold the CRT and STL: the
headers, the STL's `std` modules (`std.ixx`), and per architecture the
libraries of the static and DLL runtimes, with the PDBs of the static
runtime. A debug link looks for those, and warns without them (LNK4099). On a case-sensitive file system, 3.6k links are added for the
spellings Windows code uses. The download is 600 MB for x64 and arm64,
1.8 GB unpacked.

## Targets

`xclang target list` lists the targets of the release, all of them built
into the toolchain. `xclang target add` and `target remove` add and remove
targets that the release publishes as archives of their own, and no
release publishes any yet ([target archives](../design/roadmap.md#target-archives)).

## cargo

`xclang cargo build --target <Rust target>`, and cargo's other commands,
run cargo with the variables of the targets it builds for set: those of
`--target`, of `build.target`, or the host's. The linker of each target is
`xclang` itself, under the name `<Rust target>-linker` in xclang's cache
directory, which runs clang (lld-link for the MSVC targets) with what the
target needs. A target's missing standard library is added with
`rustup target add`; a missing vendor SDK is named, with its
`xclang sdk fetch`. What it sets, target by target, is in
[Rust and Cargo](../integrations/cargo.md#what-xclang-cargo-sets).

## Network

Every request says `User-Agent: xclang/<version>`, and nothing else about
the user. TLS is rustls, with ring. Certificates are checked against the
trust store of the system: Security.framework on macOS, the certificate
store on Windows, the CA files of a Linux system. So a CA that a company
installs is trusted too. A Linux system without CA files falls back to
Mozilla's roots.

## Environment

| variable | |
|---|---|
| `XCLANG_ROOT` | the toolchain, as `--root` |
| `XCLANG_SDK_DIR` | another directory for SDKs, as `--sdk-dir` |
| `XCLANG_JOBS` | how many threads unpack; one per CPU by default |
| `XCLANG_TARGET_INDEX` | another target index, as `--index` |
| `XCLANG_CACHE_DIR` | where `xclang cargo` keeps its linkers and CMake toolchain files; by default `xclang` in the user's cache directory |
| `XCLANG_STDLIB` | `platform`: `xclang cargo` builds C++ with the platform's C++ library ([Rust and Cargo](../integrations/cargo.md#the-system-s-c-library)) |
| `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` | honoured |
| `SSL_CERT_FILE` | a CA file, read on Linux |
