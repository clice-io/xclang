# The xclang Command

::: warning Unreleased
No release carries `xclang`. CI builds and tests it from `main` (cli.yml),
and `node scripts/cli.ts` builds it. Its SDK commands work. No release
publishes target archives, so `xclang target add` has nothing to add;
target archives are [planned](../design/roadmap.md#target-archives).
:::

`xclang` fetches what the toolchain does not carry: the vendor SDKs that
cannot be redistributed, and targets beyond the six every toolchain has. The
plan is to ship it in every toolchain archive, as `bin/xclang`. Why SDKs are
fetched and not shipped is in [vendor SDKs](../design/vendor-sdks.md).

```text
xclang sdk list [macos|windows]
xclang sdk fetch macos --accept-license [--preset P] [--version V]
xclang sdk fetch windows --accept-license [--preset P] [--msvc-version V] [--sdk-version V] [--arch x86_64,aarch64,x86]
xclang sdk path macos|windows [the options of fetch]
xclang sdk use <name>
xclang sdk remove <name>
xclang target list
xclang target add <target>...
xclang target remove <target>...
xclang --version
```

## Vendor SDKs

`xclang sdk fetch` downloads an SDK from its vendor. It checks each
download against the size and sha256 its version table pins, with three
tries, since a download now and then comes short or damaged. Then it
unpacks the SDK into a directory of its own:

| SDK | directory | use |
|---|---|---|
| macOS | `$XCLANG/sdk/macos-<version>` | `clang --target=arm64-apple-macos -isysroot <dir>` |
| MSVC and the Windows SDK | `$XCLANG/sdk/windows-msvc<version>-sdk<version>` | `clang++ --target=x86_64-pc-windows-msvc`, `clang-cl`: the [MSVC targets](../integrations/clang.md#msvc-targets) |

| command or option | |
|---|---|
| `--accept-license` | without it, fetch prints the vendor's license terms and stops |
| `sdk path` | prints the directory that fetch, with the same options, fetches to: `-isysroot "$(xclang sdk path macos)"` |
| `sdk list` | the fetched SDKs, and those in use; `.xclang-sdk.json`, written last, records what an SDK was fetched from, and a directory without it is listed as incomplete |
| `sdk use <name>` | makes a fetched SDK the one in use (below) |
| `sdk remove <name>` | removes a fetched SDK, and its link if it is in use |
| `--preset <image>` | the SDK versions of a GitHub runner image or label (`windows-2022`, `macos-15`); by default `windows-latest` and `macos-latest` |
| `--version`, `--sdk-version`, `--msvc-version` | a version, whole or in part (`15`, `10.0.26100`, `14.44`), in place of the preset's; the newest that matches is taken |
| `--sdk-dir <dir>` | another directory for SDKs, for a toolchain installed read-only |
| `--links copy` | on Windows, copy instead of making junctions and hard links |

### The SDK in Use

The SDK fetched last, or the one `sdk use` names, is the one in use:
`$XCLANG/sdk/windows` and `$XCLANG/sdk/macos` point to it, a symbolic
link, or on Windows a junction, which needs no privilege. That gives the
config files a fixed path. A Windows SDK holds a config file per
architecture fetched and per driver, `<arch>-pc-windows-msvc.cfg` and
`<arch>-pc-windows-msvc-clang-cl.cfg`, which name the SDK and its versions;
the MSVC targets' own config files read them through `sdk/windows`
([why](../design/windows.md#msvc-targets)). An SDK fetched with `--sdk-dir`
is outside the toolchain, where its config files do not look.

### Versions

`cli/sdk-versions.json`, built into the program, lists every
version the vendors offer:

- 38 Windows SDKs from NuGet;
- 20 MSVC toolsets from the Visual Studio channels;
- 29 macOS SDK packages from Apple's software update catalogs;
- presets: the versions GitHub's runner images build with, so a cross
  build matches what a workflow gets. `windows-2022` has MSVC 14.44, whose
  STL still serves Windows 7 SP1 and 8.1.

The macOS 27 SDK is listed, but passed over by default. That rule dates
from before 23.1.2.6, which links against it ([patch 0009](patches.md)).

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

`xclang target add` unpacks the archive of a target into the toolchain:
its sysroot and runtimes, its compiler-rt, and its config files. The
archives of a release are listed in its index, as the channel manifests of
rustup list components. No release has an index yet
([planned](../design/roadmap.md#target-archives)); this one is
illustrative:

```json
{
  "schema": 1,
  "version": "23.1.2.7",
  "targets": {
    "x86_64-unknown-linux-musl": {
      "description": "Linux x64, musl 1.2.5",
      "tier": 1,
      "sdk": null,
      "archive": "xclang-target-23.1.2.7-x86_64-unknown-linux-musl.tar.xz",
      "sha256": "…",
      "size": 12345678,
      "unpacked": 98765432
    }
  }
}
```

- The index is `xclang-targets-<version>.json`, an asset of the release
  of the toolchain. `--index` or `XCLANG_TARGET_INDEX` names another, a
  URL or a file. The release of the toolchain comes from its CMake
  package, and an index of another release is refused.
- `archive` is a URL, or a name next to the index. `sdk` is `macos`,
  `windows` or null; `target add` says which SDK to fetch.
- An archive is a `.tar.xz` of regular files below `xclang/`, as the
  toolchain archives are, without links. `target add` refuses to overwrite
  a file that is not the target's own, unless given `--force`. It takes
  back what it wrote when it fails.
- What a target added is recorded in `lib/xclang/targets/<target>.json`.
  `target remove` deletes those files, and the directories they leave
  empty.
- The six built-in targets are listed as built in, and cannot be removed.

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
| `XCLANG_SDK_DIR` | another directory for SDKs, as `--sdk-dir` |
| `XCLANG_JOBS` | how many threads unpack; one per CPU by default |
| `XCLANG_TARGET_INDEX` | another target index, as `--index` |
| `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` | honoured |
| `SSL_CERT_FILE` | a CA file, read on Linux |

How the command is built, tested and maintained is in the
[build pipeline](../dev/release-build.md#the-xclang-command).
