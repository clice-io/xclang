# Security

## Reporting

Report a vulnerability privately, through GitHub's
[private vulnerability reporting](https://github.com/clice-io/xclang/security/advisories/new),
not in a public issue. Say which release and host, what an attacker can do,
and how to reproduce it.

What is in scope: xclang's own code and packaging (the scripts that build
the archives, the config files, the Windows launchers, the CMake package,
the Bazel module, the conda packages, the `xclang` command) and the
integrity of what a release publishes. A vulnerability in clang, lld,
libc++ or compiler-rt themselves is LLVM's: report it to LLVM
([LLVM's security policy](https://llvm.org/docs/Security.html)); xclang
then carries the fix as a patch until a release has it.

## What a release guarantees

- A release `<llvm version>.<revision>` is never replaced; a fix is a new
  revision.
- Every asset is listed with its sha256 in the release's `SHA256SUMS`,
  written by the workflow that uploads the assets. The Bazel module pins
  each archive by sha256; CMake's download checks it against `SHA256SUMS`.
- LLVM's source and every other input of the build are pinned by sha256
  in `toolchain/common.ts`; the changes to LLVM are the patches in
  `patches/`, each documented.
- Vendor SDKs are never redistributed; the `xclang` command fetches them
  from the vendor, pinned by version and sha256.

Not yet: GitHub releases are not immutable, so an archive and its
`SHA256SUMS` could in principle be replaced together (a pin recorded
elsewhere is not affected); there are no signed build attestations; the
archives are not byte-for-byte reproducible. See
[releases](https://docs.clice.io/xclang/reference/releases).

## Supported versions

The latest release. Fixes go into the next revision.
