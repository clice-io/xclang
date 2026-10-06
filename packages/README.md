# packages

What xclang's users build with; the toolchain itself is built by
[scripts/](../scripts).

| directory | what it is | docs |
|---|---|---|
| [bazel/](bazel) | the Bazel module `xclang`, published to [bazel.clice.io](https://bazel.clice.io) (scripts/bazel.ts makes its archive); `git_override` of a commit takes it with `strip_prefix = "packages/bazel"` | [Bazel](../docs/en/integrations/bazel.md) |
| [cmake/](cmake) | the CMake package: in every toolchain archive as `lib/cmake/xclang` (scripts/package.ts), and `xclang.cmake`, which a build includes from a FetchContent checkout of a tag to download the toolchain | [CMake](../docs/en/integrations/cmake.md) |
| [conda/](conda) | the activation scripts of the conda package `xclang`, on [conda.clice.io](https://conda.clice.io) (scripts/conda.ts makes the packages) | [Installing](../docs/en/guide/install.md) |

Their tests are in [tests/](../tests): tests/bazel and tests/bazel/bazel.ts,
tests/cmake and tests/cmake/cmake.ts; the conda packages are tested by
conda.yml.
