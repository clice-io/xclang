---
name: release
description: Cut an xclang release <llvm version>.<revision> — bootstrap choice, main.yml run on an exp branch, draft → publish, conda and Bazel registry publishing, README/CHANGELOG/versions updates. Use when asked to release, rebuild, or publish a new xclang revision.
---

# Cutting a release

A release is `<LLVM_VERSION>.<revision>` (scripts/common.ts has
`LLVM_VERSION`; the revision is main.yml's `revision` input). Nothing
published is ever replaced: a rebuild gets the next revision. Builds run on
CI only, on GitHub-hosted runners. Ask the user before pushing to main and
before publishing.

## Full rebuild or repack

A release is one of two kinds; `git diff --stat <previous tag> origin/main`
tells which.

- **Repack**: every change since the previous release is in what the
  `package` stage reads from the checkout, or in nothing the archives hold.
  The next revision then reuses the compiler, runtimes, libclang and
  profile of the main.yml run that built them, byte for byte (clang and
  lld embed no revision; only scripts/package.ts and the xclang command
  name it): about half an hour instead of three hours.
  - config/*.cfg (common.writeConfigs, called by package.ts);
  - packages/cmake/ (lib/cmake/xclang; xclang.cmake is used from the tag);
  - packages/bazel/ (the tag's module, published by bazel.yml; not in the
    archives);
  - cli/ and scripts/cli.ts (the package stage builds the command anew);
  - scripts/package.ts, scripts/licenses.ts, licenses/, LICENSE, and what
    package.ts uses of scripts/common.ts (makeTree, shareHeaders,
    writeConfigs, writeCMakePackage);
  - docs/, examples/, tests/, the workflows' tests.
  A fix of the conda packages alone is no release at all: conda.yml with
  the same tag and the next `build` (step 7).
- **Full rebuild**: anything built into the toolchain, runtimes or profile
  artifacts: patches/, the LLVM source and other pins of SOURCES
  (mingw-w64, sysroots, zlib, zstd, the bootstrap), cmake/caches/,
  cmake/toolchain.cmake, scripts/toolchain.ts, scripts/runtimes.ts,
  scripts/sysroot.ts, windows/alias.c, TARGETS or MACOS_MIN in
  scripts/common.ts, pgo/, the hosts. A runtimes change rebuilds the
  toolchains too: clang links its host's libc++ statically. Ask the user
  when a change seems to fall between the two.

1. **Bootstrap.** `SOURCES["bootstrap-linux"]` / `["bootstrap-macos"]` in
   scripts/common.ts name the release whose Linux x64 and macOS arm64
   toolchains build this one (usually the previous release). To move it:
   take the two archives' lines from that release's SHA256SUMS
   (`gh release download <ver> -R clice-io/xclang -p SHA256SUMS`), edit URL
   and sha256, commit `bootstrap: <ver>`. Keep the old one if the new one
   lacks something the build needs (xclang's own macOS builds link with
   ld64.lld since the bootstrap had patches/0007, 23.1.2.5).
2. **Branch.** Push the release's commits to `exp/<version>` (e.g.
   `exp/23.1.2.6`), not main.
3. **Full run, with a draft.**
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,msvc,macos,release \
     -f revision=<n>
   ```
   About 3 h. `cli` is on by default: the archives carry the `xclang`
   command (cli.yml builds it), which the `msvc` and `macos` stages need to
   fetch the vendor SDKs. A failed stage is rerun without rebuilding the
   rest: `-f reuse-run=<run id>` plus only the stages still to do (and
   `-f profile-run=<run id>` when `release` runs without `train`). The
   `release` stage refuses an existing version.

   **A repack** instead (no bootstrap step):
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=package,test,bazel,cmake,msvc,macos,release \
     -f reuse-run=<full run> -f profile-run=<full run> \
     -f repack-of=<previous version> -f revision=<n>
   ```
   `<full run>` is the main.yml run that built the compiler: the previous
   release's, or, when that one is a repack too, the run it reused (its
   release notes link it; a repack's own run copies the runtimes forward
   but not the toolchain artifacts or the profile). The runtimes job copies
   every unit from reuse-run; package takes each host's toolchain, libclang
   and ASan libclang from it and builds the command anew; release takes
   the profile from profile-run. The repack job (repack.yml,
   tests/repack.ts) compares every host's archives with those of
   `repack-of`, member by member: only the packaging's files may differ
   (config files, lib/cmake/xclang, bin/xclang, share/licenses); a
   program, library or header that differs fails it, and the release with
   it.

   A full run's toolchain-* and runtimes-* artifacts are kept 14 days, its
   profile 30 (`gh api repos/clice-io/xclang/actions/runs/<run>/artifacts
   -q '.artifacts[] | [.name, .expires_at] | @tsv'`). Past that, a repack
   cannot be made: a full rebuild it is.
4. **Check the draft**: 17 assets (six toolchains, six libclang, two ASan
   libclang, option tables, profdata, SHA256SUMS), and the run's test,
   bazel, cmake, msvc and macos jobs all green: msvc (msvc.yml) builds for
   both MSVC targets on Linux, macOS and Windows hosts and runs the
   programs on Windows x64 and arm64; macos (macos.yml) builds for both
   macOS targets on the Linux and Windows hosts and runs the programs on
   macOS arm64 and x86_64. Every toolchain archive has `bin/xclang`
   (`bin/xclang.exe`), and `xclang --version` names the release. Sizes vs
   the previous release (`gh release view <prev> --json assets`).
5. **Notes.** Write them as the earlier releases' are (`gh release view
   23.1.2.4 -R clice-io/xclang`): what it was built by, then what changed
   for users; take the items from CHANGELOG.md's Unreleased section. A
   repack's begin: "A repack of <previous>: the compiler and runtimes are
   <previous>'s, the same bytes, from its build run <link to the full
   run>", then what of the packaging differs (the repack job's summary).
6. **Publish** (ask first; it creates the tag at the draft's commit). Every
   release's title is its version alone:
   ```sh
   gh release edit <version> -R clice-io/xclang --title <version> \
     --notes-file notes.md --draft=false --latest
   ```
   Publishing starts bazel.yml (tests the tag's module with the release's
   digests, then publishes `xclang-bazel-<version>.tar.gz` to
   bazel.clice.io through clice-io/bazel) and cmake.yml (tests/cmake with
   the tag fetched as a user's FetchContent does). Watch both.
7. **conda**:
   ```sh
   gh workflow run conda.yml -R clice-io/xclang --ref main -f tag=<version> -f build=0 -f publish=true
   ```
   A packaging fix of the same release is `build=1`, `build=2`, ...
8. **After publishing**, on main (ask before pushing), one commit
   `readme: <version>`:
   - `node scripts/bazel.ts versions <SHA256SUMS of the release>` →
     packages/bazel/bazel/versions.bzl; `version = "<version>"` in
     packages/bazel/MODULE.bazel and tests/bazel/MODULE.bazel;
   - tests/bazel.ts: `previous` default → the release before this one;
   - README.md, README.zh-CN.md, docs/en/ and examples/ (the pixi
     workspace, FetchContent's `XCLANG_VERSION`, the Bazel module) and
     `VERSION`, the cache key and the steps the docs show in
     .github/workflows/examples.yml (tests/docs.ts holds them equal):
     `xclang = "<version>.*"`, `bazel_dep(... version = "<version>")`,
     archive names, sizes (`grep -rn <previous version> README* docs
     examples .github/workflows/examples.yml` finds them); the "Runs for
     <version>" table of docs/en/dev/testing.md, the one page that cites
     CI runs;
   - CHANGELOG.md: Unreleased becomes `## [<version>](https://github.com/clice-io/xclang/releases/tag/<version>) — <date>`
     (the UTC date of publishing) with "Built by <bootstrap>." (a repack:
     "The compiler and runtimes are <previous>'s."), and a new empty
     Unreleased;
   - docs/en/dev/release-build.md: the release's row in the bootstrap
     chain table (a repack: "<previous>'s compiler, repacked").
   Fast-forward main to `exp/<version>` first if the release came from it.
9. **examples.yml**, once conda.clice.io and bazel.clice.io have the
   release and main names it: `gh workflow run examples.yml -R
   clice-io/xclang --ref main`. It runs the docs' commands and examples/
   as written against the published release on every host; link the run
   in docs/en/dev/testing.md's runs table in place of the previous
   release's.
10. **bench.yml** (optional, for the notes or docs/en/design/pgo.md):
    `gh workflow run bench.yml -R clice-io/xclang --ref main -f
    pgo-run=<the release's main.yml run> -f shards='[1, 2, 3, 4, 5]'`,
    the release's own archives against LLVM's release builds, nothing
    rebuilt.
