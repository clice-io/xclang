# The Bazel module

Bazel's promise is that a build's outputs are a function of its declared
inputs, cached by content and shared between machines. A C++ toolchain
breaks that promise easily: a compiler found on `PATH`, headers read from
`/usr/include`, a sandbox path written into a dependency file. This page
says how xclang's module keeps it, and what that cost.

## Every toolchain file is an input

The module downloads the host's archive by its sha256 into a repository,
and every file of it an action reads is declared: the programs, clang's
resource headers and the target's headers for compiling, its libraries and
compiler-rt for linking. Nothing comes from the machine except the macOS
SDK, which `xcrun` finds.

Before the module, xclang's Bazel rules found clang on `PATH` and declared
nothing, the common way to wrap a local compiler. Two things went wrong: a
change of `PATH` refetched the toolchain's repository and rebuilt
everything, and a new compiler version on `PATH` rebuilt nothing, serving
objects of the old compiler from the cache. Declared inputs invert both: a
new release changes every action's key and rebuilds; the same release in
another checkout or on another machine hits the cache. tests/bazel.ts checks
both, on every host.

The cost: thousands of declared files per action, which Bazel's sandbox
lays out for every compile, so a sandboxed action costs more than one
without inputs. On a full build this is a fraction of compile time.

## No absolute paths

A disk or remote cache serves an action to another machine only if its key
is the same there, and the key holds the command line. A path into the
checkout, the output base or the sandbox makes every machine's key its own;
a path written into an output (a dependency file, debug information, a
module file) makes the output differ. The module removes them:

- **Config files.** clang turns a config file's directory into an absolute
  path, which reaches the dependency files. The module writes each target's
  config file again with paths relative to the execution root
  (`external/xclang_<host>/...`) and passes `--no-default-config
  --config=<file>`.
- **clang's own paths**: `-no-canonical-prefixes`.
- **Debug information**: `-ffile-compilation-dir=.`; on macOS
  `-Wl,-oso_prefix,.`; on Windows `--no-insert-timestamp`
  ([debugging](../features/debugging.md)).
- **Module files**: `-fmodule-file-home-is-cwd`, so a BMI names its inputs
  relative to the execution root and is the same wherever it is built.
- **`__DATE__`, `__TIME__`, `__TIMESTAMP__`** are redacted.

The exceptions are the macOS SDK's path and, on macOS, the sanitizer
features' rpath to the toolchain's runtimes: only those links depend on the
checkout. tests/bazel.ts checks the actions' keys for absolute paths, for
the host and for a target of another OS, on every host.

## A toolchain per host and target

Each host's archive carries every target, so the module registers, for
every host, a toolchain for every target: `exec_compatible_with` the host,
`target_compatible_with` the target. Bazel picks the one of the machine it
runs on and the platform it builds for, and only that host's archive is
downloaded. A macOS target from a Linux or Windows host gets a toolchain
that fails at once, saying why, instead of a compiler error later or "no
toolchain found".

The toolchains ask a platform for its os and cpu only. The module's
platforms add a C library constraint (`glibc`, `mingw`, `macosx`) for
`select()`, and so that a future musl or MSVC target on the same os and cpu
can have toolchains of its own.

## rules_cc's config, copied

The toolchains are rules_cc's unix toolchain config with xclang's changes:
Windows names for MinGW's executables and DLLs, static linking by default,
other repositories' headers as system headers, the sanitizer features'
link flags, a link program of the toolchain's own (for the dSYM). The
obvious way to change a module's file is a `single_version_override` with
patches; but an override is honoured only in the root module, with patch
files from the root module's tree, so every project using xclang would have
to carry xclang's patches, and the override would change the build's only
rules_cc for everyone else in it.

So the module copies rules_cc's `unix_cc_toolchain_config.bzl` into a
repository of its own and patches the copy. The copy loads only rules_cc's
public files, so it works from there, and no consumer needs an override.
rules_cc's newer rule-based toolchain API was the other option; it would
have meant rewriting what the unix config already does
(`--macos_minimum_os`, libtool, dead stripping, the sanitizers) for no gain
to users.

## Static by default

Bazel links `cc_test` and `cc_library` dependencies dynamically by default.
With xclang, every shared object carries its own libc++, and kotatsu's tests
built that way crashed at start-up with a double free; on Windows, the
default DLLs did not link. The patched config turns `supports_dynamic_linker`
off: libraries link statically into tests and programs, `linkshared`
shared libraries still work, and a target can ask for the feature back
([hermeticity](hermeticity.md#one-libc-per-shared-object)).

## The registry

Every release's module is published to [bazel.clice.io](https://bazel.clice.io)
once bazel.yml has built and tested the release's tag with the published
archives. The registry's archive of the module is made deterministically
(sorted entries, no owners or times), and tests/bazel.ts checks that it
gives the same actions as the repository's directory.

## Windows

Windows has no Bazel sandbox, so an action there can read a file it did not
declare and nothing notices; the Linux and macOS builds of the same targets
are what enforces the declarations. Bazel's default output root is too
deep for Windows' path length, hence `startup --output_user_root=C:/b`.
