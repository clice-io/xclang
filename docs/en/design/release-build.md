# How a release is built

A release is built on GitHub-hosted runners by `main.yml`, from LLVM's
release source with the [patches](patches.md) applied, in stages:

1. **Runtimes.** A bootstrap clang builds every target's sysroot, libc++,
   libc++abi, libunwind and compiler-rt, and libc++'s ASan build.
2. **Instrumented compiler.** The bootstrap clang builds a clang and lld
   with frontend instrumentation, on Linux x64.
3. **Training.** The instrumented toolchain compiles a fixed training set
   and writes the profile: about 1700 compiler runs in 23 minutes
   ([PGO](pgo.md)).
4. **Toolchains.** Every host's clang, lld and tools are built with that
   profile and ThinLTO, about two hours per host; the same build tree gives
   that host's libclang archive. The ASan libclang of Linux x64 and macOS
   arm64 is built apart, without profile or ThinLTO. Linux and Windows hosts
   are built on Linux x64, the macOS ones on macOS arm64; every host but
   those two is cross-compiled.
5. **Package and test.** Each host's archives are tested on a machine of
   that host (below), and the Bazel module and the CMake package are tested
   with them.
6. **Release.** A draft release with every archive, the profile and
   `SHA256SUMS`; publishing it, by hand, creates the tag.

## The bootstrap chain

The bootstrap clang is an earlier xclang release, pinned with its sha256 in
`scripts/common.ts`; the first was built by LLVM's own release builds:

| release | built by |
|---|---|
| 23.1.2.1 | LLVM 23.1.2's release builds (Linux x64, macOS arm64) |
| 23.1.2.2 | 23.1.2.1 |
| 23.1.2.3 | 23.1.2.2 |
| 23.1.2.4 | 23.1.2.3 |
| 23.1.2.5 | 23.1.2.3 |
| 23.1.2.6 | 23.1.2.5 |

xclang builds itself with the same config files, runtimes and linker its
users get, so the release pipeline is its first user. The bootstrap moves
forward deliberately, as a release that lacks something the build needs
breaks it (23.1.2.1 lacked compiler-rt's headers, which LLVM's ASan build
includes); 23.1.2.6 moved to 23.1.2.5, whose ld64.lld has
[patch 0007](patches.md), to link xclang's own macOS builds with it.
LLVM's release builds stay pinned as the benchmark's reference.

## What is tested before a release

Each host's archives, on a machine of that host:

- its own programs load no C++ runtime (and need glibc 2.17 at most);
- C and C++ programs build for every target and run where they can, with
  wide atomics, hardening flags, GCC's library names, a version resource,
  and `-static` on Linux;
- `import std`, a PCH, ThinLTO, ASan, TSan and libFuzzer work natively, and
  the checks the [patches](patches.md) were made against pass
  (tests/smoke.ts);
- a small tool on libclang, found through `find_package(Clang)`, builds and
  runs (tests/libclang.ts);
- tests/bazel builds and tests with the Bazel module (bazel.yml; the
  published release's is cross-compiled for every other target too, and
  run on a machine of it), and tests/cmake with the CMake package, by
  `PATH`, for every other target, and downloaded by FetchContent, with
  CMake 3.28 and the newest (cmake.yml).

After publishing, examples.yml runs the documentation's commands against
the release from conda.clice.io, the archives, the tag and bazel.clice.io.

## The workflows

`main.yml`, started by hand, runs the stages as reusable workflows;
`stages` picks which run, and `reuse-run` (with `runtimes-run`,
`profile-run`) takes a stage's artifacts from an earlier run instead of
building them again.

| stage | workflow | |
|---|---|---|
| `runtimes` | runtimes.yml | the runtimes and sysroots of every target |
| `instrumented` | toolchain.yml | the clang and lld that record the profile (Linux x64) |
| `train` | train.yml | the training run, giving `profile` |
| `toolchain` | toolchain.yml | every host's toolchain and libclang |
| `asan` | toolchain.yml | the ASan libclang of Linux x64 and macOS arm64 |
| `package` | package.yml | every host's release archives |
| `test` | test.yml | every host's archives checked on a machine of that host |
| `bazel` | bazel.yml | the Bazel module with every host's archives |
| `cmake` | cmake.yml | the CMake package with every host's archives |
| `release` | release.yml | a draft release of everything, with `SHA256SUMS` |

With `cli`, `package` also builds the
[xclang command](../reference/xclang-command.md) (cli.yml) and puts it into
every toolchain archive; it is off until the command ships. cli.yml also runs on its own, testing the command on every host.

A draft creates no tag; publishing it does, by hand. Publishing starts
bazel.yml, which tests the release's module and publishes it to
[bazel.clice.io](https://bazel.clice.io), and cmake.yml, which builds
tests/cmake from the tag as a user fetches it. conda.yml, by hand, makes
the conda packages of a published release, tests them with pixi on every
host and publishes them to [conda.clice.io](https://conda.clice.io).
Once the release is on both, examples.yml (by hand) runs the docs'
commands and examples/ against it on every host. bench.yml compares
xclang's compile speed with LLVM's own build of the same version, and
Apple's clang on macOS (tests/bench.ts, [PGO](pgo.md#what-it-buys)).

## Repository

```
cmake/caches/      what each build is: runtimes, the host toolchain, the
                   instrumented one, the ASan libclang
cmake/toolchain.cmake   building for a target with an xclang tree
config/            the per-target clang config files
scripts/           TypeScript, run by Node: bootstrap, runtimes (with the
                   sysroots), toolchain, package, conda, bazel
pgo/               the training (train.ts, its corpus) and remap.txt
windows/alias.c    the launcher behind every name of llvm.exe
cli/               the xclang command, in Rust; its SDK version table,
                   sdk-versions.json
patches/           changes to LLVM, a directory and a README each
tests/             smoke.ts and libclang.ts, the per-host checks; bazel/
                   and cmake/, the build systems' consumers; bench.ts,
                   compile speed against other compilers; docs.ts, the
                   docs' code blocks against examples/
examples/          the projects the docs show, built by examples.yml
docs/              this documentation: docs/en/<group>/<page>.md,
                   published to docs.clice.io/xclang
packages/          what xclang's users build with (packages/README.md):
  bazel/           the Bazel module; scripts/bazel.ts makes its registry
                   archive
  cmake/           the CMake package (find_package, toolchain file,
                   FetchContent download)
  conda/           the conda packages' activation scripts; scripts/conda.ts
                   makes the packages
.github/workflows/ the workflows above
```

`pixi run <task>` runs each stage the way CI does (pixi.toml); the builds
themselves need CI-sized machines.
