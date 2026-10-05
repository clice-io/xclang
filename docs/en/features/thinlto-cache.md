# The ThinLTO cache

libclang ships as ThinLTO bitcode, and so the link of a tool on it is
where clang's libraries are compiled to machine code: minutes per link.
The linker's ThinLTO cache keeps that code between links, and a relink
after a small change takes seconds. This page says why libclang is bitcode,
what the cache does, and why its directory has to be one fixed path.

## Why bitcode

A tool built on clang (a language server, a linter, a refactoring tool)
spends its time in clang's code: the parser, Sema, the AST. Shipped as
machine code, those libraries are optimized on their own, and the tool's
code calls into them across a boundary no optimizer crosses. Shipped as
ThinLTO bitcode, compiled with the same PGO profile as xclang's clang,
they are optimized together with the tool at its link: inlining across the
boundary, dead code dropped, the profile's layout kept. It is the same
build the toolchain's clang is linked from, so the tool gets what made
clang fast.

The cost is the link. ThinLTO compiles every bitcode module the tool uses
to machine code in the link, in parallel, and for a tool on clang that is
most of LLVM and clang: clice's link took 353 s on a 4-core Linux runner.
Every relink does it again, even after a one-line change in the tool.

## What the cache does

lld's ThinLTO cache (`--thinlto-cache-dir` for ELF and COFF,
`-cache_path_lto` for Mach-O) keeps each module's machine code in a
directory, under a hash of everything that went into it: the module's
bitcode, the summaries of what it imports, the options. A later link
generates only the modules whose hash changed, and takes the rest from
the directory. An entry is written whole or not at all, so builds can
share a directory. The program is the same with and without the cache.

Measured on clice's links of libclang's bitcode, on GitHub-hosted runners
(Linux x64 4 cores, macOS arm64 3 cores, Windows x64 4 cores), times of the
link alone from Bazel's profile
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

The macOS numbers are from before xclang linked macOS targets with
ld64.lld (Apple's ld with xclang's libLTO, `-cache_path_lto`). xclang's
own tests link a small tool on libclang without the cache, with an empty
one and with a full one on every host: 7 to 20 s cold, 0.6 to 1.7 s warm,
152 to 155 entries, the program the same bytes each time (tests/bazel.ts,
tests/cmake.ts).

## Turning it on

`XCLANG_THINLTO_CACHE`, an absolute directory:

- Bazel: `--repo_env=XCLANG_THINLTO_CACHE=<dir>`; the module makes the
  directory and the toolchains' `thinlto_cache` feature passes it to the
  target's linker ([Bazel](../integrations/bazel.md#the-thinlto-cache)).
- CMake: `-DXCLANG_THINLTO_CACHE=<dir>`, or the environment variable, before
  `find_package(xclang)` ([CMake](../integrations/cmake.md#the-thinlto-cache)).
- By hand: `-Wl,--thinlto-cache-dir=<dir>` for Linux and Windows targets,
  `-Wl,-cache_path_lto,<dir>` for macOS ones.

## Why one fixed path

**The path is in the link's key.** The directory is on the link's command
line, so in Bazel it is part of the action's key, and a disk or remote
cache serves a link only to a build that names the same directory. A
directory under the workspace or the user's home would differ between
checkouts and machines, and no link would ever be shared. So a project names
one path per OS in its `.bazelrc` (`/var/tmp/xclang-thinlto`,
`C:/xclang-thinlto`), the same everywhere; a user who needs another says so
in `user.bazelrc` and gives up sharing.

**The sandbox must let the link write it.** Bazel's Linux sandbox mounts
the file system read-only except for the action's outputs, and gives every
action a `/tmp` of its own. A cache directory has to be made writable with
`--sandbox_writable_path=<dir>`, which is not part of any key, and must not
be under `/tmp`: a cache there is written into the action's private `/tmp`
and lost without a word. A path is made writable only if it exists when the
action starts, so the module creates the directory when the repository is
set up, and again whenever it is gone. macOS's sandbox lets `/var/tmp` be
written; Windows has no sandbox.

**Why the cache is safe to keep outside Bazel.** Bazel treats an action as a
function of its declared inputs, and a directory the link reads and writes
is state it cannot see. It is safe here because the cache is content
addressed: an entry is found only by the hash of exactly what produced it,
so it can make a link faster but not different, which tests/bazel.ts checks
by comparing the program linked with and without it.

## Pruning, and CI

The linker prunes the cache by LLVM's default policy: at most every 20
minutes, the entries no link has read for a week go. A CI cache entry
defeats that: restoring a cache sets every file's last access to the time
of the restore, so nothing ever looks unused and the entry only grows, by
what new code adds (clice and its tests: 350 to 650 MB). Keying the entry
on the xclang version starts a new one with each release, whose links can
use none of the old entries anyway ([CI](../integrations/ci.md)).
