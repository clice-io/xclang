# Toolchain Structure

`clang` locates each target's sysroot, headers, runtimes and linker through a
plain-text config file in `bin/` rather than defaults compiled into the
compiler. `clang`, `lld` and most binary tools share one multicall executable
(`llvm`), and the sysroots and shared headers are plain directories without
symbolic links on Windows or in the Linux sysroots. Passing
`--target=<triple>` is therefore the whole difference between a native and a
cross build, `-stdlib=platform` switches to the platform's C++ library, and
`--no-default-config` restores a bare upstream `clang`
([cross-compiling](../guide/cross-compiling.md#how-clang-finds-a-target-s-files),
[archive layout](../reference/layout.md)).

## A Config File per Target

When compiling or linking for a target, `clang` searches `bin/` next to its
own executable for `<triple>.cfg` (`clang-cl` searches for
`<triple>-clang-cl.cfg`) and prepends the file's flags to the command line.
For `--target=aarch64-w64-mingw32`, `clang` normalizes the triple and reads
`aarch64-w64-windows-gnu.cfg`. `toolchain/common.ts` writes a config file into
`bin/` for every accepted spelling of each target:

| target | config files in `bin/` |
|---|---|
| Linux (glibc) | `<arch>-unknown-linux-gnu.cfg`, `<arch>-pc-linux-gnu.cfg` |
| Linux (musl) | `<arch>-unknown-linux-musl.cfg`, `<arch>-pc-linux-musl.cfg` |
| Windows (MinGW) | `<arch>-w64-windows-gnu.cfg`, `<arch>-pc-windows-gnu.cfg` |
| macOS | `<arch>-apple-darwin.cfg`, `<arch>-apple-macos.cfg`, `<arch>-apple-macosx.cfg` |
| Windows (MSVC) | `<arch>-pc-windows-msvc.cfg`, `<arch>-unknown-windows-msvc.cfg`, and for `clang-cl` `<spelling>-clang-cl.cfg` |

`<arch>` is `x86_64`, or for 64-bit Arm both `aarch64` and `arm64`. Because
`compiler-rt` installs its libraries under the canonical `<arch>-unknown-linux-*`
and `<arch>-w64-windows-gnu` directory names,
[patch 0013](../reference/patches.md) maps the `-pc-` and `arm64-` spellings of
the Linux and MinGW targets back to that runtime directory.

Each target config file sets the following options
([`toolchain/config/`](https://github.com/clice-io/xclang/tree/main/toolchain/config)):

| target | options in `<spelling>.cfg` |
|---|---|
| Linux (glibc) | `--sysroot=<CFGDIR>/../<triple>`, `-stdlib++-isystem` for the target's `__config_site` and shared `libc++` headers, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-static-libstdc++ -static-libgcc`, `-fuse-ld=lld` |
| Linux (musl) | the same with `-static` in place of `-static-libstdc++ -static-libgcc`, linking `musl` statically as well ([musl targets](../guide/cross-compiling.md#musl-targets)) |
| Windows (MinGW) | `--sysroot=<CFGDIR>/../<triple>`, `-stdlib++-isystem` for the target's `__config_site` and shared `libc++` headers, `-idirafter <CFGDIR>/../mingw-w64/include`, `-rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++`, `-fuse-ld=lld` (the sysroot contains static libraries only) |
| macOS | on Linux and Windows hosts `-isysroot <CFGDIR>/../sdk/macos` (on macOS hosts Xcode's SDK); `-mmacos-version-min=13.0`, `-fuse-ld=lld`; `-stdlib++-isystem` for the target's `__config_site` and shared `libc++` headers, `-L<CFGDIR>/../<triple>/lib` (placing `libc++.a` ahead of the SDK's `libc++.tbd`), and `-B<CFGDIR>/../<triple>/lib` for `libc++.modules.json` ([macOS](macos.md)) |
| Windows (MSVC) | on Linux and macOS hosts `-Xmicrosoft-windows-sys-root <CFGDIR>/../sdk/windows` (`/winsysroot` in `clang-cl`); `@<triple>-sdk.cfg` (`@<triple>-clang-cl-sdk.cfg`), rewritten by `xclang sdk` to include the active SDK's version config; `-fuse-ld=lld`; object directives for `clang_rt.builtins-<arch>.lib` and the hybrid CRT (`--linker-option=/nodefaultlib:libucrt.lib`, `--dependent-lib=ucrt.lib`); `-D_STATIC_INLINE_UCRT_FUNCTIONS=0`; and `-stdlib++-isystem` (`/clang:-stdlib++-isystem` in `clang-cl`, silenced on C compiles by [patch 0011](../reference/patches.md)) for `libc++` ([Windows](windows.md#config-files-and-object-directives)) |

`<CFGDIR>` expands to `bin/`, so the toolchain works from any unpacked
directory without modification. Because `clang` loads the config file for the
host's default target as well, a native `clang++ main.cpp` on Linux compiles
against the bundled glibc 2.17 sysroot and links `libc++` statically.

Two additional config-file rules avoid surprises in `clang-cl` and Bazel:

- **`clang-cl` defaults to the host architecture's MSVC target.** When run
  without `--target`, `clang-cl` searches for `<default-target>-clang-cl.cfg`
  and `<default-target>.cfg` before switching to an MSVC triple.
  `toolchain/common.ts` writes the MSVC `clang-cl` config of `<arch>` to
  `<spelling>-clang-cl.cfg` (and `<spelling>-clang-cl-system.cfg`) for every
  target spelling, so a plain `clang-cl` builds for `<arch>-pc-windows-msvc`
  instead of reading the host target's GNU flags.
- **Bazel rewrites the config files with relative paths.** `clang` expands
  `<CFGDIR>` to an absolute path, which enters `.d` dependency files and
  breaks cross-machine action caching. The Bazel module writes copies of the
  config files under `cfg/` with paths relative to the execution root and
  passes `--no-default-config --config=<file>`
  ([no absolute paths](bazel-module.md#no-absolute-paths)).

### The Platform's C++ Library

Every `<spelling>.cfg` has a companion `<spelling>-system.cfg` (and
`<spelling>-clang-cl-system.cfg`). Passing any `-stdlib=` value other than
`libc++` (`-stdlib=platform` or `-stdlib=libstdc++`; in `clang-cl`,
`/clang:-stdlib=platform`) selects `<spelling>-system.cfg` in place of
`<spelling>.cfg` ([patch 0018](../reference/patches.md),
[cross-compiling](../guide/cross-compiling.md#the-platform-s-c-library)):

| target | options in `<spelling>-system.cfg` |
|---|---|
| Linux (glibc), Linux (musl), Windows (MinGW) | `-fuse-ld=lld` only; the C and C++ libraries come from the host, a distribution's cross packages, or `--sysroot` |
| macOS | the SDK (`-isysroot <CFGDIR>/../sdk/macos` on Linux and Windows hosts), `-mmacos-version-min=13.0`, `-fuse-ld=lld`, linking the SDK's `libc++.tbd` |
| Windows (MSVC) | the MSVC target config without `-stdlib++-isystem`, using Microsoft's STL from the fetched SDK or Visual Studio |

Switching config files is necessary because flags in `<spelling>.cfg` cannot
be undone later on the command line: `-stdlib++-isystem` adds `libc++` headers
regardless of `-stdlib=`, `-L<CFGDIR>/../<triple>/lib` on macOS puts
`libc++.a` before the SDK's `libc++.tbd`, and the bundled Linux and MinGW
sysroots do not carry `libstdc++`.

### Why Not Built-In Defaults

LLVM can compile defaults for the C++ library, compiler runtime, unwinder and
linker directly into the driver (`CLANG_DEFAULT_CXX_STDLIB`,
`CLANG_DEFAULT_RTLIB`, `CLANG_DEFAULT_UNWINDLIB`, `CLANG_DEFAULT_LINKER`), as
xclang 23.1.2.1 did. Those settings are compiled into `clangDriver`, which is
also part of `libclang`.

Tools built on `libclang` (such as clice) run `clangDriver` to compute
include paths from `compile_commands.json` entries for other compilers. With
defaults compiled into `clangDriver`, a `g++` command in a compilation
database received xclang's `libc++` include paths instead of `libstdc++`'s.

Keeping those `CLANG_DEFAULT_*` variables unset in
`toolchain/cmake/caches/clang.cmake` and placing the defaults in `bin/*.cfg`
separates the two: `bin/clang` reads `bin/<triple>.cfg`, while `clangDriver`
linked inside a `libclang` tool has no `bin/*.cfg` and behaves like upstream
`clang`.

### The Bare Compiler

Passing `--no-default-config` tells `clang` to ignore `bin/<triple>.cfg`.
`clang` then searches the host system's headers and libraries and invokes the
system linker, just as an unconfigured upstream build does
(`toolchain/sysroot.ts` and `toolchain/runtimes.ts` use `--no-default-config`
when building the sysroots and `libc++` themselves).

## One Program

`toolchain/cmake/caches/clang.cmake` sets `LLVM_TOOL_LLVM_DRIVER_BUILD=ON`,
which builds `clang`, `clang-scan-deps`, `lld` and most binary tools
(`llvm-ar`, `llvm-ranlib`, `llvm-lib`, `llvm-dlltool`, `llvm-nm`,
`llvm-objcopy`, `llvm-strip`, `llvm-install-name-tool`, `llvm-objdump`,
`llvm-readobj`, `llvm-rc`, `llvm-windres`, `llvm-symbolizer`, `dsymutil`,
`llvm-gsymutil`, `llvm-libtool-darwin`, `llvm-lipo`, ...) into one multicall
executable, `bin/llvm` (`bin/llvm.exe` on Windows).

Instead of each binary carrying a separate copy of the LLVM libraries, every
tool name in `bin/` is a symbolic link to `llvm` on Linux and macOS, or a
small launcher compiled from
[`toolchain/launcher/alias.c`](https://github.com/clice-io/xclang/blob/main/toolchain/launcher/alias.c)
on Windows that starts `llvm.exe <tool-name> <arguments>` inside a
kill-on-close job object ([the launchers](windows.md#the-launchers)). Together
with omitting glibc's `locale-archive`, linking with safe identical code
folding (`-Wl,--icf=safe -Wl,-O2` on Linux and Windows), and compressing all
host archives with `.tar.xz`, each host toolchain archive is about 100 MB
([releases](../reference/releases.md#assets)).

Linking the tools against a shared `libLLVM` (`LLVM_LINK_LLVM_DYLIB`) would
also share code, but was rejected for compile speed: calls across a shared
library boundary go through dynamic linker tables, and ThinLTO cannot inline
or optimize across it.

Five tools that LLVM's multicall driver build does not include are compiled as
standalone binaries in `bin/`: `llvm-profdata`, `llvm-cov`, `llvm-dwarfdump`,
`llvm-strings` and `FileCheck`.

### What `-###` Prints

Because `clang` is dispatched by the multicall `llvm` binary, `clang -###`
prints its `-cc1` command with `llvm` as the program and `"clang"` before
`"-cc1"`:

```text
"/path/xclang/bin/llvm" "clang" "-cc1" ...
```

Tools that parse `clang -###` output must scan for `"-cc1"` rather than
assuming `"-cc1"` is the first argument after the executable path.

## Plain Directories

Each target's sysroot (`<toolchain>/<triple>/`) is a plain directory containing
only what compiling and linking read: headers, startup files, C runtime
libraries, `libc++`, `libc++abi`, `libunwind` and the
[GCC stub archives](hermeticity.md#gcc-library-names), while `compiler-rt`
lives in `lib/clang/<major>/lib/`
([archive layout](../reference/layout.md)).

Headers that are identical across targets are stored once without symbolic
links (`shareHeaders` in `toolchain/common.ts`): `libc++/include/c++/v1` for
all targets, `libc++/include/<normalized-triple>/c++/v1` for each target's
`__config_site` (and `cxxabi.h` on non-MSVC targets), and `mingw-w64/include`
for both MinGW targets
([shared headers](../reference/layout.md#shared-headers)). `toolchain/package.ts`
verifies that Windows toolchain archives contain no symbolic links and that no
archive contains two paths differing only in case
([why glibc 2.17](hermeticity.md#why-glibc-2-17)).

Nothing in the sysroots or `compiler-rt` directory is specific to xclang's
build of `clang`. Any upstream `clang` of the same major version can
cross-compile against a target directory when given `--sysroot` and
`-resource-dir`.
