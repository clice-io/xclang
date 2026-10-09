# The Bazel Module

Bazel's promise is that the outputs of a build are a function of its
declared inputs, cached by content and shared between machines. A C++
toolchain breaks that promise easily: a compiler found on `PATH`, headers
read from `/usr/include`, a sandbox path written into a dependency file.
This page says how xclang's Bazel module keeps the promise, and what that
costs.

## Summary

Every toolchain file an action reads is a declared input, and no command
line or output holds an absolute path. A new release rebuilds everything;
the same release in another checkout, or on another machine, hits the
cache. Libraries link statically into tests and programs. How to use the
module is in [Bazel](../integrations/bazel.md), and its rules and features
are in the [Bazel API](../reference/bazel-api.md).

## Every Toolchain File Is an Input

The module downloads the host archive by its sha256 into a repository.
Every file of it that an action reads is declared: the programs, the clang
resource headers and the target headers for compiling, the target
libraries and compiler-rt for linking. Nothing comes from the machine
except Xcode's macOS SDK on macOS hosts, which `xcrun` finds;
`--macos_minimum_os` sets the deployment target. The vendor SDKs a project
fetches are repositories too, their files inputs alike
([below](#vendor-sdks-as-repositories)).

Before the module, xclang's Bazel rules found clang on `PATH` and declared
nothing, the common way to wrap a local compiler. Two things went wrong:

- A change of `PATH` refetched the toolchain repository and rebuilt
  everything.
- A new compiler version on `PATH` rebuilt nothing. The cache served
  objects of the old compiler.

Declared inputs invert both. A new release changes the key of every action
and rebuilds. The same release in another checkout, or on another machine,
hits the cache.

The cost: thousands of declared files per action, which the Bazel sandbox
lays out for every compile. A sandboxed action costs more than one without
inputs. On a full build, this is a fraction of the compile time.

## No Absolute Paths

A disk or remote cache serves an action to another machine only if its
key is the same there, and the key holds the command line. A path into the
checkout, the output base or the sandbox makes every machine's key its
own. A path written into an output, such as a dependency file, debug
information or a module file, makes the output differ. The module removes
them:

- **Config files.** clang makes the directory of a config file absolute, and
  that path reaches the dependency files. The module writes each target's
  config file again with paths relative to the execution root
  (`external/xclang_<host>/...`), and passes
  `--no-default-config --config=<file>`.
- **clang's own paths**: `-no-canonical-prefixes`.
- **Debug information**: `-ffile-compilation-dir=.`; on macOS
  `-Wl,-oso_prefix,.`; on Windows `--no-insert-timestamp`
  ([paths in debug information](../features/debugging.md#paths-in-debug-information)).
- **Module files**: `-fmodule-file-home-is-cwd`, so a module file names its
  inputs relative to the execution root, and is the same wherever it is
  built.
- **`__DATE__`, `__TIME__` and `__TIMESTAMP__`** are redacted.

Two absolute paths remain on macOS hosts: Xcode's SDK path, which comes
from the machine, and the rpath of the sanitizer features to the
toolchain's runtimes. Only those sanitizer links depend on the checkout.
An MSVC target's PDB names its sources relative to the execution root
(`/pdbsourcepath:.`), and its program names the PDB without a directory;
its links are `/Brepro`, and its objects carry no time.

## A Toolchain per Host and Target

Each host archive carries every target. So the module registers, for every
host, a toolchain for every target: `exec_compatible_with` the host,
`target_compatible_with` the target. Bazel picks the one for the machine it
runs on and the platform it builds for, and only that host archive is
downloaded.

A target that needs a vendor SDK the root module does not fetch, an MSVC
target or a macOS one off macOS, gets a toolchain that fails at once and
says which tag fetches it. That is clearer than a compiler error later, or
"no toolchain found".

The toolchains ask a platform for its os and cpu only. The platforms of the
module add a C library constraint (`glibc`, `musl`, `mingw`, `macosx`,
`msvc`) for `select()`. The musl targets share an os and cpu with the glibc
ones, and the MSVC targets with the MinGW ones; they get toolchains of their
own through that constraint: theirs ask for `@xclang//platforms/libc:musl`
or `:msvc` too, and are registered ahead of the others, so a musl platform
gets them, an MSVC one too, and a platform without a C library gets glibc
on Linux and MinGW on Windows.

## rules_cc's Config, Copied

The toolchains are the unix toolchain config of rules_cc, with xclang's
changes:

- Windows names for MinGW and MSVC programs and shared libraries (`.exe`,
  `.dll`);
- for the MSVC targets, lld-link's spellings, no PIC, and features for the
  PDB, the C runtimes and Microsoft's STL;
- static linking by default (below);
- headers of other repositories as system headers (`-isystem`), whose
  warnings are not the build's;
- the link flags of the sanitizer features, and the ASan libc++ for `asan`;
- `gc_sections` off for Windows targets
  ([why](windows.md#gc-sections-and-static-initializers));
- a link program of the toolchain's own, which makes the dSYM in the link
  ([why](../features/debugging.md#why-a-dsym-comes-from-the-link)), with
  dsymutil's classic DWARF linker: the parallel one, LLVM 23's default,
  writes DWARF 5 line tables (macOS 15 and later) that atos crashes on;
- macOS deployment targets no older than 13.0, which xclang's libc++
  needs;
- a strip for shipped binaries, by object format
  ([strip](../features/debugging.md#strip)).

The obvious way to change a file of another module is a
`single_version_override` with patches. But Bazel honours an override only
in the root module, with patch files from the tree of the root module. So
every project using xclang would have to carry xclang's patches, and the
override would change the build's only rules_cc for everyone else in it.

So the module copies `unix_cc_toolchain_config.bzl` from rules_cc into a
repository of its own, and patches the copy. The copy loads only public
files of rules_cc, so it works from there, and no consumer needs an
override.

The newer rule-based toolchain API of rules_cc was the other option. It
meant rewriting what the unix config already does (`--macos_minimum_os`,
libtool, dead stripping, the sanitizers), for no gain to users.

## Static by Default

Bazel links the `cc_library` dependencies of a `cc_test` dynamically by
default, one shared object per library. With xclang, every shared object
carries its own libc++
([one libc++ per shared object](hermeticity.md#one-libc-per-shared-object)).
kotatsu's tests built that way crashed at start-up with a double free. On
Windows, the default DLLs did not link at all.

So the patched config turns `supports_dynamic_linker` off. Libraries link
statically into tests and programs. `cc_binary(linkshared = True)` still
makes a shared library (`libfoo.so`, `libfoo.dylib`, `foo.dll`), and
`features = ["supports_dynamic_linker"]` gives a Bazel target the dynamic
linking back.

## Vendor SDKs as Repositories

The MSVC targets need Microsoft's SDK, and the macOS targets off macOS
Apple's. The [`xclang` command](../reference/xclang-command.md) fetches
them for clang and CMake, into the toolchain. A Bazel build cannot write
there, and its inputs must be declared, so each SDK is a repository of
the module's extension.

- **The license in `MODULE.bazel`.** A tag of the extension,
  `xclang.windows_sdk(accept_license = True)`, is the project's acceptance
  of the vendor's license, as `--accept-license` is the user's. Only the
  root module's tags count: a library cannot accept it for the projects
  that use it.
- **Bazel downloads, the command unpacks.** `xclang sdk packages --json`
  lists the packages the command's version table pins, by URL, size and
  sha256. The repository rule downloads them with Bazel's own downloader,
  so they land in the repository cache, shared by every workspace of the
  machine, and a mirror or proxy configured for Bazel applies. Then
  `xclang sdk fetch --cache` unpacks them: Apple's xar, pbzx and cpio and
  Visual Studio's layout are the command's, and so are the links for the
  spellings Windows code uses on a case-sensitive file system. The SDK
  the command writes is the same one the CMake package uses.
- **A config file per SDK.** The repository writes `sdk.cfg`, the SDK by
  its path from the execution root: `-isysroot` for macOS, and for an
  MSVC target the command's own config file, which names the MSVC and
  Windows SDK versions too. clang finds those versions in the SDK's
  include directories, which a link's sandbox does not have. The
  toolchain's config file of the target includes `sdk.cfg` where the
  archive's names the toolchain's `sdk/`.
- **Lazy, per architecture.** The Windows SDK is a repository per
  architecture, a download of 310 MB for x64 and 380 MB for arm64; a
  build for other targets fetches none.
- **Inputs, never outputs.** The SDK's files are inputs of the actions,
  and none of their outputs. Bazel's sandbox needs every file declared, so
  `glob()` lists the SDK, and the macOS SDK's links that point into their
  own directories (`Ruby.framework`'s `ruby/ruby` is `.`) are removed,
  which `glob()` would follow without end. A link reads the macOS SDK's
  `.tbd` stubs only, by the install names of re-exported libraries too
  (`Versions/A/`), and a compile the rest.

The cost is the inputs, which the sandbox lays out for every action: a
compile for an MSVC target declares the SDK's 7,300 headers and links, a
link its 1,300 libraries; for macOS, 15,000 and 9,800 files, the
frameworks' through their links counted again.

## The Registry

The module of every release is published to
[bazel.clice.io](https://bazel.clice.io), once published.yml has built and
tested the tag of the release with the published archives. The registry
archive of the module is made deterministically: sorted entries, no owners
or times. It gives the same actions as the directory in the repository
([testing](../dev/testing.md#bazel-module)).

## Known Limitations

- **No sandbox on Windows by default.** Bazel runs actions on Windows
  without a sandbox unless an experimental one is set up
  (`--experimental_use_windows_sandbox`). An action there can read a file
  it did not declare, and nothing notices. The Linux and macOS builds of
  the same targets enforce the declarations.
- **A short output root on Windows.** The default output root of Bazel is
  too deep for the path length of Windows, hence
  `startup --output_user_root=C:/b`.
