# Contributing

xclang is a small repository that drives a large build: LLVM, built six
times with PGO and ThinLTO, plus the runtimes of six targets. Most
contributions are to the scripts, the build integrations, the tests or the
docs. Most of them are checked on CI, not on a laptop.

## Where Things Are

```
cmake/caches/      what each LLVM build is: runtimes, the host toolchain,
                   the instrumented one, the ASan libclang
cmake/toolchain.cmake   building for a target with an xclang tree
config/            the per-target clang config files
scripts/           TypeScript, run by Node 24: bootstrap, runtimes (with
                   the sysroots), toolchain, package, conda, bazel, cli
pgo/               the training (train.ts, its corpus) and remap.txt
windows/alias.c    the launcher behind every name of llvm.exe
cli/               the xclang command, in Rust; its SDK version table,
                   sdk-versions.json
patches/           changes to LLVM, a directory and a README each
packages/          what xclang's users build with (packages/README.md):
  bazel/           the Bazel module; scripts/bazel.ts makes its registry
                   archive
  cmake/           the CMake package (find_package, toolchain file,
                   FetchContent download)
  conda/           the activation scripts of the conda packages;
                   scripts/conda.ts makes the packages
tests/             smoke.ts and libclang.ts, the per-host checks; bazel/
                   and cmake/, the build systems' consumers; bench.ts,
                   compile speed; docs.ts, the docs against examples/
examples/          the projects the docs show, built by examples.yml
docs/en/           this site
.github/workflows/ CI; main.yml runs the stages of a release
```

The [build pipeline](release-build.md) has the stages and the workflows.

## Building

The builds need CI-sized machines. A full release run is about three hours
on GitHub-hosted runners, and the toolchain stage about two hours per
host. Run them on CI, on a branch of your own:

```sh
gh workflow run main.yml --ref <branch> \
  -f stages=runtimes,instrumented,train,toolchain,asan,package,test -f revision=<n>
```

`reuse-run`, with `runtimes-run` and `profile-run`, takes the artifacts of
a stage from an earlier run instead of building them again. A toolchain
without PGO is enough for most A/B checks. `pixi run <task>` runs a stage
the way CI does (pixi.toml), on a machine that can take it.

These are cheap locally:

- `npm install && npm run check`: TypeScript type checks of `scripts/` and
  `tests/`.
- `node tests/docs.ts`: the code blocks of the docs against `examples/`,
  the links, and the status words.
- `cd cli && cargo test`: the unit tests of the xclang command.
- A patch: `patch -p1 -F0 --dry-run` against the LLVM release source, and
  compiling the patched file against the headers of a release
  ([patching LLVM](llvm-patches.md)).
- Anything against a released toolchain: unpack an archive and use it.

## Style

- Scripts are TypeScript on Node, not Python or shell. Comments are `///`
  lines.
- Docs and comments say what is and why, plainly. No marketing
  adjectives; reasons instead.
- Commit subjects are `<area>: <what changed>` (`bazel: ...`,
  `docs: ...`, `patches: ...`). The body says why.
- Every user-visible change gets a line in the Unreleased section of
  CHANGELOG.md.

## Tests

Every change comes with the check that shows it works, on the hosts it
touches. What each test covers is in [testing](testing.md).

| change | test |
|---|---|
| the toolchain, the runtimes, a patch | `tests/smoke.ts` (the `test` stage of main.yml, every host) |
| libclang | `tests/libclang.ts` |
| the CMake package | `tests/cmake` (cmake.yml) |
| the Bazel module | `tests/bazel`, `tests/bazel.ts`, `tests/bazel-cross.ts` (bazel.yml) |
| the xclang command | `tests/cli.ts`, `tests/cargo.ts` (cli.yml) |
| the commands of the docs, `examples/` | examples.yml |

## The Docs

The docs are `docs/en/<group>/<page>.md`, published to
[docs.clice.io/xclang](https://docs.clice.io/xclang) by the sync action of
clice-io/docs when `main` changes. `docs/en/sidebar.yaml` orders the pages
and gives their sidebar labels, one to three words each.

- Every page is one kind: a guide, an integration how-to, a feature page, a
  reference page or a design note.
- What is not in a release has one row in the
  [roadmap](../design/roadmap.md), with one of its six status words. Other
  pages link the status word to that row, and end with
  `## Not Yet Supported` and `## Known Limitations`.
- Measurements live in [PGO](../design/pgo.md) and
  [the ThinLTO cache](../features/thinlto-cache.md), each with its release.
  Test names and CI runs live in [testing](testing.md).
- A code block under `<!-- file: <path> -->` must be that file of the
  repository, and one under `<!-- excerpt: <path> -->` consecutive lines of
  it. A command block is an excerpt of a step of examples.yml, or says
  why CI does not run it (`<!-- not run: <why> -->`). `tests/docs.ts`
  checks all three.
- An example of a page is a directory of `examples/`, with the `pixi.toml`
  of the quick start, and an `expected.txt` for what its program prints.

To preview, copy `docs/en` into a checkout of
[clice-io/docs](https://github.com/clice-io/docs) as `en/xclang` and run its
VitePress build (`npm install && npm run build`). The build fails on a dead
link.

## Reporting

Bugs and questions go to
[GitHub issues](https://github.com/clice-io/xclang/issues). A bug in clang,
lld or libc++ itself is reported upstream, to LLVM; xclang carries a fix as
a patch until upstream has one. For security issues, see
[SECURITY.md](https://github.com/clice-io/xclang/blob/main/SECURITY.md).
