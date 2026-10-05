# The xclang command

`bin/xclang` fetches what the toolchain does not carry: the vendor SDKs
that cannot be redistributed, and targets beyond the six every toolchain
has. It is written in Rust (`cli/`) and built for every host with xclang
as its C compiler and linker ([Rust and cargo](../integrations/cargo.md)). No release carries it yet:
the archives do once the release pipeline runs with `cli` (below).

```sh
xclang sdk list [macos|windows]
xclang sdk fetch macos --accept-license [--preset P] [--version V]
xclang sdk fetch windows --accept-license [--preset P] [--msvc-version V] [--sdk-version V] [--arch x86_64,aarch64,x86]
xclang sdk path macos|windows [the options of fetch]
xclang sdk remove <name>
xclang target list
xclang target add <target>...
xclang target remove <target>...
xclang --version
```

## Vendor SDKs

`xclang sdk fetch` downloads an SDK from its vendor, checks each download
against the size and sha256 its version table pins (three tries, as a
download now and then comes short or damaged), and unpacks it into a
directory of its own:

| SDK | directory | use |
|---|---|---|
| macOS | `<toolchain>/sdk/macos-<version>` | `clang --target=arm64-apple-macos -isysroot <dir>` |
| MSVC and the Windows SDK | `<toolchain>/sdk/windows-msvc<version>-sdk<version>` | `clang-cl --target=x86_64-pc-windows-msvc /winsysroot <dir>`, `clang --target=x86_64-pc-windows-msvc -Xmicrosoft-windows-sys-root <dir>` |

`xclang sdk path` prints the directory that fetch, with the same options,
fetches to: `-isysroot "$(xclang sdk path macos)"`. Where the toolchain is
installed read-only, `--sdk-dir` or `XCLANG_SDK_DIR` names another
directory for SDKs. `XCLANG_JOBS` sets how many threads unpack (one per CPU by
default). An SDK's `.xclang-sdk.json`, written last, records
what it was fetched from; `sdk list` calls a directory without one
incomplete.

Without `--accept-license` fetch prints the vendor's license terms and
stops. xclang never distributes an SDK; the user downloads it from the
vendor.

**Versions.** `cli/sdk-versions.json`, built into the program, lists every
version the vendors offer: 38 Windows SDKs (NuGet), 20 MSVC toolsets
(Visual Studio's channels), 29 macOS SDK packages (Apple's software update
catalogs), and **presets**, what GitHub's runner images build with. By
default fetch takes the `windows-latest` and `macos-latest` presets, so a
cross build matches what a workflow gets without naming an image;
`--preset` names another image or label (`windows-2022`, whose MSVC 14.44
still serves Windows 7 SP1 and 8.1; `macos-15`), and a version given whole
or in part (`--version 15`, `--sdk-version 10.0.26100`,
`--msvc-version 14.44`) replaces the preset's, the newest that matches
taken. The macOS 27 SDK is listed but passed over by default: ld64.lld
23.1.2 rejects its `.tbd` files (`arm64e.x1`).

**macOS** comes from a Command Line Tools package on `swcdn.apple.com` (no
Apple ID): a xar archive whose payload is pbzx (xz chunks) of a cpio
archive, read by xclang itself. Man pages, tools and Perl are left out. On
Windows symlinks become junctions (to directories) and hard links (to
files), which need no privilege; `--links copy` copies instead. 62 MB
download, 610 MB unpacked.

**Windows** comes from Visual Studio's `.vsix` packages (the CRT and STL:
headers, and per architecture the static and DLL runtimes' libraries) and
NuGet's `Microsoft.Windows.SDK.CPP` packages, all zip archives, laid out
as a `/winsysroot` as Visual Studio installs it. On a case-sensitive file
system (Linux) links are added for the spellings Windows code uses
(`windows.h`, `WinBase.h` as `winbase.h`, `LIBCMT.lib`, ...): 3.6k links.
600 MB download for x64 and arm64, 1.8 GB unpacked.

## Targets

`xclang target add` unpacks a target's archive into the toolchain: its
directory (sysroot and runtimes), its compiler-rt, its config files. The
archives of a release are listed in its index, as rustup's channel
manifests list components:

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

- The index is `xclang-targets-<version>.json`, an asset of the release of
  the toolchain (`--index` or `XCLANG_TARGET_INDEX` name another, a URL or
  a file). The toolchain's release comes from its CMake package; an index
  of another release is refused.
- `archive` is a URL, or a name next to the index; `sdk` is `macos`,
  `windows` or null, and add says which SDK to fetch.
- An archive is a `.tar.xz` of regular files below `xclang/`, as the
  toolchain archive's are, without links. add refuses to overwrite a file
  that is not the target's own (`--force` does), and takes back what it
  wrote when it fails.
- What a target added is recorded in `lib/xclang/targets/<target>.json`;
  remove deletes those files and the directories they leave empty.
- The six built-in targets are listed as built in and cannot be removed.

What the release pipeline must add before a release has targets:

1. a stage that packs each target outside the six into
   `xclang-target-<version>-<target>.tar.xz`, laid out as above:
   `xclang/<target>/` (sysroot, libc++, libunwind, its licenses),
   `xclang/lib/clang/<major>/lib/<target>/` (compiler-rt),
   `xclang/bin/<spelling>.cfg` for every spelling of the triple (from
   `config/`, as `scripts/common.ts` writes them), case-unique and without
   links;
2. the index, `xclang-targets-<version>.json`, with each archive's
   sha256, size, unpacked size, tier and SDK;
3. both in the draft release with the toolchains, and in `SHA256SUMS`;
4. a test that adds each target to every host's toolchain and builds (and,
   per tier, runs) a program for it.

## Network

Every request says `User-Agent: xclang/<version>` and nothing else of the
user. `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY` are honoured.
TLS is rustls (with ring); certificates are checked against the system's
trust store (Security.framework on macOS, the certificate store on
Windows, the CA files of a Linux system, `SSL_CERT_FILE` included), so a CA
a company installs is trusted too; a Linux system without CA files falls
back to Mozilla's roots.

## Building

`node scripts/cli.ts` builds the program for the hosts of the machine it
runs on (Linux x64: both Linux and both Windows hosts; macOS: both macOS
hosts) with a released xclang (23.1.2.5, pinned in `scripts/common.ts`),
and checks what each binary loads at run time:

| host | size | loads at run time |
|---|---|---|
| x86_64-unknown-linux-gnu | 3.1 MB | libc, libdl, libpthread, librt; glibc 2.16 |
| aarch64-unknown-linux-gnu | 2.7 MB | libc, libdl, libpthread; glibc 2.17 |
| x86_64-w64-mingw32 | 2.8 MB | kernel32, ntdll, advapi32, ws2_32, bcrypt, bcryptprimitives, crypt32, UCRT (`api-ms-win-crt-*`) |
| aarch64-w64-mingw32 | 2.4 MB | the same |
| aarch64-apple-darwin | 2.6 MB | libSystem, libiconv, Security, CoreFoundation; macOS 13.0 |
| x86_64-apple-darwin | 2.9 MB | the same |

`.github/workflows/cli.yml` builds them and tests each on a machine of its
host (`tests/cli.ts`): both SDKs fetched, C, C++ and Objective-C programs
cross-compiled against them and run on macOS and Windows, targets added
and removed with a test index. `main.yml` with `cli` builds the program
(`cli.yml`) and `scripts/package.ts --cli` puts it into the toolchain
archives; without it, as now, the archives are as before.

Dependencies, each for a reason: ureq (HTTP) with rustls and ring (ring
rather than aws-lc-rs: nothing but a C compiler to build it, no CMake or
NASM), rustls-platform-verifier (the system's trust store) with
webpki-roots (the fallback), flate2 (zip's deflate, xar's zlib), liblzma
(xz; its C sources built by the C compiler cargo is given), tar, serde and
serde_json (the version table, the index), lexopt (the command line). xar,
pbzx, cpio and zip are read by xclang's own code, a few hundred lines.

**The version table** is made by `xclang sdk update-table`, built with the
`maintainer` feature (not in the shipped program), which appends what the
vendors offer now and reads the presets anew:

```sh
cd cli && cargo run --release --features maintainer -- sdk update-table --table sdk-versions.json
```

It is part of the program rather than a script because it shares the
program's readers (it reads the SDK version out of each new Apple package,
xar, pbzx and cpio), its downloads and the table's types, which read and
write the file alike.
