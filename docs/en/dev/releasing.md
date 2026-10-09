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
the checkout is a **repack**: the config files (`toolchain/config/`), the
CMake package (`packages/cmake`), the Bazel module (`packages/bazel`,
which the archives do not hold), the `xclang` command (`xclang/`), the
license notices and `toolchain/package.ts`. It reuses the compiler,
runtimes, libclang and profile of the run that built the previous
release, the same bytes, and takes about half an hour instead of three
hours. Anything built into those, such as a patch, a pinned source, the
runtimes, the CMake caches or the training, needs a full rebuild. A fix
of the conda packages alone is no release, but the next conda build
number of the same one.

## Steps

1. **Bootstrap**, for a full rebuild. `toolchain/common.ts` pins the release
   that builds this one (`bootstrap-linux`, `bootstrap-macos`, with their
   sha256 from that release's `SHA256SUMS`). Move it to the previous
   release when that one has what the build needs.
2. **CHANGELOG.md**, on the release's branch `exp/<version>`: Unreleased
   becomes the release's section, with what built it ("Built by
   `<bootstrap>`.", or for a repack "The compiler and runtimes are
   `<previous>`'s."), and a new empty Unreleased. The tag then has it, and
   nothing has to follow on `main`: the docs, the READMEs and `examples/`
   name no release but the oldest the Bazel module takes, and reach the
   newest by themselves.
3. **Full run with a draft**, about three hours:
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,release \
     -f revision=<n>
   ```
   A failed stage is run again with `reuse-run` and only the stages still
   to do. A repack, in about half an hour:
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref exp/<version> \
     -f stages=package,test,bazel,cmake,sdk,cli,release \
     -f reuse-run=<full run> -f profile-run=<full run> \
     -f repack-of=<previous version> -f revision=<n>
   ```
   `<full run>` is the run that built the compiler. Its toolchain and
   runtimes artifacts last 14 days, its profile 30; after that, only a
   full rebuild can make a release. With `repack-of`, the `test` stage
   checks each host's archives against that release's, file by file
   (`tests/release/repack.ts`): only the packaging's files may differ.
4. **Check the draft**: 17 assets, every job of the run green, sizes
   against the previous release.
5. **Notes**: what it was built by, then what changed for users, from the
   release's section of CHANGELOG.md. A repack's say that the compiler and
   runtimes are the previous release's, the same bytes.
6. **Publish**, which creates the tag, and then fast-forward `main` to the
   release's branch. Publishing starts published.yml: the Bazel module
   tested with the published archives and published to bazel.clice.io,
   `tests/cmake` built from the tag as a user's FetchContent does, the
   conda packages made, tested and published, the `latest` branch moved to
   the tag, and examples.yml, the docs' commands against the release on
   every host. A packaging fix of the conda packages alone is conda.yml by
   hand, with the next build number.
7. **bench.yml** with the release run's artifacts, when performance
   matters for the notes or the docs.
