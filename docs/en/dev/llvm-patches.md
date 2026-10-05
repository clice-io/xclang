# Patching and upgrading LLVM

xclang builds LLVM's release source with the changes in
[`patches/`](https://github.com/clice-io/xclang/tree/main/patches). The
maintainers' step lists are the llvm-patch and llvm-upgrade skills in
[.claude/skills](https://github.com/clice-io/xclang/tree/main/.claude/skills);
this page is the same, for people. What each patch does is in
[patches](../design/patches.md).

## The rules a patch follows

- **Applied without fuzz.** `scripts/common.ts` applies every
  `patches/NNNN-name/*.patch` in directory order right after unpacking the
  source, with `patch -p1 -F0 --forward`: a patch applies where it was made
  or the build fails, so a tag's build is exactly its series.
- **Upstream's fix when there is one**, without its tests. A patch is a
  bridge to an LLVM release that has the fix, and is dropped then.
- **A check that fails without it**, in tests/smoke.ts (or the build system
  tests), run on every host.
- **A README** in the patch's directory: what goes wrong and who hit it,
  what the patch does, `Upstream:` (the issue, the PR, their state),
  `From:`, and `Checked:` (how it was verified, with run ids).
- **Numbers are never reused**: 0005, dropped in 23.1.2.5, stays gone.
- `*.patch` files are `-text` in `.gitattributes`: git does not convert
  their line endings, and an editor must not either.

## Adding one

1. `patches/NNNN-short-name/` with `NNNN.patch` (against the release
   source, paths `a/…` and `b/…`, as `git diff` writes them) and
   `README.md`.
2. Check locally: `patch -p1 -F0 --dry-run -d <llvm-project at
   llvmorg-<version>> -i patches/NNNN-*/NNNN.patch`, and compile the
   patched file against the release's headers. Do not build LLVM locally.
3. Add the check to tests/smoke.ts, and confirm it on CI on an
   `exp/<name>` branch: a main.yml run with and without the patch, a
   toolchain without PGO for a quick A/B.
4. Docs: the table in [patches](../design/patches.md), and a CHANGELOG
   Unreleased entry.
5. Report or send it upstream when the maintainers agree to; record the
   link in its README.

## Upgrading LLVM

1. `LLVM_VERSION` and the sha256 of every pinned source in
   `scripts/common.ts`, from LLVM's release page.
2. Each patch: dropped if upstream took it, otherwise regenerated against
   the new source (`-F0`), keeping its number, with its README's `Checked:`
   updated.
3. Version-specific code: `grep -rn "23\b\|23\.1"` over the TypeScript,
   Starlark, CMake and workflow files, and read each hit (tests/libclang.ts,
   the benchmark's compilers, renamed CMake options, the option tables'
   paths, pgo/remap.txt, the Bazel module's library list).
4. The bootstrap: the previous xclang release, unless a major version
   needs a newer compiler; then LLVM's own release build, as for 23.1.2.1.
5. A full main.yml run on `exp/<llvm version>`; the training and the smoke
   tests are where a new version breaks most.
6. The first release of the new version is `<version>.1`
   ([releasing](releasing.md)).
