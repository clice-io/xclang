# The Bazel Module

xclang's Bazel module (`packages/bazel`) makes C++ builds hermetic and
cacheable across checkouts and machines: every toolchain and SDK file an
action reads is a declared Bazel input, no command line or build output
contains an absolute path (except for Xcode's SDK and native sanitizer rpaths
on macOS hosts), and `cc_library` dependencies link statically into programs
and tests by default. How to set up and use the module is in
[Bazel](../integrations/bazel.md), and its labels, flags and features are in
the [Bazel API](../reference/bazel-api.md).

## Every Toolchain File Is an Input

The `xclang_toolchain` repository rule downloads the host toolchain archive by
its pinned `sha256` from `bazel/versions.bzl`. Every file of the archive that
a compile or link action reads is declared in its `cc_toolchain` filegroups:
the binaries in `bin/`, `clang`'s resource headers, the target's sysroot
headers and shared `libc++` / `mingw-w64` headers for compiling, and the
target's sysroot libraries and `compiler-rt` for linking. Vendor SDKs fetched
by the module extension are declared inputs in the same way
([below](#vendor-sdks-as-repositories)); the only host path outside Bazel is
Xcode's macOS SDK on macOS hosts, located by `xcrun --show-sdk-path`.

Before the module existed, xclang's Bazel setup wrapped a `clang` found on
`PATH` with no declared toolchain files, which broke caching in two ways:

- Any change to `PATH` invalidated the toolchain repository and rebuilt the
  workspace.
- Upgrading `clang` on `PATH` changed no action input, so the build cache
  continued serving object files from the previous compiler.

Declaring every toolchain file as an action input fixes both: upgrading the
`xclang` module changes the input digests of every compile and link action and
triggers a rebuild, while building with the same release in another directory
or on another machine shares cache hits.

The trade-off is sandbox staging: Bazel's sandbox creates links for thousands
of declared toolchain files on every compile and link action. On Windows
hosts, Bazel runs actions without a sandbox by default (unless
`--experimental_use_windows_sandbox` is enabled), so missing input
declarations are caught by Linux and macOS builds of the same targets instead;
and because Bazel's default output root on Windows exceeds path length limits
when staging deep toolchain and SDK trees, Windows hosts set
`startup --output_user_root=C:/b`
([on a Windows host](../integrations/bazel.md#on-a-windows-host)).

## No Absolute Paths

A disk or remote cache can reuse an action across directories and machines
only when both the action command line and the action outputs contain no
checkout-, output-base- or sandbox-specific paths. `packages/bazel` removes
absolute paths from every compile, module and link action:

- **Rewritten config files**: `clang` resolves `<CFGDIR>` in a config file to
  an absolute path, which then enters `.d` dependency files. During repository
  setup, `_bazel_cfg` (`bazel/repositories.bzl`) writes copies of each
  target's config files into `cfg/` with `<CFGDIR>/..` replaced by
  `external/<repository>` and `-resource-dir=external/<repository>/lib/clang/<major>`,
  and the toolchain passes `--no-default-config --config=external/<repository>/cfg/<target>.cfg`.
- **Relative tool prefixes**: `-no-canonical-prefixes` in compile and link
  flags, and wrapper scripts (`scan_deps` and `dsym_link`) that locate tools
  relative to their own directory.
- **Debug information and binary timestamps**: `-ffile-compilation-dir=.` on
  every compile; `-Wl,-oso_prefix,.` on macOS links;
  `-Wl,--no-insert-timestamp` on MinGW links; and on MSVC targets
  `-mno-incremental-linker-compatible` and `-gno-codeview-command-line` on
  compiles (keeping Windows launcher paths out of CodeView records),
  `-Wl,/Brepro` on links, `/pdbsourcepath:.` for PDB source paths, and PDB
  names embedded without a directory prefix
  ([paths in debug information](../features/debugging.md#paths-in-debug-information)).
- **C++20 module files**: `-Xclang -fmodule-file-home-is-cwd` so `.pcm` files
  record input paths relative to the execution root, and
  `-Xclang -fmodules-embed-all-files` (`modules_embed_all_files`, on by
  default) so importers compiled with `-g` read source text from the `.pcm`
  itself inside the sandbox
  ([build caches and modules](../features/modules.md#build-caches-and-modules)).
- **Preprocessor timestamps**: `-Wno-builtin-macro-redefined` with `__DATE__`,
  `__TIME__` and `__TIMESTAMP__` defined to `"redacted"`.

Two absolute paths remain on macOS hosts: Xcode's SDK path (`-isysroot`),
which comes from the host machine, and `-Wl,-rpath,<absolute_root>/lib/clang/<major>/lib/darwin`
when a sanitizer feature is enabled for a native macOS build so the binary
finds the sanitizer `.dylib` at run time.

## A Toolchain per Host and Target

Because every host archive contains the sysroots and runtimes for all bundled
targets, the module registers a `cc_toolchain` for every `(host, target)`
pair: `exec_compatible_with` the host OS and CPU, and `target_compatible_with`
the target platform. Bazel selects the toolchain matching the host machine and
the `--platforms` target, and downloads only that host's toolchain archive.

For targets that require a vendor SDK (the MSVC targets, and the macOS targets
on Linux and Windows hosts), a build without the corresponding tag in the root
`MODULE.bazel` resolves to a toolchain that fails immediately at analysis time
and prints the required `xclang.windows_sdk` or `xclang.macos_sdk` tag.

The platforms in `@xclang//platforms:<target>` declare `@platforms//os`,
`@platforms//cpu` and a C library constraint (`@xclang//platforms/libc:glibc`,
`:musl`, `:mingw`, `:macosx` or `:msvc`). Because the musl toolchains
(`//bazel/toolchains/musl:all`) and MSVC toolchains
(`//bazel/toolchains/msvc:all`) require `:musl` or `:msvc` and are registered
in `MODULE.bazel` ahead of `//bazel/toolchains:all` (which match on OS and CPU
alone), a custom `platform` without a `libc` constraint defaults to `glibc` on
Linux and MinGW on Windows.

## rules_cc's Config, Copied

Changing a `.bzl` file in another Bazel module through
`single_version_override` patches only works when placed in the root
`MODULE.bazel`, which would require every project using `xclang` to carry
patch files in its own repository; and patching the build's `rules_cc`
repository in place breaks whenever a new `rules_cc` version edits nearby
lines (as `rules_cc` 0.2.28 did). Migrating to `rules_cc`'s rule-based
toolchain API would have required reimplementing `--macos_minimum_os`,
`libtool`, dead stripping and sanitizer features.

`packages/bazel/bazel/unix_cc_toolchain_config.bzl` therefore carries xclang's
own copy of `rules_cc` 0.2.28's `unix_cc_toolchain_config.bzl`. Because the
copy loads only public files from `rules_cc`, `apple_support` and
`bazel_skylib`, it works with any `rules_cc` 0.2.25 or later without a consumer
override.

Compared to upstream `rules_cc`, xclang's config and `bazel/toolchain.bzl`
add:

- `.exe` and `.dll` output names for MinGW and MSVC targets, and no `rpath` on
  Windows;
- MSVC target support using the GNU-style `clang` driver with `lld-link`
  flags, `-std=c++17` by default, no PIC, PDB generation
  (`generate_pdb_file`), CRT selection (`dynamic_link_msvcrt`, `debug_msvcrt`),
  and runtime DLL staging (`copy_dynamic_libraries_to_binary`);
- static linking of `cc_library` dependencies by default
  ([below](#static-by-default));
- external repositories' headers passed via `-isystem`
  (`external_include_paths` on by default) so dependency warnings do not fail
  the build;
- sanitizer flags, switching to the prebuilt ASan `libc++` under `asan`,
  building `libc++`, `libc++abi` and `libunwind` from `libc++/src` under
  `--@xclang//runtimes:source`, and supporting MemorySanitizer (`msan`) on the
  glibc Linux targets
  ([runtimes from source](../features/runtimes-from-source.md));
- `gc_sections` enabled in `opt` on Linux and disabled by default on Windows
  ([`gc-sections` and static initializers](windows.md#gc-sections-and-static-initializers));
- macOS links without `-fobjc-link-runtime` unless `macos_default_link_flags`
  is enabled, `--macos_minimum_os` clamped to at least `13.0`, library objects
  passed between `--start-lib` and `--end-lib` on Linux and macOS (so
  `dsymutil` never confuses same-named archive members with zeroed Bazel
  timestamps), and `dsym_link` generating the `.dSYM` bundle during the link
  with `dsymutil --linker classic` (avoiding DWARF 5 line tables from LLVM
  23's parallel linker that crash `atos`;
  [why a dSYM comes from the link](../features/debugging.md#why-a-dsym-comes-from-the-link));
- format-specific binary stripping (`--strip-unneeded` for ELF and COFF,
  `--strip-all` with `-Wl,-no_exported_symbols` in `opt` for Mach-O;
  [strip](../features/debugging.md#strip));
- library `defines` passed to C++20 module compiles and `clang-scan-deps`
  scans on macOS as on Linux and Windows.

## Static by Default

By default, `rules_cc` links `cc_library` dependencies of `cc_test` targets as
separate shared libraries when `supports_dynamic_linker` is enabled. Because
every shared library linked by xclang carries its own private static `libc++`
([one `libc++` per shared object](hermeticity.md#one-libc-per-shared-object)),
linking each `cc_library` as a shared object gave each library a separate
`libc++` instance (causing `kotatsu`'s tests to crash at startup with a double
free, and failing to link on Windows).

The toolchain config therefore disables `supports_dynamic_linker` by default
so `cc_library` targets link statically into executables and tests.
`cc_binary(linkshared = True)` still produces shared libraries (`libfoo.so`,
`libfoo.dylib`, `foo.dll`), and `features = ["supports_dynamic_linker"]`
re-enables dynamic linking for Linux targets.

## Vendor SDKs as Repositories

The MSVC targets require Microsoft's CRT, STL and Windows SDK, and the macOS
targets on Linux and Windows hosts require Apple's macOS SDK. Whereas plain
`clang` and CMake unpack fetched SDKs into `<toolchain>/sdk/` with the
[`xclang` command](../reference/xclang-command.md), a Bazel build cannot write
into the toolchain repository and must declare every SDK file as an input.
`bazel/sdk.bzl` manages each vendor SDK as its own external repository:

- **License acceptance in the root `MODULE.bazel`**: only `xclang.windows_sdk`
  and `xclang.macos_sdk` tags in the root module (`mod.is_root`) take effect,
  so a dependency module cannot accept a vendor license on behalf of its
  consumers.
- **Bazel downloads, `xclang` unpacks**: the repository rule runs
  `xclang sdk packages <vendor> --json` to query the pinned package URLs,
  sizes and `sha256` digests, downloads them with `rctx.download` into Bazel's
  shared repository cache (applying any configured Bazel mirror, proxy or
  `--distdir`), and invokes `xclang sdk fetch <vendor> --accept-license --cache downloads --sdk-dir sdk` to unpack the archive and create
  case-folding links on case-sensitive file systems. When Apple withdraws a
  pinned macOS Command Line Tools package, `xclang sdk fetch` locates the
  replacement package in Apple's catalogs and verifies the unpacked SDK by its
  content digest
  ([packages Apple withdraws](macos.md#packages-apple-withdraws-and-content-digests)).
- **Generated `sdk.cfg`**: each SDK repository writes `sdk.cfg` with paths
  relative to the execution root (`-isysroot external/<repo>/sdk/<name>` for
  macOS, and the rewritten `<arch>-pc-windows-msvc.cfg` naming the MSVC and
  Windows SDK version directories for MSVC targets), which the toolchain's
  `cfg/<target>.cfg` includes via `@../../<sdk_repo>/sdk.cfg`.
- **Lazy per-architecture repositories**: `xclang_windows_sdk_x86_64` (310 MB
  download), `xclang_windows_sdk_aarch64` (380 MB download) and
  `xclang_macos_sdk` are fetched only when a build targets that platform.
- **Split compile and link filegroups**: `BUILD.bazel` in the SDK repository
  exports `:compiler_files` and `:linker_files` via `glob()`. For the macOS
  SDK, `_unlink_cycles` removes directory symlink cycles (such as
  `Ruby.framework`'s `Headers/ruby/ruby -> .`) before `glob()` runs;
  `:compiler_files` stages the headers and frameworks (15,000 files) and
  `:linker_files` stages the `.tbd` stubs and `SDKSettings.*` (9,800 files).
  For an MSVC target, `:compiler_files` declares 7,300 headers and links and
  `:linker_files` declares 1,300 libraries.

## The Registry

After `published.yml` builds and tests a release tag against the published
release assets, `node packages/bazel/bazel.ts archive` builds
`xclang-bazel-<version>.tar.gz` and publishes the module to
[bazel.clice.io](https://bazel.clice.io). `bazel.ts` constructs the `ustar`
archive deterministically in memory—sorted entries, `0755`/`0644` permissions,
zeroed owner and timestamp fields, and gzip's OS header byte set to `255`—so
the registry archive is identical byte for byte on every host.
