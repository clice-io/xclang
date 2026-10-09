# macOS

The macOS targets, `aarch64-apple-darwin` and `x86_64-apple-darwin`, build
against Apple's SDK, with xclang's own libc++ linked in, and link with
ld64.lld.

## Summary

Apple's SDK cannot be redistributed. On a macOS host it comes from Xcode.
On Linux and Windows hosts the user fetches it from Apple with the
`xclang` command, and the toolchain's config files use it from there.
Programs carry their own libc++ and run on macOS 13 or later. ld64.lld
links them on every host, which took a patch to lld.

## The SDK Is Xcode's

Apple's SDK holds the headers and `.tbd` stubs of libSystem and the
frameworks. No xclang archive has it, because it cannot be redistributed.
On a macOS host, clang finds it the usual way: the last `-isysroot`, else
`SDKROOT`, else the SDK of Xcode or the Command Line Tools (xcselect, as
`xcrun` finds it).

When Xcode 27 shipped the macOS 27 SDK, its `.tbd` stubs listed a new
architecture, `arm64e.x1`, that the TextAPI of LLVM 23.1.2 did not know.
ld64.lld rejected the stubs of libSystem and every framework, and no program
linked against the newest SDK. xclang carries LLVM's fix, which release/23.x
backported for 23.1.3, as [patch 0009](../reference/patches.md) from
23.1.2.6 on.

## The SDK on Linux and Windows Hosts

From 23.1.2.7 on, the macOS targets build from Linux and Windows hosts
too. The SDK is the one the user fetches from Apple, accepting Apple's
license ([vendor SDKs](vendor-sdks.md)):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch macos --accept-license
clang++ -O2 --target=arm64-apple-macos hello.cpp -o hello-macos-arm64
```

The fetch unpacks the SDK into the toolchain's `sdk/macos-<version>` and
points `sdk/macos` at it ([the SDK in use](../reference/xclang-command.md#the-sdk-in-use)).
On those hosts the config files of the macOS targets begin with
`-isysroot <CFGDIR>/../sdk/macos`, so a bare `--target` finds it. Which
SDK a compile uses:

| host | the SDK |
|---|---|
| macOS | the last `-isysroot`, else `SDKROOT`, else Xcode's (xcselect) |
| Linux, Windows | the last `-isysroot` of the command line, else `sdk/macos` |

On Linux and Windows clang does not read `SDKROOT`: it does so only when
there is no `-isysroot`, and the config file has one. Build systems that
honor `SDKROOT` pass it as `-isysroot`, which wins: cargo and rustc, and
the CMake package ([CMake](../integrations/cmake.md#build-for-macos-from-linux-or-windows)).
Without the SDK, clang warns that `sdk/macos` does not exist and finds no
C header.

Why a fixed path in the config file, and not a config file that the fetch
writes, as the MSVC targets have
([Windows](windows.md#msvc-targets)): a macOS SDK needs no versions or
options besides its path, and an `-isysroot` of the command line still
works when no SDK is fetched into the toolchain.

The programs are those of a macOS host: the same libc++, linker, dSYMs,
universal programs and sanitizers. ld64.lld signs arm64 programs ad hoc,
as Apple's `ld` does, so they run on Apple silicon without `codesign`;
`llvm-install-name-tool` signs them again when it changes them. CI builds
them on Linux and Windows hosts, x64 and arm64, and runs them on arm64 and
x64 Macs ([testing](../dev/testing.md#macos-from-linux-and-windows)).

## xclang's libc++, Not the System's

The config file puts xclang's libc++ headers on the C++ include path and
its `libc++.a` ahead of the SDK's `libc++.tbd`. So programs link libc++
and libc++abi statically, as on the other targets. The unwinder is the
system's, in libSystem.

- The system's `libc++.dylib` is the libc++ of the OS version, not the one
  the headers came from. Apple marks newer library features as needing a
  newer macOS. With the library inside the program, its features depend on
  the xclang release, not on the macOS version the program runs on.
- Every target has the same libc++, so the C++ of a program behaves the
  same on macOS, Linux and Windows.

Programs run on macOS 13.0 and later. The config file passes
`-mmacos-version-min=13.0`; a later one on the command line replaces it.

## ld64.lld

macOS targets link with ld64.lld, on macOS hosts too. `-fuse-ld=ld`
selects Apple's `ld` instead, for objects without LTO. Apple's `ld` reads
LTO bitcode through Xcode's `libLTO.dylib`, which cannot read the bitcode
of a newer LLVM. xclang carries no `libLTO.dylib` of its own since
23.1.2.7, as it carries no LTO plugin for the system linkers of the other
hosts either; before, it was 120 MB of every macOS host's archive.

Why the LLVM linker and not Apple's:

- **The same linker on every host.** A macOS target built from Linux or
  Windows needs ld64.lld. Using it on macOS too means one linker to test.
- **LTO with the same LLVM.** Apple's `ld` does LTO through a
  `libLTO.dylib`, which must match the LLVM version of the compiler. It
  loads one given by `-lto_library` only by an absolute path, and under
  Bazel that took a wrapper script. ld64.lld is the LLVM it was built
  with.
- **The same flags in every build** for the ThinLTO cache
  (`-cache_path_lto`) and relative debug maps (`-oso_prefix`).

### The Patch It Took

In the tests of the first release, a program compiled and linked by one
clang command with ThinLTO terminated on arm64 instead of catching its own
exception. LLVM's own ld64.lld did the same. xclang switched macOS targets
to Apple's `ld` for the next releases while the cause was found.

When clang compiles and links in one command, it passes
`-object_path_lto`. With it, the LTO backend writes an empty object first,
and that object's only symbol, `ltmp0`, has the address of what follows
it: `main`. ld64.lld collected unwind entries from every symbol in code, so
the empty entry of `ltmp0` took the place of `main` in `__unwind_info`. Then
`main` could not be unwound through. Two diagnostic runs, with and without
upstream's fix (llvm/llvm-project#225055), confirmed it was exactly that.

[Patch 0007](../reference/patches.md) carries the fix. From 23.1.2.5 on,
the macOS targets link with ld64.lld everywhere, and from 23.1.2.6 on
xclang's own macOS builds do too.

## Debug Information

A macOS program keeps its DWARF in the object files, which its debug map
names by path, and dsymutil collects it into a dSYM. Two things follow,
both handled in the build integrations:

- **The paths.** The debug map names each object by its absolute path, so
  the same program linked in two directories differs. Bazel links pass
  `-oso_prefix .`, and the map names `bazel-out/...`.
- **ThinLTO's objects.** With ThinLTO, the code is in the objects of the LTO
  backend, which the linker deletes. So xclang makes the dSYM in the link
  ([why a dSYM comes from the link](../features/debugging.md#why-a-dsym-comes-from-the-link)).

A shipped program is stripped with `--strip-all`, as Apple's `strip`
does ([strip](../features/debugging.md#strip)).

## Two Architectures

The arm64 and x86_64 targets are both in every archive. To CMake, the
other macOS architecture is `CMAKE_OSX_ARCHITECTURES`, not
cross-compiling. x86_64 programs run on arm64 Macs through Rosetta, but
not the reverse. The x86_64 macOS toolchain itself is cross-compiled on
arm64 macOS, as the Linux and Windows hosts' are on Linux x64: its table
generators are built for arm64 first, so no x86_64 program runs during the
build. Its programs run in the tests, on an x86_64 Mac.

## Sanitizers

ASan, TSan, LSan, UBSan and libFuzzer work as on Linux, and so does the
ASan libc++. Their runtimes are dylibs on macOS, loaded from the toolchain
or from the directory of the program. That is the one exception to
[hermeticity](hermeticity.md#known-limitations), for test builds.

## Not Yet Supported

| | status |
|---|---|
| [macOS targets from Linux and Windows hosts in the Bazel module](roadmap.md#macos-any-host-bazel) | Unreleased |
| [iOS, tvOS, watchOS, visionOS and their simulators](roadmap.md#ios) | In research |

## Known Limitations

- **No app bundles' resources off macOS.** Asset catalogs and nibs need
  Apple's `actool` and `ibtool`, which run only on macOS. Command-line
  programs, dylibs and frameworks of code build on every host.
- **No notarization.** Programs are signed ad hoc by the linker. Signing
  with a Developer ID and notarizing need Apple's tools and an Apple
  account.
- **Apple's license.** The SDK is used under Apple's terms, which the user
  accepts when fetching it ([vendor SDKs](vendor-sdks.md)).
