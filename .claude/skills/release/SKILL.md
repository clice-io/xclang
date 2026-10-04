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

1. **Bootstrap.** `SOURCES["bootstrap-linux"]` / `["bootstrap-macos"]` in
   scripts/common.ts name the release whose Linux x64 and macOS arm64
   toolchains build this one (usually the previous release). To move it:
   take the two archives' lines from that release's SHA256SUMS
   (`gh release download <ver> -R clice-io/xclang -p SHA256SUMS`), edit URL
   and sha256, commit `bootstrap: <ver>`. Keep the old one if the new one
   lacks something the build needs (cmake/toolchain.cmake's macOS
   `-fuse-ld=ld` waits for a bootstrap with patches/0007, ≥ 23.1.2.5).
2. **Branch.** Push the release's commits to `exp/<version>` (e.g.
   `exp/23.1.2.6`), not main.
3. **Full run, with a draft.**
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,release \
     -f revision=<n>
   ```
   About 3 h. A failed stage is rerun without rebuilding the rest:
   `-f reuse-run=<run id>` plus only the stages still to do (and
   `-f profile-run=<run id>` when `release` runs without `train`). The
   `release` stage refuses an existing version.
4. **Check the draft**: 17 assets (six toolchains, six libclang, two ASan
   libclang, option tables, profdata, SHA256SUMS), and the run's test,
   bazel and cmake jobs all green. Sizes vs the previous release
   (`gh release view <prev> --json assets`).
5. **Notes.** Write them as the earlier releases' are (`gh release view
   23.1.2.4 -R clice-io/xclang`): what it was built by, then what changed
   for users; take the items from CHANGELOG.md's Unreleased section.
6. **Publish** (ask first; it creates the tag at the draft's commit):
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
     bazel/versions.bzl; `version = "<version>"` in MODULE.bazel and
     tests/bazel/MODULE.bazel;
   - tests/bazel.ts: `previous` default → the release before this one;
   - README.md and README.zh-CN.md: `xclang = "<version>.*"`,
     `bazel_dep(... version = "<version>")`;
   - CHANGELOG.md: Unreleased becomes `## [<version>](https://github.com/clice-io/xclang/releases/tag/<version>) — <date>`
     with "Built by <bootstrap>.", and a new empty Unreleased.
   Fast-forward main to `exp/<version>` first if the release came from it.
