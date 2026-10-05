# Releasing

How a release `<llvm version>.<revision>` is cut. The maintainers' step
list is the release skill in
[.claude/skills/release](https://github.com/clice-io/xclang/blob/main/.claude/skills/release/SKILL.md);
this page is the same process, for people.

## Rules

- **Nothing published is replaced.** A rebuild, even of the same commit, is
  the next revision; the `release` stage refuses a version that exists.
- **Builds run on CI**, on GitHub-hosted runners, from a branch
  `exp/<version>`, not from `main`.
- **A pending release is not mixed with pipeline changes**: the release
  goes out with the pipeline that has been tested.

## Steps

1. **Bootstrap.** `scripts/common.ts` pins the release that builds this one
   (`bootstrap-linux`, `bootstrap-macos`, with their sha256 from that
   release's `SHA256SUMS`). Move it to the previous release when that one
   has what the build needs.
2. **Full run with a draft**, about three hours:
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,release \
     -f revision=<n>
   ```
   A failed stage is run again with `reuse-run` and only the stages still
   to do.
3. **Check the draft**: 17 assets, the test, bazel and cmake jobs green,
   sizes against the previous release.
4. **Notes**: what it was built by, then what changed for users, from
   CHANGELOG.md's Unreleased section.
5. **Publish**, which creates the tag. That starts bazel.yml, which tests
   the tag's module with the published archives and publishes it to
   bazel.clice.io, and cmake.yml, which builds tests/cmake from the tag as
   a user's FetchContent does.
6. **conda**: `conda.yml` with the tag makes, tests and publishes the conda
   packages; a packaging fix of the same release is the next build number.
7. **After publishing**, one commit on `main`, `readme: <version>`: the
   module's `versions.bzl` from the release's `SHA256SUMS`, the version in
   the module files, the README, the docs and examples/
   (`grep -rn <previous version>` finds them), and CHANGELOG.md's
   Unreleased becomes the release's section.
8. **examples.yml**, by hand, once conda.clice.io and bazel.clice.io have
   the release: the docs' commands against it on every host.
9. **bench.yml** with the release run's artifacts, when performance
   matters for the notes or the docs.
