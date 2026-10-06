---
name: llvm-upgrade
description: Move xclang to a new LLVM release (e.g. 23.1.2 → 23.1.3 or 24.1.0) — pinned sources, patches re-checked, version-specific code, first release <new>.1. Use when asked to upgrade or follow a new LLVM version.
---

# Upgrading LLVM

1. **Versions and digests** in scripts/common.ts: `LLVM_VERSION`, and the
   sha256 of `llvm-project` and of LLVM's own release builds
   (`llvm-linux-x64`, `llvm-macos-arm64`, `llvm-linux-arm64`,
   `llvm-windows-x64`, `llvm-windows-arm64`, the benchmark's reference).
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
   - cmake/caches/*.cmake and scripts/runtimes.ts / toolchain.ts options a
     new LLVM renamed or removed (CMake warnings of unused variables in the
     build logs);
   - `OPTION_TABLES` in scripts/toolchain.ts: the generated `.inc` paths
     move between versions;
   - pgo/remap.txt, if mangled names of the profile changed;
   - `LIBRARIES` in packages/bazel/bazel/libclang.bzl, @libclang's names
     before any archive is fetched: a libclang archive with a library it
     lacks fails to load (test-bazel.yml of the run says which).
   lib/clang/<major> and the Bazel module's resource directory follow the
   tree by themselves.
4. **Bootstrap**: the previous xclang release builds the new LLVM. If a
   major version needs a newer compiler, the bootstrap may be LLVM's own
   release build again (`bootstrap-linux`/`-macos` pointing at
   `llvm-linux-x64`/`llvm-macos-arm64`, as 23.1.2.1 did; see
   scripts/bootstrap.ts).
5. **CI** on `exp/<llvm version>`: the full release.yml run, revision 1. Fix
   on the branch, rerun failed stages with `reuse-run`. The training and
   the smoke tests are where a new version breaks most.
6. **Docs**: docs/en/dev/release-build.md and docs/en/reference/patches.md if the pipeline or the
   patches changed; CHANGELOG Unreleased: "LLVM <version>", patches dropped
   because upstream took them.
7. Release `<new version>.1` with the release skill.
