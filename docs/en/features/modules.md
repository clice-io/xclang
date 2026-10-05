# C++20 modules and import std

xclang builds C++20 modules in CMake and Bazel today, `import std`
included, without CMake's experimental switches. This page says what a
build has to get right for modules, how xclang does it, and where build
caches go wrong.

## What a module build needs

A module interface compiles to a *module file* (BMI, `.pcm` for clang),
which every importer reads. Three things follow:

- **Order.** An importer can only be compiled after the module files it
  imports exist, so the build has to know, before compiling, which source
  provides and which imports which module. Both CMake and Bazel ask the
  compiler: clang-scan-deps writes each source's dependencies in the P1689
  format, and the build system orders the compiles by it.
- **Matching options.** clang refuses a module file built with other
  language options than its importer's: `-std`, GNU extensions,
  `-fno-exceptions`, `-fno-rtti`, and others that change what the code
  means. Macros, include paths and optimization may differ. So a module is
  built per set of language options, not once.
- **The module file is an input.** An importer's object depends on the
  content of the module files it read, not only on its own source and
  command line.

## import std

libc++'s `std` and `std.compat` modules are sources in each target's
directory, which clang names: `clang++ -print-library-module-manifest-path`
prints `libc++.modules.json`, which lists them. Because of the matching
rule, a prebuilt `std` module could only serve importers with exactly the
options it was built with; xclang builds it for each build instead, with
that build's options, as a library to link:

| build system | `import std` | built with |
|---|---|---|
| CMake | `target_link_libraries(app PRIVATE xclang::std)` | the language options of the directory that called `find_package(xclang)` ([CMake](../integrations/cmake.md#import-std)) |
| Bazel | `deps = ["@xclang//bazel:std"]`, `features = ["cpp_modules"]` | the build's `--cxxopt` ([Bazel](../integrations/bazel.md#what-the-toolchain-does)) |

CMake has its own `import std` support, still behind the
`CMAKE_EXPERIMENTAL_CXX_IMPORT_STD` gate in CMake 4.4, whose value changes
with CMake's version. `xclang::std` needs only CMake 3.28's module support,
which is not experimental: it is an ordinary library target whose sources
are the module interfaces, so CMake scans and builds it as any other.

A target with other language options (`-fno-exceptions`, say) needs a
`std` of its own: `xclang_add_std(<name>)` in CMake. A target asking for a
newer standard than `std` was built with gets `C++26 was disabled in
precompiled file`.

## By hand

The steps tests/smoke.ts runs on every host, for the host's target:

```sh
manifest=$(clang++ -print-library-module-manifest-path)
std=$(dirname "$manifest")/../share/libc++/v1/std.cppm
clang++ -std=c++23 -O2 -Wno-reserved-module-identifier --precompile "$std" -o std.pcm
clang++ -std=c++23 -O2 -fmodule-file=std=std.pcm use_std.cpp std.pcm -o use_std
```

(smoke.ts takes the source's path from the manifest, `source-path` of the
module named `std`.) With `--target=<triple>` on each command, the same
builds another target's `std`.

## Build caches and modules

A compile cache keyed on the source, the command line and the headers it
includes misses the module files, which the command line names only by
path (CMake passes them in a response file, `@<source>.modmap`). If the
cache does not hash the module file's content, an importer is served the
object it had before the module's interface changed.

examples.yml's `ccache` job runs the command lines CMake gives a module and
its importer (`-fmodule-output=a.pcm`, and `-fmodule-file=a=a.pcm` in
`@b.modmap`) three times, under two ccache versions: as is, again, and
after the module's exported constant changed from 1 to 2.

([the run](https://github.com/clice-io/xclang/actions/runs/37356757050)):

| | module interface | importer, unchanged | importer, after the interface changed |
|---|---|---|---|
| ccache 4.13.6 | never cached (`unsupported_source_language`) | cache hit | **cache hit: the stale object, the program returns 1** |
| ccache 4.14.1 | never cached | cache hit | cache miss, recompiled: the program returns 2 |

So with ccache 4.13 or older, a module build can be silently wrong; with
4.14 it is correct, but every module interface is compiled on every
build, which in a modularized project is much of the work. The job fails
when either version stops behaving as the table says, so the table stays
true.

Bazel has no such problem by construction. Each action's key is the
content of all its inputs, and an importer's inputs include the module
files it reads, as declared outputs of the actions that made them. A
changed interface gives a new module file, which changes the key of every
importer; an unchanged one hits the cache. xclang's toolchains compile
modules with paths relative to the execution root
(`-fmodule-file-home-is-cwd`), so a module file is the same wherever it is
built and a shared cache serves it to every checkout.

## Not supported

- Header units (`import <vector>;`): neither CMake nor Bazel builds them
  here.
- Bazel's module support is behind `--experimental_cpp_modules` in Bazel 9.
- Generators other than Ninja and Ninja Multi-Config, in CMake.

## Tested by

- tests/cmake (cmake.yml, every host, CMake 3.28 and the newest): a module
  of partitions, `xclang::std` with `std.compat`, `xclang_add_std` with
  `-fno-exceptions`, for the host and through the toolchain file for every
  other target.
- tests/bazel (bazel.yml, every host, and cross-built for every other
  target): a module of partitions, a module importing another, `import std`.
- examples.yml: `import std` in CMake and Bazel on every host, as the
  [quick start](../guide/quick-start.md) does.
