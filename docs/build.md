# How a release is built

1. A bootstrap clang builds the runtimes of every target and an
   instrumented clang and lld. The bootstrap clang is a previous xclang
   release (`scripts/common.ts` pins it); until there was one, it was
   LLVM's own release build, which is PGO and ThinLTO optimized too.
2. The instrumented toolchain compiles a fixed training set on Linux x64,
   at `-O0 -g` and `-O2`, for x86_64 and aarch64, linked with lld (ELF,
   COFF, ThinLTO): C and C++ sources (abseil, sqlite); precompiled
   headers, a shared one and a preamble per abseil source, parsed and
   completed on as an editor does; C++20 modules (libc++'s `std` and
   `std.compat`, magic_enum's, Vulkan-Hpp's, a wrapped nlohmann/json, a
   module of partitions) and their importers, two-phase and one-phase
   with reduced BMIs; P1689 scans by clang-scan-deps; code completion
   requests. This gives one profile per release, about 1700 compiler runs
   in 23 minutes.
3. Every host's clang, lld and tools are built with that profile and
   ThinLTO, about two hours per host; the same build tree gives that
   host's libclang archive. The profile comes from frontend
   instrumentation, whose function hashes depend only on the source, so
   the profile recorded on Linux applies to every host; a remapping file
   matches names whose mangling differs (`unsigned long` against
   `unsigned long long`). The ASan libclang of Linux x64 and macOS arm64
   is built apart, without profile or ThinLTO.
4. Each host's archives are tested on that host before the release is
   published:
   - its own programs load no C++ runtime (and need glibc 2.17 at most);
   - C and C++ programs build for every target and run where they can,
     with wide atomics, hardening flags, GCC's library names, a version
     resource, and `-static` on Linux;
   - `import std`, a PCH, ThinLTO, ASan, TSan and libFuzzer work
     natively, and the checks the [patches](patches.md) were made against
     pass (tests/smoke.ts);
   - a small tool on libclang, found through `find_package(Clang)`, builds
     and runs (tests/libclang.ts);
   - tests/bazel builds and tests with the Bazel module (bazel.yml), and
     tests/cmake with the CMake package, by PATH, for every other target,
     and downloaded by FetchContent, with CMake 3.28 and the newest
     (cmake.yml).

LLVM's source is the release's, with [the patches](patches.md) applied.

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

A draft creates no tag; publishing it does, by hand. Publishing starts
bazel.yml, which tests the release's module and publishes it to
[bazel.clice.io](https://bazel.clice.io), and cmake.yml, which builds
tests/cmake from the tag as a user fetches it. conda.yml, by hand, makes
the conda packages of a published release, tests them with pixi on every
host and publishes them to [conda.clice.io](https://conda.clice.io).
bench.yml compares xclang's compile speed with LLVM's own build of the
same version, and Apple's clang on macOS (tests/bench.ts).

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
patches/           changes to LLVM, a directory and a README each
tests/             smoke.ts and libclang.ts, the per-host checks; bazel/
                   and cmake/, the build systems' consumers; bench.ts,
                   compile speed against other compilers
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
