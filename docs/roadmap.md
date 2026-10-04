# Roadmap

What xclang may do next. Nothing here has a date or is a commitment. Each
item is

- **planned**: decided, waiting for the work;
- **being considered**: wanted, its form or its cost still open;
- **in research**: whether it can be done well is still being found out.

What each release changed is in the [CHANGELOG](../CHANGELOG.md).

## More sysroots and targets

- **musl**, planned: a Linux sysroot with musl instead of glibc, for fully
  static Linux programs that take nothing from the system they run on.
- **More architectures**, being considered: riscv64 Linux, wasm32-wasi,
  carried by every host's toolchain as the six targets are.
- **macOS and Windows MSVC-ABI targets from any host**, in research. macOS
  targets use Xcode's SDK, and Windows targets are MinGW ones. With the
  vendor's SDK (Apple's macOS SDK; Microsoft's CRT and Windows SDK), which
  the user fetches and accepts the license of, every host could build for
  both. xclang never redistributes these SDKs.

## Build systems

- **A ThinLTO link cache**, planned: a switch in the Bazel module and the
  CMake package that keeps the backend compiles of ThinLTO links, so a
  relink after a small change redoes only what changed.
- **More targets from CMake and Bazel**, planned: the Bazel module
  registers the host's toolchain only, and would register one per target;
  both build systems would take the new targets above as they come.

## Reproducibility

- **Reproducible links**, planned: the same inputs link to the same binary
  wherever they are linked; on macOS, debug maps without the build's
  directory (`-oso_prefix`), on Windows, no link timestamps.
- **Immutable releases**, planned: GitHub releases whose assets cannot
  change once published, so neither can the `SHA256SUMS` that
  [CMake](cmake.md)'s download checks archives against.

## Following LLVM

- **LLVM 23.1.3 and 24.x**, planned: each as it is released, with the
  [patches](patches.md) checked against it.
- **BOLT**, in research: clang and lld of the Linux hosts optimized by BOLT
  on top of PGO and ThinLTO.
