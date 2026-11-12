# macOS

The macOS targets, `aarch64-apple-darwin` and `x86_64-apple-darwin` (and their
`arm64-apple-darwin`, `*-apple-macos` and `*-apple-macosx` spellings), compile
against Apple's macOS SDK, link xclang's `libc++` and `libc++abi` statically
into the binary, and link with `ld64.lld` on every host
([cross-compiling](cross-compiling.md)). Binaries run on macOS 13.0 or later by
default.

## On macOS Hosts

On a macOS host, `clang` uses the SDK of Xcode or the Command Line Tools without
fetching anything through `xclang`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

`clang` finds the SDK in the standard order: the last `-isysroot` on the command
line, otherwise the `SDKROOT` environment variable, otherwise the SDK of Xcode
or the Command Line Tools (`xcselect`, as `xcrun` resolves it).

## On Linux and Windows Hosts

On Linux and Windows hosts, fetch Apple's macOS SDK once with
`xclang sdk fetch macos --accept-license`; then build for either macOS
architecture with `--target`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch macos --accept-license
clang++ -O2 --target=arm64-apple-macos hello.cpp -o hello-macos-arm64
```

`xclang sdk fetch macos` unpacks the SDK into `<toolchain>/sdk/macos-<version>`
and points `<toolchain>/sdk/macos` at it
([the `xclang` command](../reference/xclang-command.md)). On Linux and Windows
hosts, the macOS target config files begin with
`-isysroot <CFGDIR>/../sdk/macos`, so a bare `--target` uses the active SDK:

| host | SDK used |
|---|---|
| macOS | the last `-isysroot`, else `SDKROOT`, else Xcode's (`xcselect`) |
| Linux, Windows | the last `-isysroot` on the command line, else `<toolchain>/sdk/macos` |

On Linux and Windows hosts, `clang` does not read `SDKROOT` on its own because
`clang` consults `SDKROOT` only when no `-isysroot` flag is present, and the
target config file supplies one. Passing `--sysroot` does not replace the SDK
either (compiles keep the config file's `-isysroot`, and only the link step uses
`--sysroot`). Pass `-isysroot <dir>` on the command line to select another SDK;
build systems that honor `SDKROOT` pass it as `-isysroot`, which wins:
cargo and rustc, and the [CMake](../integrations/cmake.md) package. Without a fetched SDK or `-isysroot`, `clang` warns that
`sdk/macos` does not exist and finds no C headers.

### Presets, Versions and `latest`

- **Presets**: by default, `xclang sdk fetch macos` uses the `macos-latest`
  preset (`macOS-26-arm64`, SDK 26.5). Pass `--preset macos-15` (or `macOS-26`,
  `macOS-15-arm64`) to fetch the SDK version matching that GitHub Actions runner
  image.
- **Pinned versions**: pass `--version <ver>` (such as `--version 15` or
  `--version 15.5`) to pick the newest matching SDK that
  `xclang/sdk-versions.json` pins. Run
  `xclang sdk use <name>` to switch `<toolchain>/sdk/macos` between fetched
  versions ([the `xclang` command](../reference/xclang-command.md)).
- **`--version latest`**: queries Apple's live software update catalogs for the
  newest macOS SDK available when the command runs. Because that SDK may be
  newer than the version table in `xclang/sdk-versions.json`, it is unpinned and
  not reproducible.
- **Withdrawn packages**: when Apple withdraws a Command Line Tools package from
  its CDN and posts a re-signed package in its place, `xclang sdk fetch`
  automatically falls back to Apple's catalogs and verifies the unpacked SDK by
  its content digest ([below](#packages-apple-withdraws-and-content-digests)).

## xclang's libc++ and `-stdlib=platform`

The macOS target config files put xclang's `libc++` headers on the C++ include
path and place xclang's static `libc++.a` (which includes `libc++abi`) ahead of
the SDK's `libc++.tbd`. The unwinder is the system's, in `libSystem`
([hermeticity](../design/hermeticity.md)).

Linking xclang's `libc++` statically has two advantages:

- **OS-independent C++ library features**: Apple's SDK marks newer `libc++`
  features with availability attributes tied to the macOS version whose
  `/usr/lib/libc++.1.dylib` first shipped them. With xclang's `libc++` linked
  into the binary, standard library features depend on the xclang release rather
  than the target macOS version.
- **Same `libc++` across platforms**: programs get the same `libc++`
  implementation on macOS, Linux and Windows.

Pass `-stdlib=platform` to use the SDK's C++ library (`/usr/lib/libc++.1.dylib`
of the OS) instead, with the same SDK, deployment target and linker
([cross-compiling](cross-compiling.md#the-platform-s-c-library)). Use
`-stdlib=platform` when passing C++ types across an interface to a library built
against the system's `libc++`, or to leave the C++ runtime to the OS. With
`-stdlib=platform`, newer C++ library symbols require a matching deployment
target: for example, `std::format` of a floating-point number requires
`-mmacos-version-min=13.3` or later.

The target config file sets `-mmacos-version-min=13.0`; pass a later
`-mmacos-version-min=<ver>` on the command line to override it.

## ld64.lld and `-fuse-ld=ld`

macOS targets link with `ld64.lld` on every host, including macOS hosts.
`ld64.lld` signs `arm64` binaries ad hoc, just as Apple's `ld` does, so they run
on Apple silicon without invoking `codesign`, and `llvm-install-name-tool`
re-signs binaries when modifying them.

On a macOS host, pass `-fuse-ld=ld` to link non-LTO object files with Apple's
`ld` instead. Apple's `ld` reads LTO bitcode through `libLTO.dylib`, which must
match the compiler's LLVM version; xclang does not ship `libLTO.dylib` (saving
120 MB in every macOS host archive), just as it ships no LTO plugin for system
linkers on other hosts, so LTO builds always link with `ld64.lld`.

## Two Architectures

Every host archive carries both `aarch64-apple-darwin` and
`x86_64-apple-darwin`, and `llvm-lipo` combines programs of both into a
universal one. To CMake, the other macOS architecture is
`CMAKE_OSX_ARCHITECTURES`, not cross-compiling
([CMake](../integrations/cmake.md)).

`x86_64` macOS binaries run on `arm64` Macs through Rosetta, while `arm64`
binaries do not run on `x86_64` Macs. The `x86_64-apple-darwin` host toolchain
itself is cross-compiled on `arm64` macOS, with its table generators built for
`arm64` first so that no `x86_64` program runs during the build, and tested on
an `x86_64` Mac (`macos-15-intel`).

## Debug Information

Mach-O links keep DWARF debug information in the `.o` object files and record
their paths in the executable's debug map, from which `dsymutil` collects a
`.dSYM` bundle ([debugging](../features/debugging.md)):

- **Relative paths in the debug map**: by default, the debug map records each
  object file by its absolute path, so linking the same program in two
  directories produces different bytes. Bazel links pass `-oso_prefix .` so the
  debug map records relative `bazel-out/...` paths.
- **ThinLTO temporary objects**: with ThinLTO, the LTO backend writes temporary
  object files that the linker deletes when the link finishes, so xclang's
  [CMake](../integrations/cmake.md) and [Bazel](../integrations/bazel.md)
  integrations generate the `.dSYM` bundle during the link step.

Strip release binaries with `llvm-strip --strip-all`, matching Apple's `strip`
([debugging](../features/debugging.md)).

## Sanitizers

Both macOS targets support AddressSanitizer (with the ASan `libc++`),
ThreadSanitizer, LeakSanitizer, UndefinedBehaviorSanitizer and libFuzzer;
their runtimes are `.dylib` files loaded from the toolchain or the binary's
directory, an exception to [hermeticity](../design/hermeticity.md) for test
builds ([sanitizers](../features/sanitizers.md)).

## How the macOS SDK and Linker Work

### Apple's SDK without Xcode

Apple's macOS SDK is distributed inside the Command Line Tools `.pkg` archive on
`swcdn.apple.com`, listed in Apple's software update catalogs
(`swscan.apple.com`) without an Apple ID. The `.pkg` is a `xar` archive whose
`Payload` is a `pbzx` stream of `xz` chunks containing a `cpio` archive.
`xclang` reads `xar`, `pbzx`, `xz` and `cpio` with its own code, so
`xclang sdk fetch macos` works on Linux, Windows and macOS without macOS tools.

During extraction, `xclang` unpacks
`Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk` and leaves out
`usr/bin/`, `usr/share/` (whose man page names contain `:` characters that
Windows file systems reject) and `System/Library/Perl/`. On Windows, symbolic
links in the SDK are created as directory junctions and file hard links by
default (`--links junction`), which require no elevated privileges.

Unlike the [Windows MSVC targets](windows.md#config-files-and-object-directives),
which need generated config files to pass MSVC and Windows SDK version
subdirectories, a macOS SDK needs only its root directory. Putting
`-isysroot <CFGDIR>/../sdk/macos` directly in the Linux and Windows target
config files allows an explicit `-isysroot` on the command line to work even
when no SDK has been fetched into the toolchain.

### Packages Apple Withdraws and Content Digests

Apple's software update catalogs list the Command Line Tools packages current
for each macOS version. Periodically Apple withdraws a package (returning `403`
or `404` on `swcdn.apple.com`) and posts a re-signed package in its place whose
outer archive bytes differ while the SDK inside is unchanged: when product
`142-50405` replaced `082-83364`, all 18,516 files of its macOS `26.5` SDK were
identical.

To survive withdrawn packages without sacrificing reproducibility,
`xclang/sdk-versions.json` pins each macOS package twice: by the `.pkg`
archive's `sha256` and by the content digest of the SDK inside it. When Apple's
CDN returns `403` or `404` for the pinned URL, `xclang sdk fetch` (and the
[Bazel](../integrations/bazel.md) module's fallback) reads Apple's catalogs,
inspects the start of candidate packages' `Payload` to find the requested SDK
version, and accepts the package once its unpacked SDK matches the pinned
content digest.

The content digest is the `sha256` of the SDK's manifest, which has one line per
regular file and symbolic link under
`Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk/` in the package's
`cpio` payload (including the man pages, tools and Perl files that `xclang`
leaves out on disk), sorted byte-by-byte by path:

```text
file <sha256 of its bytes> <path>
link <sha256 of its target> <path>
```

Each line ends with a newline, `<path>` is relative to the SDK directory with
`/` separators, and a hard link is hashed as a `file` with its bytes.
Directories, file modes, modification times and how `xclang` creates links on
Windows do not affect the digest; `pkgutil --expand-full` on a Mac unpacks the
same tree.

Four consequences follow from this pinning model:

- **A version Apple no longer carries fails**: when Apple replaces an SDK
  version in its catalogs (for example, when `27.2` replaced `27.0`), no catalog
  package carries the old version, and fetching it fails with a list of the
  versions Apple's catalogs currently offer.
- **One version string is not one SDK**: earlier Command Line Tools builds of
  SDK `26.5` differed from the pinned `26.5` in 9 files; a package for the same
  version string whose SDK content differs from the pinned digest is refused.
- **`--version latest` is not reproducible**: it takes whatever newest SDK
  Apple's catalogs list at the time it runs, which may be newer than the version
  table and unpinned.
- **xclang keeps no mirror**: xclang never caches or redistributes Apple's
  packages on its own servers. A `.pkg` you save in the `--cache` directory of
  `xclang sdk fetch`, or in Bazel's repository cache or `--distdir`
  ([CI](../integrations/ci.md)), continues to build after Apple removes that
  version from its CDN.

### Why ld64.lld and Patch 0007

Using `ld64.lld` on macOS as well as Linux and Windows gives every host the same
Mach-O linker, supports LTO with the compiler's own LLVM version without loading
an external `libLTO.dylib` via `-lto_library`, and accepts the same flags on
every host for the ThinLTO cache (`-cache_path_lto`) and relative debug maps
(`-oso_prefix`).

When `clang` compiles and links in a single command with ThinLTO, it passes
`-object_path_lto` to the linker. With `-object_path_lto`, the LTO backend
writes an empty object file first whose only symbol, `ltmp0`, has the same
address as the function that follows it (`main`). Upstream `ld64.lld` collected
unwind entries from every symbol in code sections, so the empty unwind entry of
`ltmp0` overwrote `main`'s entry in `__unwind_info` on `arm64`, preventing
exceptions from unwinding through `main` (`llvm/llvm-project#224949`, fixed by
`llvm/llvm-project#225055`). [Patch 0007](../reference/patches.md) carries that
fix in xclang.

Xcode 27's macOS 27 SDK also introduced a new architecture name, `arm64e.x1`, in
the `.tbd` stubs of `libSystem` and the system frameworks, which LLVM's TextAPI
in xclang supports.

## Limitations

- **No app bundle resource compilers off macOS**: compiling asset catalogs and
  `.nib` or `.xib` files requires Apple's `actool` and `ibtool`, which run only
  on macOS. Command-line programs, `.dylib` shared libraries and code frameworks
  build on every host.
- **Ad-hoc signing only**: the linker signs binaries ad hoc; signing with a
  Developer ID certificate and notarizing require Apple's tools and an Apple
  Developer account.
- **Apple's license**: the macOS SDK is used under Apple's license terms, which
  you accept when running `xclang sdk fetch macos --accept-license`
  ([cross-compiling](cross-compiling.md#why-vendor-sdks-are-fetched-not-shipped)).
- **iOS, tvOS, watchOS and visionOS**: the SDKs for iOS, tvOS, watchOS,
  visionOS and their simulators ship only inside full Xcode downloads that
  require an Apple ID, so no unattended fetch can download them; support for
  those targets is [in research](../design/roadmap.md#ios).
