# macOS

How xclang's macOS targets, `xclang sdk fetch macos`, `ld64.lld` and the
macOS host toolchains are built and configured. How to compile for macOS
targets is in [cross-compiling](../guide/cross-compiling.md#macos).

## Why xclang's `libc++` and Not the System's

The macOS target config files put xclang's `libc++` headers
(`-stdlib++-isystem`) on the C++ include path and place xclang's static
`libc++.a` (which includes `libc++abi`) ahead of the SDK's `libc++.tbd`.
The unwinder is the system's, in `libSystem`
([hermeticity](hermeticity.md)).

Linking xclang's `libc++` statically has two advantages:

- **OS-independent C++ library features**: Apple's SDK marks newer `libc++`
  features with availability attributes tied to the macOS version whose
  `/usr/lib/libc++.1.dylib` first shipped them. With xclang's `libc++`
  linked into the binary, standard library features depend on the xclang
  release rather than the target macOS version (for example, `std::format`
  of a floating-point number works at `-mmacos-version-min=13.0`, whereas
  with the system's `libc++` it requires `13.3` or later).
- **Same `libc++` across platforms**: programs get the same `libc++`
  implementation on macOS, Linux and Windows.

Passing `-stdlib=platform` switches to `bin/<triple>-system.cfg`
([patch 0018](../reference/patches.md)), which keeps the SDK, deployment
target and `ld64.lld` and links `/usr/lib/libc++.1.dylib` of the OS
([cross-compiling](../guide/cross-compiling.md#the-platform-s-c-library)).

The `x86_64-apple-darwin` host toolchain itself is cross-compiled on
`arm64` macOS, with its table generators built for `arm64` first so that no
`x86_64` program runs under Rosetta during the build, and tested on an
`x86_64` Mac (`macos-15-intel`).

## Apple's SDK without Xcode

Apple's macOS SDK is distributed inside the Command Line Tools `.pkg`
archive on `swcdn.apple.com`, listed in Apple's software update catalogs
(`swscan.apple.com`) without an Apple ID. The `.pkg` is a `xar` archive
whose `Payload` is a `pbzx` stream of `xz` chunks containing a `cpio`
archive. `xclang` reads `xar`, `pbzx`, `xz` and `cpio` with its own code,
so `xclang sdk fetch macos` works on Linux, Windows and macOS without macOS
tools ([the `xclang` command](../reference/xclang-command.md)).

During extraction, `xclang` unpacks
`Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk` and leaves out
`usr/bin/`, `usr/share/` (whose man page names contain `:` characters that
Windows file systems reject) and `System/Library/Perl/`. On Windows,
symbolic links in the SDK are created as directory junctions and file hard
links by default (`--links junction`), which require no elevated
privileges.

Unlike the [Windows MSVC targets](windows.md#config-files-and-object-directives),
which need generated config files to pass MSVC and Windows SDK version
subdirectories, a macOS SDK needs only its root directory. Putting
`-isysroot <CFGDIR>/../sdk/macos` directly in the Linux and Windows target
config files allows an explicit `-isysroot` on the command line to work
even when no SDK has been fetched into the toolchain.

## Packages Apple Withdraws and Content Digests

Apple's software update catalogs list the Command Line Tools packages
current for each macOS version. Periodically Apple withdraws a package
(returning `403` or `404` on `swcdn.apple.com`) and posts a re-signed
package in its place whose outer archive bytes differ while the SDK inside
is unchanged: when product `142-50405` replaced `082-83364`, all 18,516
files of its macOS `26.5` SDK were identical.

To survive withdrawn packages without sacrificing reproducibility,
`xclang/sdk-versions.json` pins each macOS package twice: by the `.pkg`
archive's `sha256` and by the content digest of the SDK inside it. When
Apple's CDN returns `403` or `404` for the pinned URL, `xclang sdk fetch`
(and the [Bazel](../integrations/bazel.md) module's fallback) reads Apple's
catalogs, inspects the start of candidate packages' `Payload` to find the
requested SDK version, and accepts the package once its unpacked SDK matches
the pinned content digest.

The content digest is the `sha256` of the SDK's manifest, which has one line
per regular file and symbolic link under
`Library/Developer/CommandLineTools/SDKs/MacOSX<ver>.sdk/` in the package's
`cpio` payload (including the man pages, tools and Perl files that `xclang`
leaves out on disk), sorted byte-by-byte by path:

```text
file <sha256 of its bytes> <path>
link <sha256 of its target> <path>
```

Each line ends with a newline, `<path>` is relative to the SDK directory
with `/` separators, and a hard link is hashed as a `file` with its bytes.
Directories, file modes, modification times and how `xclang` creates links
on Windows do not affect the digest; `pkgutil --expand-full` on a Mac
unpacks the same tree.

Four consequences follow from this pinning model:

- **A version Apple no longer carries fails**: when Apple replaces an SDK
  version in its catalogs (for example, when `27.2` replaced `27.0`), no
  catalog package carries the old version, and fetching it fails with a list
  of the versions Apple's catalogs currently offer.
- **One version string is not one SDK**: earlier Command Line Tools builds
  of SDK `26.5` differed from the pinned `26.5` in 9 files; a package for
  the same version string whose SDK content differs from the pinned digest
  is refused.
- **`--version latest` is not reproducible**: it takes whatever newest SDK
  Apple's catalogs list at the time it runs, which may be newer than the
  version table and unpinned.
- **xclang keeps no mirror**: xclang never caches or redistributes Apple's
  packages on its own servers. A `.pkg` you save in the `--cache` directory
  of `xclang sdk fetch`, or in Bazel's repository cache or `--distdir`
  ([CI](../integrations/ci.md)), continues to build after Apple removes that
  version from its CDN.

## Why `ld64.lld` and Patch 0007

Using `ld64.lld` on macOS as well as Linux and Windows gives every host the
same Mach-O linker, signs `arm64` binaries ad hoc without invoking
`codesign`, supports LTO with the compiler's own LLVM version without
shipping a 120 MB `libLTO.dylib` or passing `-lto_library`, and accepts the
same flags on every host for the ThinLTO cache (`-cache_path_lto`) and
relative debug maps (`-oso_prefix`).

When `clang` compiles and links in a single command with ThinLTO, it passes
`-object_path_lto` to the linker. With `-object_path_lto`, the LTO backend
writes an empty object file first whose only symbol, `ltmp0`, has the same
address as the function that follows it (`main`). Upstream `ld64.lld`
collected unwind entries from every symbol in code sections, so the empty
unwind entry of `ltmp0` overwrote `main`'s entry in `__unwind_info` on
`arm64`, preventing exceptions from unwinding through `main`
(`llvm/llvm-project#224949`, fixed by `llvm/llvm-project#225055`).
[Patch 0007](../reference/patches.md) carries that fix in xclang.

Xcode 27's macOS 27 SDK also introduced a new architecture name,
`arm64e.x1`, in the `.tbd` stubs of `libSystem` and the system frameworks,
which LLVM's TextAPI in xclang supports.

## Debug Information on Mach-O

Mach-O links keep DWARF debug information in the `.o` object files and
record their paths in the executable's debug map (`N_OSO` stabs), from which
`dsymutil` collects a `.dSYM` bundle ([debugging](../features/debugging.md)):

- **Relative paths in the debug map**: by default, the debug map records
  each object file by its absolute path, so linking the same program in two
  directories produces different bytes. Bazel links pass `-oso_prefix .` so
  the debug map records relative `bazel-out/...` paths.
- **ThinLTO temporary objects**: with ThinLTO, the LTO backend writes
  temporary object files that the linker deletes when the link finishes, so
  xclang's [CMake](../integrations/cmake.md) and
  [Bazel](../integrations/bazel.md) integrations pass `-object_path_lto` and
  generate the `.dSYM` bundle during the link step
  ([why a dSYM comes from the link](../features/debugging.md#why-a-dsym-comes-from-the-link)).
- **Stripping**: release binaries strip with `llvm-strip --strip-all`
  (matching Apple's `strip`), and optimized Bazel builds pass
  `-Wl,-no_exported_symbols` so stripped executables retain no exported weak
  C++ symbols that `dladdr` would misattribute crash frames to
  ([strip](../features/debugging.md#strip)).

## The Sanitizers' dylibs

Both macOS targets support AddressSanitizer (with the ASan `libc++`),
ThreadSanitizer, LeakSanitizer, UndefinedBehaviorSanitizer and libFuzzer.
Their runtimes are universal `.dylib` files
(`libclang_rt.*_osx_dynamic.dylib` in `lib/clang/<major>/lib/darwin/`)
loaded at run time from the toolchain or the binary's directory, as a
test-only exception to [hermeticity](hermeticity.md)
([sanitizers](../features/sanitizers.md)). In xclang's toolchain build,
`compiler-rt` for Darwin is linked with `ZERO_AR_DATE=1` so object archive
timestamps do not enter the `.dylib` debug map or Mach-O UUID.
