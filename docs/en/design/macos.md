# macOS

The macOS targets, `aarch64-apple-darwin` and `x86_64-apple-darwin`, are
built against Apple's SDK, with xclang's own libc++ linked in, by
ld64.lld. Each of those was a decision with a history.

## The SDK is Xcode's

Apple's SDK (the headers and `.tbd` stubs of libSystem and the frameworks)
cannot be redistributed, so no xclang archive has it. On a macOS host clang
finds it the usual way: `xcrun`, `SDKROOT`, or `-isysroot`. That is why the
macOS targets build on macOS hosts only today; from Linux or Windows, with
the SDK fetched from Apple by the user, is [in research](vendor-sdks.md).

When Xcode 27 shipped the macOS 27 SDK, its `.tbd` stubs listed a new
architecture, `arm64e.x1`, that LLVM 23.1.2's TextAPI did not know:
ld64.lld rejected the stubs of libSystem and every framework, and no
program linked against the newest SDK. xclang carries LLVM's fix, backported
to release/23.x for 23.1.3, as [patch 0009](patches.md), from 23.1.2.6.

## xclang's libc++, not the system's

The config file puts xclang's libc++ headers on the C++ include path and
its `libc++.a` ahead of the SDK's `libc++.tbd`, so programs link libc++ and
libc++abi statically, as on the other targets. The unwinder is the
system's, in libSystem.

- The system's `libc++.dylib` is the OS's version of libc++, not the one the
  headers came from; Apple marks newer library features as needing a newer
  macOS. With the library in the program, its features depend on xclang's
  release, not on the macOS version the program runs on.
- The same libc++ on every target: a program's C++ behaves the same on
  macOS, Linux and Windows.

Programs run on macOS 13.0 and later (`-mmacos-version-min=13.0` in the
config file; a later one on the command line replaces it).

## ld64.lld

macOS targets link with ld64.lld, on macOS hosts too; `-fuse-ld=ld` selects
Apple's `ld`, with xclang's `lib/libLTO.dylib` for LTO.

Why LLVM's linker and not Apple's:

- **The same linker on every host.** A macOS target built from Linux or
  Windows needs ld64.lld; using it on macOS too means one linker to test.
- **LTO with the same LLVM.** Apple's `ld` does LTO through a `libLTO.dylib`,
  which must be of the compiler's LLVM version, and loads one given by
  `-lto_library` only by an absolute path; under Bazel that took a wrapper
  script. ld64.lld is the LLVM it was built with.
- **The ThinLTO cache** (`-cache_path_lto`) and **relative debug maps**
  (`-oso_prefix`) with the same flags in every build.

It took a patch. In the first release's tests, a program compiled and linked
by one clang command with ThinLTO terminated on arm64 instead of catching
its own exception; LLVM's own ld64.lld did the same. xclang switched macOS
targets to Apple's `ld` for the next releases while the cause was found:
when clang compiles and links in one command, it passes
`-object_path_lto`, with which the LTO backend writes an empty object
first, and that object's only symbol, `ltmp0`, has the address of what
follows it, `main`. ld64.lld collected unwind entries from every symbol in
code, so `ltmp0`'s empty entry took `main`'s place in `__unwind_info`, and
`main` could not be unwound through. Two diagnostic runs with and without
upstream's fix (llvm/llvm-project#225055) confirmed it was exactly that.
[Patch 0007](patches.md) carries the fix, and from 23.1.2.5 the macOS
targets link with ld64.lld everywhere; from 23.1.2.6 xclang's own macOS
builds do too.

## Debug information

A macOS program's DWARF stays in the object files, which the program's
debug map names by path; dsymutil collects it into a dSYM. Two things
follow, both handled in xclang's build integrations
([debugging](../features/debugging.md)):

- **The paths.** The debug map names each object by its absolute path,
  so the same program linked in two directories differs; Bazel links pass
  `-oso_prefix .` and the map names `bazel-out/...`.
- **ThinLTO's objects.** With ThinLTO, the code is in the LTO backend's
  objects, which the linker deletes; a dSYM made after the link lacks every
  LTO-compiled function. xclang makes the dSYM in the link, keeping those
  objects with `-object_path_lto` and running dsymutil before they go.

A release's strip of a Mach-O program is `--strip-all`, what Apple's
`strip` does: keeping global function names would let `dladdr` name a local
function by the global before it in a crash log.

## Two architectures

The arm64 and x86_64 targets are both in every archive. To CMake the other
macOS architecture is `CMAKE_OSX_ARCHITECTURES`, not cross-compiling, and
x86_64 programs run on arm64 Macs through Rosetta (not the reverse), which
is how tests/smoke.ts runs them. The x86_64 macOS toolchain itself is
cross-compiled on arm64 macOS.

## Sanitizers

ASan, TSan, LSan, UBSan and libFuzzer, and libc++'s ASan build, as on
Linux. Their runtimes are dylibs on macOS, loaded from the toolchain or the
program's directory: the one exception to
[hermeticity](hermeticity.md#the-exceptions), for test builds.
