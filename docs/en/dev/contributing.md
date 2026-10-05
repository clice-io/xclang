# Contributing

xclang is a small repository that drives a large build: LLVM, built six
times with PGO and ThinLTO, plus six targets' runtimes. Most contributions
are to the scripts, the build integrations, the tests or the docs, and
most of them are checked on CI, not on a laptop.

## Where things are

```
scripts/           TypeScript, run by Node 24: bootstrap, runtimes and
                   sysroots, toolchain, package, conda, bazel, cli
cmake/caches/      what each LLVM build is
config/            the per-target clang config files
pgo/               the PGO training and remap.txt
windows/alias.c    the launcher behind every name of llvm.exe
patches/           changes to LLVM, a directory and a README each
packages/          the Bazel module, the CMake package, the conda scripts
cli/               the xclang command, in Rust
tests/             smoke.ts, libclang.ts, cmake.ts, bazel.ts, ...
examples/          the projects the docs show
docs/en/           this site
.github/workflows/ CI; main.yml runs a release's stages
```

[How a release is built](../design/release-build.md) has the stages and the
workflows.

## Building

The builds need CI-sized machines: a full release run is about three hours
on GitHub-hosted runners, the toolchain stage about two hours per host.
Run them on CI, on a branch of your own:

```sh
gh workflow run main.yml --ref <branch> \
  -f stages=runtimes,instrumented,train,toolchain,asan,package,test -f revision=<n>
```

`reuse-run` (with `runtimes-run`, `profile-run`) takes a stage's artifacts
from an earlier run instead of building them again; a toolchain without
PGO is enough for most A/B checks. `pixi run <task>` runs a stage the way CI
does (pixi.toml), on a machine that can take it.

What is cheap locally:

- `npm install && npm run check`: TypeScript type checks of scripts/ and
  tests/.
- `node tests/docs.ts`: the docs' code blocks against examples/.
- `cd cli && cargo test`: the xclang command's unit tests.
- A patch: `patch -p1 -F0 --dry-run` against the LLVM release source, and
  compiling the patched file against a release's headers
  ([patching LLVM](llvm-patches.md)).
- Anything against a released toolchain: unpack an archive and use it.

## Style

- Scripts are TypeScript on Node, not Python or shell; comments are `///`
  lines.
- Docs and comments say what is and why, plainly: no marketing adjectives,
  reasons and evidence instead. A claim about behaviour names the test that
  checks it.
- Commit subjects are `<area>: <what changed>` (`bazel: ...`, `docs: ...`,
  `patches: ...`); the body says why.
- Every user-visible change gets a line in CHANGELOG.md's Unreleased
  section.

## Tests

Every change comes with the check that shows it works, on the hosts it
touches:

| change | test |
|---|---|
| the toolchain, the runtimes, a patch | tests/smoke.ts (main.yml's `test` stage, every host) |
| libclang | tests/libclang.ts |
| the CMake package | tests/cmake (cmake.yml) |
| the Bazel module | tests/bazel, tests/bazel.ts, tests/bazel-cross.ts (bazel.yml) |
| the xclang command | tests/cli.ts, tests/cargo.ts (cli.yml) |
| the docs' commands, examples/ | examples.yml |

## The docs

The docs are `docs/en/<group>/<page>.md`, published to
[docs.clice.io/xclang](https://docs.clice.io/xclang) by clice-io/docs's
sync action when `main` changes; `docs/en/sidebar.yaml` orders the pages.
To preview, copy `docs/en` into a checkout of
[clice-io/docs](https://github.com/clice-io/docs) as `en/xclang` and run its
VitePress build (`npm install && npm run build`); the build fails on a
dead link. A code block under `<!-- file: <path> -->` must be that file of
the repository, which tests/docs.ts checks.

## Reporting

Bugs and questions: [GitHub issues](https://github.com/clice-io/xclang/issues).
A bug in clang, lld or libc++ itself is reported upstream, to LLVM; xclang
carries a fix as a patch until upstream has one. Security issues: see
[SECURITY.md](https://github.com/clice-io/xclang/blob/main/SECURITY.md).
