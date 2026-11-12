# Releasing

How a release `<llvm version>.<revision>` is cut. The step list for
maintainers is the release skill in
[.claude/skills/release](https://github.com/clice-io/xclang/blob/main/.claude/skills/release/SKILL.md);
this page is the same process, for people, and the skill's
[troubleshooting](https://github.com/clice-io/xclang/blob/main/.claude/skills/release/troubleshooting.md)
lists every failure met so far, by its log line, with what to do. What the
pipeline does is in the [build pipeline](release-build.md).

## Rules

- **Nothing published is replaced.** A rebuild, even of the same commit, is
  the next revision; the `release` stage refuses a version that exists.
- **A release is built from `main`, and its tag lands on `main`.** `main`
  is the develop branch, the tag the release. The release's CHANGELOG
  reaches `main` by a pull request, as every change does; its build runs
  on CI, on GitHub-hosted runners, from the branch `release/<version>`
  made at that commit; the branch's pull request, merged into `main` as a
  merge commit, publishes the release.
- **A pending release is not mixed with pipeline changes**: the release
  goes out with the pipeline that has been tested.

## Full Rebuild or Repack

A release whose changes are all in what the `package` stage reads from
the checkout is a **repack**: the config files (`toolchain/config/`), the
CMake package (`packages/cmake`), the Bazel module (`packages/bazel`,
which the archives do not hold), the `xclang` command (`xclang/`), the
license notices, the runtimes' sources (`libc++/src`, from
`toolchain/runtimes-src.ts`) and `toolchain/package.ts`. It reuses the
compiler, runtimes, libclang and profile of the run that built the
previous release, the same bytes, and takes about half an hour instead of
three hours. Anything built into those, such as a patch, a pinned source, the
runtimes, the CMake caches or the training, needs a full rebuild. A fix
of the conda packages alone is no release, but the next conda build
number of the same one.

## Reproducible Rebuilds

A rebuild of a revision with its profile is meant to give every archive
again, byte for byte. That is checked, not guaranteed: a bug of the
compiler or linker that builds xclang can break it
([reproducible builds](../design/roadmap.md#reproducible-builds)). Every
release run checks the cheap part: each host's archives made twice, and
the `xclang` command built twice, on two machines each. For every full
rebuild, a second full build checks the rest before the release is
published: the full run's `rebuild` stage starts it once the training is
done, as

```sh
gh workflow run release.yml -R clice-io/xclang --ref release/<version> \
  -f stages=runtimes,toolchain,asan,package,test \
  -f profile-run=<full run> -f repack-of=<full run> -f revision=<n>
```

It builds everything but the profile again, and its `test` stage compares
every host's archives with the full run's: every file must be the same,
the `xclang` command and the packaging included. The release is the
first run's; what differs is a bug, listed with the rebuilds checked.

## Steps

0. **Preflight**: `gh workflow run preflight.yml -R clice-io/xclang --ref main`
   checks, changing nothing, that `main` and the weekly run are green, the
   latest release is published everywhere, nothing of another release is
   under way, and the version table of the vendor SDKs is what the vendors
   offer; it says the next version, whether it is a full rebuild or a
   repack, and the bootstrap or the run a repack reuses.
1. **Bootstrap**, for a full rebuild. `toolchain/common.ts` pins the release
   that builds this one (`bootstrap-linux`, `bootstrap-macos`, with their
   sha256 from that release's `SHA256SUMS`). Move it to the previous
   release when that one has what the build needs.
2. **CHANGELOG.md**, by a pull request to `main` once everything else the
   release takes is there: Unreleased becomes the release's section, with
   what built it ("Built by `<bootstrap>`.", or for a repack "The compiler
   and runtimes are `<previous>`'s."), and a new empty Unreleased. Nothing
   else names a release by hand: the docs, the READMEs and `examples/`
   name no release but the oldest the Bazel module takes, and reach the
   newest by themselves. The pull request's commit on `main` is the one
   the release is built from: the branch `release/<version>` is made
   there, and every run of the release runs on it, so that a run again
   stays on that commit however `main` moves.
3. **Full run with a draft**, about three hours:
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref release/<version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,rebuild,release \
     -f revision=<n>
   ```
   A failed stage is run again with `reuse-run` and only the stages still
   to do. A repack, in about half an hour:
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref release/<version> \
     -f stages=package,test,bazel,cmake,sdk,cli,release \
     -f reuse-run=<full run> -f profile-run=<full run> \
     -f repack-of=<previous version> -f revision=<n>
   ```
   `<full run>` is the run that built the compiler. Its artifacts last 90
   days; after that, only a full rebuild can make a release. With `repack-of`, the `test` stage
   checks each host's archives against that release's, file by file
   (`tests/release/repack.ts`): only the packaging's files may differ.
   A full rebuild's `rebuild` stage starts the second full build of
   [reproducible rebuilds](#reproducible-rebuilds) next to it.
4. **Check the draft**: 17 assets, every job of the run green, sizes
   against the previous release. Its commit is `bazel: the module
   of <version>`, which the `release` stage commits on the run's, with
   its times, and pushes to `release/<version>`:
   `packages/bazel/bazel/versions.bzl` and `MODULE.bazel` name the release
   and its digests, so that its tag downloads its archives through
   `git_override`. The stage refuses a run
   whose commit is not in `main`'s history, or whose history lacks the
   previous release's tag, which `latest` names and moves forward from.
   `main` is not touched yet: a draft that is deleted leaves the commit on
   `release/<version>` only, which goes back to its parent before another
   run.
5. **Notes**: what it was built by, then what changed for users, from the
   release's section of CHANGELOG.md. A repack's say that the compiler and
   runtimes are the previous release's, the same bytes.
6. **Publish**: the notes on the draft, then a pull request of
   `release/<version>` into `main`, whose diff is the module. Merged as a
   merge commit (not squashed, as every other pull request is), it brings
   the draft's commit into `main`'s history, and published.yml publishes
   the draft, which tags that commit. The pull request's checks test the
   module with the draft's archives, taken from the run its commit names
   (`Archives-Run`), since a draft's assets cannot be downloaded. Then
   published.yml publishes the release
   everywhere else: the Bazel module tested with the published archives
   and published to bazel.clice.io, `tests/cmake` built from the tag as a
   user's FetchContent does, the conda packages made, tested and
   published, the `latest` branch moved to the tag, and examples.yml, the
   docs' commands against the release on every host. A packaging fix of
   the conda packages alone is conda.yml by hand, with the next build
   number.
7. **bench.yml** with the release run's artifacts, when performance
   matters for the notes or the docs.
