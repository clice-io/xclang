# Release troubleshooting

Each failure a release has met, by where it shows and the line that says
it, with what to do. Find a failed job's lines with

```sh
gh api "repos/clice-io/xclang/actions/runs/<run>/jobs?per_page=30&filter=latest" --paginate \
  -q '.jobs[] | select(.conclusion == "failure") | [.id, .name] | @tsv'
gh api repos/clice-io/xclang/actions/jobs/<job id>/logs | grep -nE '::error::|error:|FAILED|Error' | head -40
```

(`gh run view <run> --json jobs` and `gh run view --log-failed` answer
`HTTP 502` on a run of a hundred jobs or more: use the API as above.)

Running again: `gh run rerun <run> -R clice-io/xclang --failed`, once the
whole run has finished, runs the failed jobs and those after them, with the
run's commit, inputs and workflow files. A fix on main since is not in it:
for that, a new run (release.yml from the branch moved to the fix;
published.yml by hand from main).

A failure not listed here is found to its cause, fixed by a pull request,
and added here. A transient one that recurs is a bug too: give what
downloads a retry, or tell the lead whose service fails.

## Transient: the network

Downloads in the workflows go through `node tests/lib/retry.ts` (gh, git,
curl in scripts) or `fetchRetry` (tests/lib/net.ts): five tries over about
six minutes, each retry logged as `::warning::<command> failed for the
network (try N of 5)`. A job that still fails for the network is run again
once the run has finished. Lines that say it:

| line | from |
|---|---|
| `HTTP 502: Server Error (https://api.github.com/...)`, `HTTP 500`, `HTTP 504` | gh: GitHub's API or release downloads |
| `error: https://github.com/clice-io/xclang/releases/download/...: HTTP 502` | tests/lib/archives.ts |
| `WARNING: Download from https://github.com/.../rules_java-9.1.0.tar.gz failed: class java.io.IOException GET returned 500 Internal Server Error` (rules_swift, bazel-skylib, an xclang asset alike) | Bazel's downloader, from GitHub |
| `##[error]Unable to download artifact(s): Connect Timeout Error`, `Failed to CreateArtifact: Unable to make request: ENOTFOUND` | actions/download-artifact, upload-artifact |
| `curl: (28) Failed to connect to github.com port 443 after 75004 ms` | a docs command of examples.yml (run as written, no retry) |
| `HTTP status server error (503 Service Unavailable) for url (https://conda.clice.io/<subdir>/repodata_shards.msgpack.zst)` | pixi: conda.clice.io is GitHub Pages, which serves no shard index; a 503 on that probe fails the solve. Run again; the cause is clice-io/conda's (told to the lead 11-12) |
| `[TypeError: fetch failed]`, `ConnectTimeoutError ... api.github.com:443` | a script's fetch |

Not transient, though they look it:

- `http status: 403` from `swcdn.apple.com`, or Bazel's `GET returned 403
  Forbidden` for a `CLTools_*_SDK.pkg`: Apple withdrew the package. See
  "Vendor SDKs".
- `HTTP 404` for `.../releases/download/<version>/...` of a release still a
  draft: see "The release pull request".

## Preflight

| FAIL | do |
|---|---|
| `this checkout is ..., main's head is ...` | `git fetch origin main && git checkout --detach origin/main`; run it again. On CI it runs on main: dispatched with `--ref main` |
| `checks.yml failed on main's head` | main is broken: find the job (above), fix it by a pull request. No release from a red main |
| `checks.yml on main is in_progress` | wait, run again |
| `published.yml for <latest> failed` | each failed job explained under "published.yml" below; what is fixed on main: `gh workflow run published.yml -R clice-io/xclang --ref main -f tag=<latest> -f publish=true`, green, then preflight again |
| `bazel.clice.io has no xclang <latest>`, `conda.clice.io has no <latest> for ...`, `the latest branch is ..., not <latest>'s tag` | published.yml did not finish for it: as the line above |
| `<latest>'s tag is not in main's history` | a pull request of the tag into main, merged as a merge commit (`git push origin <latest>:refs/heads/exp/<latest>-into-main`, a PR of it). stage-draft.yml refuses a release without it |
| `no weekly.yml run on main within 8 days and after <latest> was published` | `gh workflow run weekly.yml -R clice-io/xclang --ref main`, wait (about an hour), preflight again |
| `weekly.yml failed` | each failed job: a stale example pin or SDK table ("Vendor SDKs"), the network (above), a flake ("Flakes"); fix by a pull request, weekly.yml again |
| `open release pull requests: #n (release/<v>)` | one release at a time: finish it (merge, after ykiko's OK) or close it, delete its draft and branch |
| `drafts: <v>` | a draft left by an attempt: `gh release delete <v> -R clice-io/xclang --yes`, and `git push origin --delete release/<v>` if nothing of it is wanted |
| `the branch release/<next> exists` | left by an attempt: `git push origin --delete release/<next>` |
| `<name>: ...'s sha256 is not <tag>'s SHA256SUMS'` | the bootstrap pin is wrong: take both lines from that release's SHA256SUMS |
| `LLVM moved to <v> and no full release.yml run of main's build passed every test stage` | the llvm-upgrade skill's validation run, on exp/<llvm version>, green; its fixes on main first |
| `run <id>, which built <latest>'s compiler, lacks ... (expired)` | no repack: a full rebuild |
| `run <id>'s artifacts expire <date>` | start the repack now, or a full rebuild |
| table: `error: sdk-versions.json is not what the vendors offer now` (with `+ MSVC ...`, `+ Windows SDK ...`, `+ macOS SDK ...`, `- macOS SDK ... in no catalog now` above it) | the table goes into the release up to date: `gh workflow run preflight.yml -R clice-io/xclang --ref main -f update-table=true`; `gh run download <run> -R clice-io/xclang -n sdk-versions -D /tmp/table`; copy over xclang/sdk-versions.json; a pull request `sdk: the version table of <date>` (a repack's change). Never commit a vendor's package, only the table |
| `note nothing since <latest> reaches the archives or the Bazel module` | ask whether a release is wanted at all |

## The release run

### A stage fails

| line | cause, do |
|---|---|
| a transient line (above) | `gh run rerun <run> -R clice-io/xclang --failed` once the run has finished |
| `cmake / consumer ...`: `runtimes-default: libc++.a: N of M members differ from .../usr/lib: cxa_demangle.cpp.o, locale.cpp.o` | LLVM moved past the bootstrap and the test wanted the same code (fixed in tests/cmake/cmake.ts, 23.1.5.1); if it is back, the test's premise is wrong again: fix it (see "A fix the release needs"); an LLVM upgrade meets this in its validation run |
| `package` / `compare`: `diff digests/first.txt digests/again.txt` shows a line | the archives made twice differ: a reproducibility bug of toolchain/package.ts; fix it; never released so |
| `cli / the same bytes from both builds`: a `diff` line | the xclang command built twice differs: fix xclang/build.ts or its inputs |
| `test / repack (<host>)`: a program, library or header differs from `<previous>`'s | the repack is not one: what changed reaches the compiler or runtimes; a full rebuild |
| `sdk`/`cli`: Apple's 403 | "Vendor SDKs" |
| `FAILED: --features=asan: no ASan libclang for this host's target, and the build says so` (bazel / module, aarch64-w64-mingw32) | met once (published.yml 40152912038), cause unknown (board issue ci/10-25#1, which says what the log now shows); run again, and add what the log says to that issue |

### A fix the release needs

The CHANGELOG is on main already. While no draft exists:

1. The fix by a pull request to main; its squashed commit is M'.
2. The branch moved there: `git push -f origin <M'>:refs/heads/release/<version>`.
3. A new run on it: the stages the fix touches and every stage after them,
   with `-f reuse-run=<run>` for the rest (`-f profile-run=<run>` when
   `train` does not run). The archives hold the commit's time, so a new
   commit always runs `package` and what follows it.
4. The `changelog:` commit is not made again: the release is built from M',
   which has it.

### stage-draft.yml (the `release` stage)

| `::error::` | do |
|---|---|
| `release <v> is published; a rebuild gets the next revision` | the revision is taken: the next one, its own CHANGELOG pull request, branch and run |
| `a release is drafted from its branch release/<v>, made at a commit of main, not refs/heads/...` | dispatched on another ref: run it on `--ref release/<v>` |
| `the run's commit ... is not in main's history (ahead)` | release/<v> is not at a commit of main (a pull request's head, or a commit pushed to it): `git push -f origin <M>:refs/heads/release/<v>`, run again |
| `latest (...), the tag of the release before, is not in the history of the run's commit` | the previous release's tag never reached main: a pull request merging it (merge commit), then release/<v> made again at main, and the run again |
| `release/<v> has the module commit of other archives (...)` | a run before drafted other archives; that draft is gone or wrong: `git push -f origin <its parent>:refs/heads/release/<v>`, and `gh release delete <v> -R clice-io/xclang --yes` if a draft is left; run again |
| `a draft of <v> exists at <commit>, not <commit>` | a draft of another run: `gh release delete <v> -R clice-io/xclang --yes`, reset the branch to the commit of main it was made at, run again |
| `dist/... is not an archive of <v>` | reuse-run's archives are of another revision: run `package` here with this revision |
| `! [rejected] HEAD -> release/<v> (fetch first)` | the branch moved during the run: reset it (`git push -f origin <M>:refs/heads/release/<v>`) and run `release` again (`-f stages=release -f reuse-run=<run> -f profile-run=<run>`) |
| an upload or `gh release ...` that failed for the network | `gh run rerun <run> --failed`: the stage finishes the draft of its commit (uploads every asset again, `--clobber`) |
| `diff files.txt assets.txt` shows a line | an asset of the draft is not the file: run the stage again (as above) |

A draft deleted by hand leaves its module commit on release/<v>, naming a
release that does not exist, and nothing on main. Before running again, the
branch goes back to its parent: `git push -f origin <draft commit>^:refs/heads/release/<v>`.
A run started on the branch while it has the module commit of these same
archives drafts on it as it is (`the run's commit is the module commit of
<v>`).

### The second full build

| line | do |
|---|---|
| `rebuild`: `::error::the second full build did not start` | dispatch it by hand: `gh workflow run release.yml -R clice-io/xclang --ref release/<v> -f stages=runtimes,toolchain,asan,package,test -f profile-run=<run> -f repack-of=<run> -f revision=<n>` |
| its `test / repack (<host>)` lists members that differ | the release goes on: an issue of the board's ci module for each cause (the two runs, the members, what differs: `llvm-readobj --file-headers`, `--coff-debug-directory`, `llvm-objdump -d` of both), and ykiko told with the draft. Known: the MinGW x64 ASan DLL's link time (ci/11-12#3, fixed for 23.1.5.2), `llvm.exe`'s PDB GUID, `TypeLoc.cpp.obj`'s PHI order in libclangAST.a (llvm-upstream 11-12#2) |

## The release pull request

| line | do |
|---|---|
| test-bazel `source`: `packages/bazel names <v>, a draft: the archives of run <run>` | not a failure: what its checks test |
| `source`: `... names no Archives-Run` | a draft commit made before stage-draft.yml wrote it: run `release` again on the branch to make the draft anew (as "A fix the release needs", from the release stage) |
| `source`: `the SHA256SUMS of <v>: HTTP 5xx` | transient: run the failed jobs again |
| distdir: `this commit's module names the release of run <run> with other archives than that run's` | the module commit and its Archives-Run disagree: the draft was made from other archives; find which, draft again |
| `Error downloading [https://github.com/clice-io/xclang/releases/download/<v>/...] ... 404 Not Found` | a check took the published release's path for a draft (its `source` job found no draft): read that job's log; the module's VERSION and whether `<v>` is published |
| `download-artifact`: `Artifact not found` for `dist-<host>` | the run's artifacts expired (90 days): the release run again (it makes the same archives with the same profile) |
| it conflicts | main changed packages/bazel since M: `git fetch origin && git checkout -B release/<v> origin/release/<v> && git merge origin/main`, keep the branch's versions.bzl and MODULE.bazel, push; never rebase or squash the branch |

### Squashed

The release pull request merged by squash publishes nothing: published.yml
fails with `main's packages/bazel names <v>, a draft whose commit this push
did not bring: was its pull request squashed?`. main has the module's files
but not the draft's commit, which the tag must be. To finish:

1. A pull request of release/<v> into main again (it has a commit main
   lacks, the diff is empty), merged as a **merge commit**.
2. That push changes no file published.yml watches, so:
   `gh workflow run published.yml -R clice-io/xclang --ref main -f tag=<v> -f publish=true`,
   which publishes the draft (its commit is in main's history now) and
   does the rest.

## published.yml

What a failed job leaves, and what to do. The `release` job published the
draft before anything else ran: the tag and assets are public, and nothing
published is withdrawn; a fix of what failed is on main, and published.yml
by hand from main (`-f tag=<v> -f publish=true`) does what is left,
publishing only to the channels that lack the version. A broken release is
followed by the next revision, never replaced.

| job failed | published already | do |
|---|---|---|
| `release`, before `published <v>` in its summary | nothing | its error (below); run again |
| `release`: `the commits of releases ... came into main's history at once` | nothing | publish one by hand: `gh workflow run published.yml ... -f tag=<v> -f publish=true`, then the other |
| `release`: `... was its pull request squashed?` | nothing | "Squashed" above |
| `release`: `<v> is a draft; publish=true publishes it` | nothing | by hand, with `-f publish=true` |
| `release`: `the draft's commit ... is not in main's history` | nothing | its pull request merges it (a merge commit) first |
| `release`, `channels` (curl) | the release | `gh run rerun <run> --failed`: the rerun takes it as published (`<v>: published by a try before`) |
| `bazel` (test-bazel.yml with the release) | the release, conda (independent) | transient: rerun; a test's bug: fix on main, published.yml by hand from main; the module's bug: the tag's module is what bazel.clice.io would get, so the next revision. `bazel-registry`, `latest`, `examples` wait for it |
| `bazel-registry` (clice-io/bazel's action) | the release, conda | its log: the token (`UPLOAD_BAZEL`), the registry's pull request; rerun. Not published twice: a run sees the version on bazel.clice.io |
| `cmake` | the release, others | as `bazel`; `latest` waits for it |
| `conda / build` or `conda / test` | the release, bazel.clice.io | transient: rerun; packaging bug: fix packages/conda on main, then `gh workflow run conda.yml -R clice-io/xclang --ref main -f tag=<v> -f build=1 -f publish=true` (the next build number), and published.yml by hand for `latest` and examples |
| `conda / publish` | maybe part of the files | `error: <file>: published with other bytes`: packages made again are other bytes; never publish build 0 again: conda.yml by hand with `-f build=1`. Other errors are clice-io/conda's (`ZSTD_error_prefix_unknown` was its zip64 bug, fixed): tell the lead |
| `latest`: `gh: Update is not a fast forward (HTTP 422)` | all channels | the tag does not descend from `latest`: stage-draft.yml refuses such a release, so find how it was made |
| `latest`: `conda.clice.io has no xclang <v> after 30 minutes` | all channels but `latest` | clice-io/conda's Pages build is stuck: `gh run list -R clice-io/conda -L 5` (a `pages-build-deployment` waiting); `gh api -X POST repos/clice-io/conda/pages/builds`; then rerun |
| `examples` | everything | the docs against the release as users get it; each job: a stale pin or table ("Vendor SDKs"), the network, a flake; fix by a pull request, then `gh workflow run examples.yml -R clice-io/xclang --ref main` |

"Re-run failed jobs" runs the workflow files and scripts of the run's
commit (the tag's for published.yml's jobs that check it out): a fix of a
script is run by published.yml by hand from main instead.

## checks.yml's bazel-version

| line | do |
|---|---|
| `packages/bazel names <a>, older than the release <b>` | `<b>` was published without its pull request merging into main: merge release/<b>'s pull request (merge commit) |
| `versions.bzl names <b> with other digests than its SHA256SUMS` | main's module is of other archives than those published: a pull request with `node packages/bazel/bazel.ts versions <b's SHA256SUMS>` |
| `HTTP 502` from `gh release download` | transient (retried five times): rerun |

## Vendor SDKs

| line | do |
|---|---|
| `error: https://swcdn.apple.com/.../CLTools_macOSLMOS_SDK.pkg: http status: 403` (xclang sdk fetch), `GET returned 403 Forbidden` (Bazel) | Apple withdrew the package. From 23.1.5.1 on, fetch finds the same SDK in a package Apple lists now, by content; it failed, so no package has that SDK any more, or the command is older. The table updated (Preflight's table line); a release ships it. An example pinned to an older release: raise its `bazel_dep` to one whose fetch works (#40) |
| `macOS SDK <x>: Apple no longer serves its package, and none of those its catalogs list now carries this SDK ...; they carry ...` | the version is gone: the table updated drops it; the docs, a preset or a test naming it move to one still carried |
| a pull request's `sdk` or `examples / sdk` job fails on a download | a pull request fetches with its own command (test-sdk.yml, examples.yml `command`): its table is what fails, fixed in the pull request or by the table's update first |

## Flakes

Known, run again once; a second time is a bug to find:

- `examples / features` or the Bazel examples on macOS: ThreadSanitizer
  reports no race in `//:race` (`grep -x ... race` fails). Fixed on arm64
  Linux; on macOS not found yet.
- A ThinLTO link that aborts (`Linking libclang/targets_test.exe failed:
  (Aborted)`, a stack in `sccp`), met once.
- An Intel Mac CMake 3.28.1 link that hangs (the job's timeout), met once.
