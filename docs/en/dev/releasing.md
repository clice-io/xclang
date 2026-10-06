# Releasing

How a release `<llvm version>.<revision>` is cut. The step list for
maintainers is the release skill in
[.claude/skills/release](https://github.com/clice-io/xclang/blob/main/.claude/skills/release/SKILL.md);
this page is the same process, for people. What the pipeline does is in the
[build pipeline](release-build.md).

## Rules

- **Nothing published is replaced.** A rebuild, even of the same commit, is
  the next revision; the `release` stage refuses a version that exists.
- **Builds run on CI**, on GitHub-hosted runners, from a branch
  `exp/<version>`, not from `main`.
- **A pending release is not mixed with pipeline changes**: the release
  goes out with the pipeline that has been tested.

## Full Rebuild or Repack

A release whose changes are all in what the `package` stage reads from
the checkout is a **repack**: the config files (`config/`), the CMake
package (`packages/cmake`), the Bazel module (`packages/bazel`, which the
archives do not hold), the `xclang` command (`cli/`), the license notices
and `scripts/package.ts`. It reuses the compiler, runtimes, libclang and
profile of the run that built the previous release, the same bytes, and
takes about half an hour instead of three hours. Anything built into
those, such as a patch, a pinned source, the runtimes, the CMake caches or
the training, needs a full rebuild. A fix of the conda packages alone is
no release, but the next conda build number of the same one.

## Steps

1. **Bootstrap.** `scripts/common.ts` pins the release that builds this one
   (`bootstrap-linux`, `bootstrap-macos`, with their sha256 from that
   release's `SHA256SUMS`). Move it to the previous release when that one
   has what the build needs.
2. **Full run with a draft**, about three hours:
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,msvc,macos,release \
     -f revision=<n>
   ```
   A failed stage is run again with `reuse-run` and only the stages still
   to do. A repack, in about half an hour, skips the bootstrap step:
   ```sh
   gh workflow run main.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=package,test,bazel,cmake,msvc,macos,release \
     -f reuse-run=<full run> -f profile-run=<full run> \
     -f repack-of=<previous version> -f revision=<n>
   ```
   `<full run>` is the run that built the compiler. Its toolchain and
   runtimes artifacts last 14 days, its profile 30; after that, only a
   full rebuild can make a release. With `repack-of`, the `repack` job
   checks each host's archives against that release's, file by file
   (`tests/repack.ts`): only the packaging's files may differ.
3. **Check the draft**: 17 assets, the test, bazel, cmake, msvc and macos
   jobs green (and repack's, for a repack), sizes against the previous
   release.
4. **Notes**: what it was built by, then what changed for users, from
   CHANGELOG.md's Unreleased section. A repack's say that the compiler and
   runtimes are the previous release's, the same bytes.
5. **Publish**, which creates the tag. That starts bazel.yml, which tests
   the tag's module with the published archives and publishes it to
   bazel.clice.io, and cmake.yml, which builds tests/cmake from the tag as
   a user's FetchContent does.
6. **conda**: `conda.yml` with the tag makes, tests and publishes the conda
   packages; a packaging fix of the same release is the next build number.
7. **After publishing**, one commit on `main`, `readme: <version>`: the
   module's `versions.bzl` from the release's `SHA256SUMS`, the version in
   the module files, the README, the docs and examples/
   (`grep -rn <previous version>` finds them), the runs table of
   [testing](testing.md), and CHANGELOG.md's Unreleased becomes the
   release's section.
8. **examples.yml**, by hand, once conda.clice.io and bazel.clice.io have
   the release: the docs' commands against it on every host.
9. **bench.yml** with the release run's artifacts, when performance
   matters for the notes or the docs.
