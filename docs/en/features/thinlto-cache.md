# The ThinLTO Cache

[libclang](libclang.md) ships as ThinLTO bitcode, so the link of a tool on
it compiles the clang libraries to machine code: minutes per link. The
ThinLTO cache of the linker keeps that code between links, and a relink
after a small change takes seconds. This page is also the home of the
cache measurements.

## Usage

`XCLANG_THINLTO_CACHE` names an absolute directory for the cache, the same
way in every build system. Use one fixed path per OS:
`/var/tmp/xclang-thinlto` on Linux and macOS, `C:/xclang-thinlto` on
Windows ([why](#why-one-fixed-path)).

### CMake

Set it before `find_package(xclang)`, or in the environment. The tool of
[libclang](libclang.md#cmake) sets it when it configures:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
cmake -G Ninja -B build -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$PWD/libclang" -DXCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
cmake --build build
```

The first link fills the cache. After a change, the link takes the code
of the libraries from it:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
touch main.cpp
cmake --build build
```

### Bazel

Name it in the `.bazelrc` of the project, with one path per OS, as
[examples/libclang](https://github.com/clice-io/xclang/tree/main/examples/libclang)
does:

<!-- excerpt: examples/libclang/.bazelrc -->
```
common:linux --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:linux --sandbox_writable_path=/var/tmp/xclang-thinlto
common:macos --repo_env=XCLANG_THINLTO_CACHE=/var/tmp/xclang-thinlto
common:windows --repo_env=XCLANG_THINLTO_CACHE=C:/xclang-thinlto
try-import %workspace%/user.bazelrc
```

A user who needs another path says so in `user.bazelrc`. Those links then
have keys of their own, which a shared cache does not serve:

```
common:linux --repo_env=XCLANG_THINLTO_CACHE=/data/xclang-thinlto
common:linux --sandbox_writable_path=/data/xclang-thinlto
```

### Plain Clang

Pass the cache flag of the linker: `-Wl,--thinlto-cache-dir=<dir>` for
Linux and MinGW targets, `-Wl,-cache_path_lto,<dir>` for macOS targets,
and `-Wl,/lldltocache:<dir>` for the
[unreleased](../design/roadmap.md#msvc) MSVC targets. The CMake package and
the Bazel module pass the same flags.

## Options

| | CMake | Bazel |
|---|---|---|
| turn it on | `-DXCLANG_THINLTO_CACHE=<dir>`, or the environment variable, before `find_package(xclang)` | `--repo_env=XCLANG_THINLTO_CACHE=<dir>` |
| where it applies | every link of the directory that called `find_package(xclang)`, and of its subdirectories | every link, through the `thinlto_cache` feature |
| turn it off | leave the variable unset | `--features=-thinlto_cache` for a build, `features = ["-thinlto_cache"]` for a Bazel target |
| the directory | made at configure time | made by the Bazel module, again whenever it is gone |

Without the variable, no link has a cache flag.

## Behavior

- **What it keeps.** lld's ThinLTO cache keeps the machine code of each
  bitcode file in the directory, under a hash of everything that went into
  it: the bitcode, the summaries of what it imports, and the options. A
  later link generates only the code whose hash changed, and takes the rest
  from the directory.
- **The program is the same** with and without the cache. An entry is
  found only by the hash of exactly what produced it, so it can make a
  link faster, but not different.
- **Builds can share a directory.** An entry is written whole or not at
  all.
- **Pruning.** At most every 20 minutes, the linker removes the entries no
  link has read for a week, which is LLVM's default policy. A CI cache
  defeats that; keeping the directory in CI is in
  [CI](../integrations/ci.md#keep-caches-between-runs).

### Why Bitcode

A tool built on clang (a language server, a linter, a refactoring tool)
spends its time in the code of clang: the parser, Sema, the AST. Shipped as
machine code, those libraries are optimized on their own, and the tool
calls into them across a boundary no optimizer crosses.

Shipped as ThinLTO bitcode, built with the same PGO profile as xclang's
clang, they are optimized together with the tool at its link: inlining
across the boundary, dead code dropped, the layout of the profile kept.

The cost is the link. ThinLTO compiles every bitcode file the tool uses to
machine code during the link, in parallel. For a tool on clang, that is
most of LLVM and clang, and every relink does it again, even after a
one-line change. The cache removes that cost.

### Why One Fixed Path

**The path is in the key of the link.** The directory is on the command
line of the link, so in Bazel it is part of the action key. A disk or
remote cache serves a link only to a build that names the same directory.
A directory under the workspace or the home directory differs between
checkouts and machines, and no link is ever shared. So a project names one
path per OS, the same everywhere.

**The sandbox must let the link write it.** The Linux sandbox of Bazel
mounts the file system read-only, except for the outputs of the action.
`--sandbox_writable_path=<dir>` makes the cache directory writable, and is
not part of any key. A path is made writable only if it exists when the
action starts, so the Bazel module creates the directory when the repository
is set up, and again whenever it is gone.

**Not under `/tmp`.** The Linux sandbox gives every action a `/tmp` of its
own. A cache there is written into the private `/tmp` of the action, and
lost without a word. The macOS sandbox lets `/var/tmp` be written. Bazel
runs Windows actions without a sandbox by default.

**Safe outside Bazel's view.** Bazel treats an action as a function of its
declared inputs, and a directory the link reads and writes is state Bazel
cannot see. It is safe here because the cache is content-addressed.

## Measurements

Measured with 23.1.2.4 on clice's links of libclang's bitcode, on
GitHub-hosted runners: Linux x64 with 4 cores, macOS arm64 with 3 cores,
Windows x64 with 4 cores. The times are those of the link alone, from the
profile of Bazel
([clice runs](https://github.com/clice-io/clice/actions/runs/37041436235)
[37047279320](https://github.com/clice-io/clice/actions/runs/37047279320)
[37065094747](https://github.com/clice-io/clice/actions/runs/37065094747)
[37075525831](https://github.com/clice-io/clice/actions/runs/37075525831),
branch `exp/bazel-lto`):

| | Linux x64 | macOS arm64 | Windows x64 |
|---|---|---|---|
| no cache | 353 s | 190 s | 400–506 s |
| empty cache | 357 s | 190–200 s | 492 s |
| full cache, nothing changed | 6.1–6.3 s | 4.8–5.1 s | 7.6–14 s |
| full cache, one source changed | 6.2 s | 4.7–7.3 s | 14 s |
| first link on a fresh runner after restoring the cache, with a change | 6.2 s | 15.6 s | 13.7 s |
| cache size | 352–403 MiB | 414–425 MiB | 394–660 MiB |

In 23.1.2.4, macOS targets linked with Apple's ld and xclang's libLTO
(`-cache_path_lto`); from 23.1.2.5 on, they link with ld64.lld. Since
23.1.2.7 the macOS archives carry no `libLTO.dylib`: `-fuse-ld=ld` still
selects Apple's ld, for links without LTO, and so without this cache.

The tests of 23.1.2.6 link a small tool on libclang without the cache, with
an empty one, and with a full one, on every host: 7 to 20 s cold, 0.6 to
1.7 s warm, 152 to 155 entries, and the same program bytes each time
([testing](../dev/testing.md#bazel-module)).

## See Also

- [libclang](libclang.md): the bitcode the cache is for.
- [CI](../integrations/ci.md#keep-caches-between-runs): keeping the cache
  between runs.
