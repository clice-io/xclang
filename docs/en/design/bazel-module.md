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
except the macOS SDK, which `xcrun` finds; `--macos_minimum_os` sets the
deployment target.

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

Two absolute paths remain: the macOS SDK path, which comes from the
machine, and on macOS the rpath of the sanitizer features to the
toolchain's runtimes. Only those sanitizer links depend on the checkout.

## A Toolchain per Host and Target

Each host archive carries every target. So the module registers, for every
host, a toolchain for every target: `exec_compatible_with` the host,
`target_compatible_with` the target. Bazel picks the one for the machine it
runs on and the platform it builds for, and only that host archive is
downloaded.

A macOS target from a Linux or Windows host gets a toolchain that fails at
once and says why. That is clearer than a compiler error later, or "no
toolchain found".

The toolchains ask a platform for its os and cpu only. The platforms of the
module add a C library constraint (`glibc`, `mingw`, `macosx`) for
`select()`. The [planned](roadmap.md#msvc) MSVC and musl targets share an os
and cpu with today's targets, and get toolchains of their own through that
constraint.

## rules_cc's Config, Copied

The toolchains are the unix toolchain config of rules_cc, with xclang's
changes:

- Windows names for MinGW programs and shared libraries (`.exe`, `.dll`);
- static linking by default (below);
- headers of other repositories as system headers (`-isystem`), whose
  warnings are not the build's;
- the link flags of the sanitizer features, and the ASan libc++ for `asan`;
- `gc_sections` off for Windows targets
  ([why](windows.md#gc-sections-and-static-initializers));
- a link program of the toolchain's own, which makes the dSYM in the link
  ([why](../features/debugging.md#why-a-dsym-comes-from-the-link));
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

## The Registry

The module of every release is published to
[bazel.clice.io](https://bazel.clice.io), once bazel.yml has built and
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
