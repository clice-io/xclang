---
name: release
description: Cut an xclang release <llvm version>.<revision> — preflight, full rebuild or repack, CHANGELOG by a pull request to main, release.yml run on release/<version> at that commit, draft, then the release's pull request merged into main publishes it, and published.yml publishes it everywhere. Use when asked to release, rebuild, repack or publish a new xclang revision, or when a release run, a release pull request or published.yml fails.
---

# Cutting a release

A release is `<LLVM_VERSION>.<revision>` (toolchain/common.ts has
`LLVM_VERSION`; the revision is release.yml's `revision` input). The steps
below take it from main to served everywhere. Every failure met on the way
is in [troubleshooting.md](troubleshooting.md): find it by its log line,
do what it says. A failure that is not there is a bug of the pipeline: find
its cause, fix it (a pull request), and add it there.

Rules:

- Nothing published is ever replaced: a rebuild gets the next revision.
- Builds run on CI only, on GitHub-hosted runners (never this machine,
  never Blacksmith). Runs of the release run on `release/<version>`;
  experiments on `exp/*`.
- main takes no direct push. Every change, the CHANGELOG too, reaches it by
  a squashed pull request once checks-passed is green; the release's own
  pull request is merged as a **merge commit**, and that publishes it. The
  lead (or ykiko) merges.
- No bypass of a check. A check that fails on a release pull request is a
  bug to fix, not to skip.
- Ask ykiko before publishing: the draft, its notes and what differs in the
  second build go to him; the release pull request is opened after his OK.
- A pending release is not mixed with pipeline changes: the release goes
  out with the pipeline that preflight and the runs before it tested.

## 0. Preflight

```sh
gh workflow run preflight.yml -R clice-io/xclang --ref main
gh run list -R clice-io/xclang -w preflight.yml -L 1   # its id
gh run watch <id> -R clice-io/xclang --exit-status
gh run view <id> -R clice-io/xclang --log | awk -F'\t' '$1 == "state" && $2 == "Preflight" { sub(/^[^ ]* /, "", $3); print $3 }'
```

(The state job alone, light, also runs from a checkout of main's head:
`node tests/release/preflight.ts` with gh signed in.)

Its `state` job (tests/release/preflight.ts) prints each check: `ok`,
`FAIL` with what to do (`→`), `note`. Its `table` job runs `xclang sdk
update-table --check`. Every FAIL is resolved before step 1, and
preflight run again; troubleshooting.md, "Preflight", has each. It also
says:

- `next`: the version. `LLVM_VERSION` and the next free revision.
- `kind`: **repack** or **full rebuild**, with the files since the latest
  release that decide it (`full` lines). A `read` line (toolchain/common.ts)
  is read by hand: `git diff <latest> origin/main -- toolchain/common.ts`;
  SOURCES, TARGETS, MACOS_MIN, the LLVM pins are a full rebuild; makeTree,
  shareHeaders, writeConfigs, writeCMakePackage are package.ts's, a repack.
  Ask ykiko when a change seems to fall between the two.
- for a repack, the run whose artifacts it reuses (`reuse-run`,
  `profile-run`) and until when they last (90 days from that run).
- for a full rebuild, the bootstrap, and when LLVM moved, the validation
  run (the llvm-upgrade skill's) that must have passed.

A repack reuses the compiler, runtimes, libclang and profile of the run
that built them, byte for byte (clang and lld embed no revision; only
toolchain/package.ts and the xclang command name it): about half an hour
instead of three hours. What a repack may change is what the package stage
reads from the checkout: toolchain/config/, packages/cmake/, packages/bazel/
(published by published.yml, not in the archives), xclang/, package.ts,
licenses, toolchain/runtimes-src.ts (the runtimes' sources in libc++/src),
and docs, examples, tests and workflows, which the archives do not hold. A
fix of the conda packages alone is no release: conda.yml by hand, the same
tag and the next `build`.

## 1. Bootstrap (full rebuild)

`SOURCES["bootstrap-linux"]` and `["bootstrap-macos"]` in
toolchain/common.ts name the release whose Linux x64 and macOS arm64
toolchains build this one, usually the latest. To move it: the two
archives' lines from that release's SHA256SUMS (`gh release download <ver>
-R clice-io/xclang -p SHA256SUMS`), URL and sha256 edited, a pull request
`bootstrap: <ver>`. Keep the old one if the new one lacks something the
build needs. When LLVM moved, the llvm-upgrade skill's validation run is
done before (preflight checks it).

## 2. CHANGELOG, on main, and the branch

When everything else the release takes is on main, a pull request
`changelog: <version>`, squash-merged once checks-passed is green:

- CHANGELOG.md: Unreleased becomes `## [<version>](https://github.com/clice-io/xclang/releases/tag/<version>) — <date>`
  (the UTC date the run starts) with "Built by <bootstrap>." (a repack:
  "The compiler and runtimes are <previous>'s."), and a new empty
  Unreleased;
- docs/en/dev/release-build.md: the release's row in the bootstrap chain
  table (a repack: "<previous>'s compiler, repacked").

Nothing else names a release by hand: the docs, READMEs and examples/
reach the newest by themselves (pixi `xclang = "*"`, `releases/latest`, the
`latest` branch for FetchContent); a Bazel `bazel_dep` version is the
oldest release its example takes (weekly.yml builds each as written); the
Bazel module's own version is the draft's work (step 4).

Its squashed commit on main, M, is what the release is built from; the
branch `release/<version>` is made there, and every run of the release
runs on it, so that a run again stays on M however main moves:

```sh
git fetch origin main
M=$(git log origin/main -1 --format=%H --grep '^changelog: <version>')
git push origin "$M:refs/heads/release/<version>"
```

## 3. The run

A **full rebuild**, about three hours; `rebuild` starts the second full
build (step 3b) once training is done:

```sh
gh workflow run release.yml -R clice-io/xclang --ref release/<version> \
  -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,rebuild,release \
  -f revision=<n>
```

A **repack**, about half an hour, with the run preflight named:

```sh
gh workflow run release.yml -R clice-io/xclang --ref release/<version> \
  -f stages=package,test,bazel,cmake,sdk,cli,release \
  -f reuse-run=<run> -f profile-run=<run> \
  -f repack-of=<previous version> -f revision=<n>
```

The runtimes job copies every unit from reuse-run; package takes each
host's toolchain, libclang and ASan libclang from it and builds the
command anew; release takes the profile from profile-run. With
`repack-of=<version>`, the `test` stage compares every host's archives with
that release's, member by member (tests/release/repack.ts): only the
packaging's files may differ (config files, lib/cmake/xclang, bin/xclang,
share/licenses); a program, library or header that differs fails it, and
the release with it.

A full run made before on an exp branch (an LLVM upgrade's validation run)
stands for the build when what differs from its commit to M is all a
repack's: the run on release/<version> is then the repack's command with
reuse-run and profile-run that run, no repack-of, and its own `rebuild`
was that run's.

Watch it: `gh run watch <id> -R clice-io/xclang --exit-status`, or poll
`gh run view <id> -R clice-io/xclang --json status,conclusion`. For a run
of many jobs, list failures with `gh api
"repos/clice-io/xclang/actions/runs/<id>/jobs?per_page=30&filter=latest"
--paginate -q '.jobs[] | select(.conclusion == "failure") | .name'` (`gh
run view --json jobs` answers 502 there).

A failed job: troubleshooting.md, "The release run". A transient one is
run again once the run has finished: `gh run rerun <id> -R
clice-io/xclang --failed` (the same commit and inputs; the jobs after it
run too). A stage failed for a cause fixed on main since: a new run with
`-f reuse-run=<id>` and only the stages still to do (plus `-f
profile-run=<id>` when `release` runs without `train`), after the branch
is moved to the fix (troubleshooting.md, "A fix the release needs").

### 3b. The second full build

`rebuild` dispatches release.yml again on release/<version> once `train`
passed: `release: revision <n>, runtimes,toolchain,asan,package,test,
against <full run>`, with the first run's profile, its `test` comparing
every host's archives with the first run's, every file (bin/xclang and the
packaging included). Its link is in the `rebuild` job's summary. What
differs is a bug to list (an issue of the board's ci module, with both
runs, and ykiko told with the draft), not a reason to hold the release:
the release is the first run's. Every full rebuild has it; a repack's
packaging is made twice in every run (stage-package.yml) and the command
built twice (cli.yml, same-bytes).

## 4. Check the draft

```sh
gh release view <version> -R clice-io/xclang --json isDraft,targetCommitish,assets \
  -q '.isDraft, .targetCommitish, (.assets | length), (.assets[] | [.name, .size] | @tsv)'
git fetch origin release/<version>
git log -1 --format='%H %s%n%b' <targetCommitish>
git diff --stat <targetCommitish>^ <targetCommitish>
gh release view <previous> -R clice-io/xclang --json assets -q '.assets[] | [.name, .size] | @tsv'
```

- Its commit is `bazel: the module of <version>` on release/<version>: one
  parent, M; it changes packages/bazel/bazel/versions.bzl and MODULE.bazel
  alone, to the release and its digests; its message ends with
  `Archives-Run`, `Compiler-Run` and `Profile-Run`.
- 17 assets: six toolchains, six libclang, two ASan libclang, the option
  tables, the profdata, SHA256SUMS. Sizes against the previous release's
  (within a few percent unless a change explains it).
- Every job of the run green: test (smoke and libclang on every host, the
  programs they build for other targets run there, repack's comparison),
  bazel, cmake, sdk, cli (same-bytes among them).
- A full rebuild: the second build's `test` stage, and what differs.
- Every toolchain archive has `bin/xclang` (`bin/xclang.exe`), and `xclang
  --version` names the release (the test stage's smoke tests check it).

## 5. Notes

As the earlier releases' are (`gh release view 23.1.5.1 -R
clice-io/xclang`): what LLVM and patches, built by what, with a link to the
`[build run](https://github.com/clice-io/xclang/actions/runs/<run>)` (a
repack's: "the same bytes, from its [build run](...)" of the run that built
the compiler); then what changed for users, from the release's section of
CHANGELOG.md.

```sh
gh release edit <version> -R clice-io/xclang --title <version> --notes-file notes.md
```

## 6. ykiko's OK, the pull request

The draft's link, its notes, the second build's result and anything the
runs showed go to ykiko. With his OK:

```sh
gh pr create -R clice-io/xclang --base main --head release/<version> \
  --title "release: <version>" --body "The draft's commit: the module of <version>."
```

Its diff is the module's two files. Its checks test the module with the
draft's archives: test-bazel finds that the module names a release not
published yet and takes the archives of the draft commit's `Archives-Run`
(the `source` job says so). When checks-passed is green, the lead merges
it as a **merge commit** (`gh pr merge <n> -R clice-io/xclang --merge`;
squashed, it publishes nothing: troubleshooting.md, "Squashed"). A pull
request that conflicts (main changed packages/bazel since M): merge
origin/main into release/<version> on the branch, keeping the draft's
versions.bzl and MODULE.bazel, and push; the draft's commit stays in the
history the merge brings.

## 7. published.yml

The merge's push runs published.yml (its `release` job publishes the draft,
which creates the tag at the draft's commit), then: test-bazel.yml with the
release; the tag's module to bazel.clice.io (`bazel-registry`, through
clice-io/bazel); test-cmake.yml from the tag as FetchContent fetches it;
conda.yml, build 0, published to conda.clice.io; the `latest` branch moved
to the tag once conda.clice.io serves it; examples.yml against it.

```sh
gh run list -R clice-io/xclang -w published.yml -L 1
gh run watch <id> -R clice-io/xclang --exit-status
```

A failed job: troubleshooting.md, "published.yml", which says what is
published already. Run again: `gh run rerun <id> -R clice-io/xclang
--failed` once the run finished, or, for a fix that is on main since,
`gh workflow run published.yml -R clice-io/xclang --ref main -f
tag=<version> -f publish=true`, which publishes only to the channels that
lack it.

Done when preflight's checks of the latest release pass for it: run
preflight.yml again; its `ok` lines for published.yml, bazel.clice.io,
conda.clice.io and `latest` name the new release.

## 8. bench.yml (optional)

For the notes or docs/en/design/pgo.md: `gh workflow run bench.yml -R
clice-io/xclang --ref main -f pgo-run=<the release's release.yml run> -f
shards='[1, 2, 3, 4, 5]'`, the release's own archives against LLVM's
release builds, nothing rebuilt.

## Artifacts

A run's toolchain-*, runtimes-*, profile, dist-* and digests-* artifacts
are kept 90 days (GitHub's limit): a repack of a release, the second
build's comparison and the release pull request's checks take them from
the run. Past that, a full rebuild. Check one run's: `gh api
"repos/clice-io/xclang/actions/runs/<run>/artifacts?per_page=100" -q
'.artifacts[] | [.name, .expired, .expires_at] | @tsv'`.
