---
name: llvm-upgrade
description: Move xclang to a new LLVM release (e.g. 23.1.2 → 23.1.3 or 24.1.0) — pinned sources, patches re-checked, version-specific code, first release <new>.1. Use when asked to upgrade or follow a new LLVM version.
---

# Upgrading LLVM

1. **Versions and digests** in toolchain/common.ts: `LLVM_VERSION`,
   `LLVM_COMMIT` (the commit of the `llvmorg-<version>` tag, which
   `clang --version` names), and the sha256 of `llvm-project` and of
   LLVM's own release builds (`llvm-linux-x64`, `llvm-macos-arm64`,
   `llvm-linux-arm64`, `llvm-windows-x64`, `llvm-windows-arm64`, the
   benchmark's reference).
   Take the digests from LLVM's release page or download and hash them on a
   runner; nothing is downloaded without a pinned digest.
2. **Patches**: for each `patches/NNNN-*`, check whether upstream took it
   (its README's `Upstream:` link, and the new release's source). Drop
   those it took (see the llvm-patch skill); regenerate the others against
   the new source (`patch -p1 -F0 --dry-run`), keeping their numbers, and
   update each README's `Checked:`.
3. **Version-specific code**: `grep -rn "23\b\|23\.1" --include=*.ts
   --include=*.bzl --include=*.cmake --include=*.yml .` and read each hit:
   - tests/libclang/libclang.ts expects `clang version <major>`;
   - tests/bench/bench.ts and bench.yml name the LLVM compilers they compare;
   - toolchain/cmake/caches/*.cmake and toolchain/runtimes.ts /
     toolchain.ts options a new LLVM renamed or removed (CMake warnings of
     unused variables in the build logs);
   - `OPTION_TABLES` in toolchain/toolchain.ts: the generated `.inc` paths
     move between versions;
   - toolchain/pgo/remap.txt, if mangled names of the profile changed;
   - `LIBRARIES` in packages/bazel/bazel/libclang.bzl, @libclang's names
     before any archive is fetched: a libclang archive with a library it
     lacks fails to load (test-bazel.yml of the run says which).
   lib/clang/<major> and the Bazel module's resource directory follow the
   tree by themselves.
4. **Bootstrap**: the previous xclang release builds the new LLVM. If a
   major version needs a newer compiler, the bootstrap may be LLVM's own
   release build again (`bootstrap-linux`/`-macos` pointing at
   `llvm-linux-x64`/`llvm-macos-arm64`, as 23.1.2.1 did; see
   toolchain/bootstrap.ts).
5. **Validation run**, before the upgrade's pull request merges: the full
   release.yml run on `exp/<llvm version>`, revision 1, every stage but
   `release` (a release is built from main), with the second full build:
   ```sh
   gh workflow run release.yml -R clice-io/xclang --ref exp/<llvm version> \
     -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,rebuild \
     -f revision=1
   ```
   It meets what a new LLVM breaks before a release does: the training and
   the smoke tests most, and the tests' own premises (tests/cmake once
   compared the runtimes built from source with the bootstrap's, object by
   object, which a newer clang compiles differently). Fix on the branch;
   rerun failed stages with `reuse-run`; every test stage green, and what
   the second build's `test` shows differing listed (an issue each). The
   pull request merges only then, with the branch's commit unchanged since
   the run but for what a repack takes (docs, tests, workflows): the
   release preflight (release skill, step 0) looks for this run, and the
   release may reuse it (`reuse-run`, `profile-run`) instead of building
   again.
6. **Docs**: docs/en/dev/release-build.md and docs/en/reference/patches.md if the pipeline or the
   patches changed; CHANGELOG Unreleased: "LLVM <version>", patches dropped
   because upstream took them.
7. The upgrade to main by a pull request, then release `<new version>.1`
   with the release skill.
