# Contributing to xclang

Thanks for helping. The full guide is
[docs.clice.io/xclang/dev/contributing](https://docs.clice.io/xclang/dev/contributing)
([source](docs/en/dev/contributing.md)); in short:

- **Builds run on CI.** A release run is about three hours on
  GitHub-hosted runners; run `main.yml` on a branch of your own
  (`exp/<name>`), reusing earlier stages with `reuse-run`. Locally, check
  types (`npm install && npm run check`), the docs (`node tests/docs.ts`),
  the xclang command (`cd cli && cargo test`), and patches with
  `patch -p1 -F0 --dry-run`.
- **Every change comes with its check**: tests/smoke.ts for the toolchain,
  runtimes and patches; tests/cmake, tests/bazel for the build systems;
  examples.yml for what the docs show.
- **Scripts are TypeScript on Node**, with `///` comments.
- **Commit subjects** are `<area>: <what changed>` (`bazel: ...`,
  `docs: ...`); the body says why. User-visible changes get a line in
  CHANGELOG.md's Unreleased section.
- **Docs** are `docs/en/<group>/<page>.md`, published to
  [docs.clice.io/xclang](https://docs.clice.io/xclang) from `main`. Plain
  and precise: what is, why, and the test that shows it.
- **Changes to LLVM** are patches in `patches/`, each with a README and a
  check that fails without it ([patching LLVM](docs/en/dev/llvm-patches.md)).

Bugs and requests: [issues](https://github.com/clice-io/xclang/issues).
Security issues: [SECURITY.md](SECURITY.md).
