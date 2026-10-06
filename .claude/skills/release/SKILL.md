---
name: release
description: Cut an xclang release <llvm version>.<revision> — full rebuild or repack, release.yml run on an exp branch, draft → publish, then published.yml publishes it everywhere. Use when asked to release, rebuild, repack or publish a new xclang revision.
---

# Cutting a release

A release is `<LLVM_VERSION>.<revision>` (toolchain/common.ts has
`LLVM_VERSION`; the revision is release.yml's `revision` input). Nothing
published is ever replaced: a rebuild gets the next revision. Builds run on
CI only, on GitHub-hosted runners. Ask the user before pushing to main and
before publishing.

## Full rebuild or repack

A release is one of two kinds; `git diff --stat <previous tag> origin/main`
tells which.

- **Repack**: every change since the previous release is in what the
  `package` stage reads from the checkout, or in nothing the archives hold.
  The next revision then reuses the compiler, runtimes, libclang and
  profile of the release.yml run that built them, byte for byte (clang
  and lld embed no revision; only toolchain/package.ts and the xclang
  command name it): about half an hour instead of three hours.
  - toolchain/config/*.cfg (common.writeConfigs, called by package.ts);
  - packages/cmake/ (lib/cmake/xclang; xclang.cmake is used from the tag);
  - packages/bazel/ (the tag's module, published by published.yml; not in
    the archives);
  - cli/ (the package stage builds the command anew);
  - toolchain/package.ts, toolchain/licenses.ts, toolchain/licenses/,
    LICENSE, and what package.ts uses of toolchain/common.ts (makeTree,
    shareHeaders, writeConfigs, writeCMakePackage);
  - docs/, examples/, tests/, the workflows' tests.
  A fix of the conda packages alone is no release at all: conda.yml by
  hand, with the same tag and the next `build`.
- **Full rebuild**: anything built into the toolchain, runtimes or profile
  artifacts: patches/, the LLVM source and other pins of SOURCES
  (mingw-w64, sysroots, zlib, zstd, the bootstrap), toolchain/cmake/,
  toolchain/toolchain.ts, toolchain/runtimes.ts, toolchain/sysroot.ts,
  toolchain/launcher/, TARGETS or MACOS_MIN in toolchain/common.ts,
  toolchain/pgo/, the hosts. A runtimes change rebuilds the toolchains
  too: clang links its host's libc++ statically. Ask the user when a
  change seems to fall between the two.

checks.yml has tested every push of these changes already, against the
latest release (config files and CMake package of the checkout included);
the release run tests them with the new archives.

## Steps

1. **Bootstrap**, for a full rebuild. `SOURCES["bootstrap-linux"]` /
   `["bootstrap-macos"]` in toolchain/common.ts name the release whose Linux
   x64 and macOS arm64 toolchains build this one (usually the previous
   release). To move it: take the two archives' lines from that release's
   SHA256SUMS (`gh release download <ver> -R clice-io/xclang -p
   SHA256SUMS`), edit URL and sha256, commit `bootstrap: <ver>`. Keep the
   old one if the new one lacks something the build needs (xclang's own
   macOS builds link with ld64.lld since the bootstrap had patches/0007,
   23.1.2.5).
2. **Branch and CHANGELOG.** The release's commits go to `exp/<version>`
   (e.g. `exp/23.1.2.9`), not main, with one commit `changelog:
   <version>`:
   - CHANGELOG.md: Unreleased becomes `## [<version>](https://github.com/clice-io/xclang/releases/tag/<version>) — <date>`
     (the UTC date the run starts) with "Built by <bootstrap>." (a
     repack: "The compiler and runtimes are <previous>'s."), and a new
     empty Unreleased;
   - docs/en/dev/release-build.md: the release's row in the bootstrap
     chain table (a repack: "<previous>'s compiler, repacked").
   Nothing else names a release: the docs, READMEs and examples/ reach the
   newest by themselves (pixi `xclang = "*"`, `releases/latest`, the
   `latest` branch for FetchContent), and the Bazel `bazel_dep` versions
   are the oldest release they take, raised only when the docs need
   something newer.
3. **Full run, with a draft.**
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,release \
     -f revision=<n>
   ```
   About 3 h. The `cli` input is on by default: the archives carry the
   `xclang` command (cli.yml builds it), which the `sdk` stage needs to
   fetch the vendor SDKs. A failed stage is rerun without rebuilding the
   rest: `-f reuse-run=<run id>` plus only the stages still to do (and
   `-f profile-run=<run id>` when `release` runs without `train`). The
   `release` stage refuses an existing version.

   **A repack** instead (no bootstrap step):
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=package,test,bazel,cmake,sdk,cli,release \
     -f reuse-run=<full run> -f profile-run=<full run> \
     -f repack-of=<previous version> -f revision=<n>
   ```
   `<full run>` is the release.yml (before 23.1.2.9: main.yml) run that
   built the compiler: the previous release's, or, when that one is a
   repack too, the run it reused (its release notes link it; a repack's
   own run copies the runtimes forward but not the toolchain artifacts or
   the profile). The runtimes job copies every unit from reuse-run;
   package takes each host's toolchain, libclang and ASan libclang from it
   and builds the command anew; release takes the profile from
   profile-run. With `repack-of`, the `test` stage (test-archives.yml,
   tests/release/repack.ts) compares every host's archives with those of
   that release, member by member: only the packaging's files may differ
   (config files, lib/cmake/xclang, bin/xclang, share/licenses); a
   program, library or header that differs fails it, and the release with
   it.

   A full run's toolchain-* and runtimes-* artifacts are kept 14 days, its
   profile 30 (`gh api repos/clice-io/xclang/actions/runs/<run>/artifacts
   -q '.artifacts[] | [.name, .expires_at] | @tsv'`). Past that, a repack
   cannot be made: a full rebuild it is.
4. **Check the draft**: 17 assets (six toolchains, six libclang, two ASan
   libclang, option tables, profdata, SHA256SUMS), and every job of the
   run green: test (smoke and libclang on every host, the programs they
   build for other targets run there, repack's comparison), bazel, cmake,
   sdk (both MSVC targets from Linux, macOS and Windows hosts, both macOS
   targets from the Linux and Windows hosts, the programs run on Windows
   x64 and arm64 and on both Macs), cli. Every toolchain archive has
   `bin/xclang` (`bin/xclang.exe`), and `xclang --version` names the
   release. Sizes vs the previous release (`gh release view <prev> --json
   assets`).
5. **Notes.** Write them as the earlier releases' are (`gh release view
   23.1.2.4 -R clice-io/xclang`): what it was built by, then what changed
   for users; take the items from the release's section of CHANGELOG.md.
   A repack's begin: "A repack of <previous>: the compiler and runtimes
   are <previous>'s, the same bytes, from its build run <link to the full
   run>", then what of the packaging differs (the repack jobs' summaries).
6. **Publish** (ask first; it creates the tag at the draft's commit). Every
   release's title is its version alone:
   ```sh
   gh release edit <version> -R clice-io/xclang --title <version> \
     --notes-file notes.md --draft=false --latest
   ```
   Then fast-forward main to `exp/<version>` (ask before pushing).
   Publishing starts published.yml, which does the rest; watch it:
   test-bazel.yml with the release's archives, then the tag's module
   (`xclang-bazel-<version>.tar.gz`) to bazel.clice.io through
   clice-io/bazel; test-cmake.yml with the tag fetched as a user's
   FetchContent does; conda.yml, build 0, published to conda.clice.io;
   the `latest` branch moved to the tag; examples.yml, the docs' commands
   and examples/ as written against the release on every host, once
   conda.clice.io serves it. A job that failed is rerun from the run's
   page; published.yml by hand (`-f tag=<version> -f publish=true`) runs
   all of it again.
7. **bench.yml** (optional, for the notes or docs/en/design/pgo.md):
   `gh workflow run bench.yml -R clice-io/xclang --ref main -f
   pgo-run=<the release's release.yml run> -f shards='[1, 2, 3, 4, 5]'`,
   the release's own archives against LLVM's release builds, nothing
   rebuilt.
