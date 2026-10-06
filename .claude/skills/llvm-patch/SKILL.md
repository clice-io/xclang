---
name: llvm-patch
description: Add, update or drop a change to LLVM in xclang's patches/ (patches/NNNN-name/NNNN.patch + README.md), validate it, and track its upstream state. Use when a clang/lld/libc++ bug needs fixing in xclang's build.
---

# A patch to LLVM

`toolchain/common.ts` (`patches()`, `llvmSource()`) applies every
`patches/NNNN-name/*.patch` in directory order right after unpacking
`llvm-project-<LLVM_VERSION>.src.tar.xz`, with `patch -p1 -F0 --forward`:
no fuzz, a patch applies where it was made or the build fails. The series
is recorded in libclang's `XCLANG_PATCHES`. Numbers are never reused (0005
stays gone).

1. **Directory** `patches/NNNN-short-name/`, next free number, holding
   exactly one `NNNN.patch` and a `README.md`.
2. **The patch**: against the release source (a git checkout of
   `llvmorg-<LLVM_VERSION>` is the same tree), paths `a/…`, `b/…`, as
   `git diff` writes them. Upstream's fix when there is one, without its
   test. `*.patch` is `-text` in .gitattributes: never let an editor touch
   its line endings.
3. **README.md**, in the voice of the others (`patches/0007-*/README.md`):
   - `# <what it fixes>`, then what goes wrong, who hits it (clice,
     catter, ...), and what the patch does;
   - `- Upstream:` the issue and the PR, their state (open, merged in
     <version>), duplicates;
   - `- From:` where the patch came from, if not written here;
   - `- Checked:` how it was verified: the file compiled against the
     release's headers, a run on an exp branch with and without it (run
     ids), and the smoke-test case.
4. **Validate locally** (cheap): `patch -p1 -F0 --dry-run -d <llvm-project
   at llvmorg-<version>> -i patches/NNNN-*/NNNN.patch`; compile the patched
   translation unit against the release's headers. Never build LLVM here.
5. **A check that fails without it**, in tests/toolchain/smoke.ts (runs on every
   host's toolchain), or tests/bazel / tests/cmake when it is about them.
   Confirm on CI: push `exp/<name>` and run release.yml
   (`stages=runtimes,instrumented,train,toolchain,asan,package,test`, or
   fewer with `reuse-run`); for a quick A/B, a toolchain without PGO is
   enough (`profile-run` none, `hosts` the one that matters).
6. **Docs**: the table in docs/en/reference/patches.md, an Unreleased entry in
   CHANGELOG.md ("**NNNN** added, …").
7. **Upstream**: report or send it only when the user asks; then record
   the link in the README (`patches: NNNN sent upstream`). Mention xclang
   upstream only where needed.

Dropping one (upstream took it, or something replaces it): delete the
directory, say why in the commit, update docs/en/reference/patches.md and CHANGELOG.md.
Updating one: keep the number, regenerate the patch, update `Checked:`.
