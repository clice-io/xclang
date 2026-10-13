# Runtimes found for other spellings of Linux and MinGW triples

clang looks for compiler-rt in `lib/clang/<ver>/lib/<triple>`, with the
triple as the command line spells it. xclang builds its runtimes for one
spelling of each target (`x86_64-unknown-linux-gnu`,
`x86_64-w64-windows-gnu`) and writes config files for others too, among
them GCC's `x86_64-pc-linux-gnu` and `x86_64-pc-windows-gnu`, and from
23.1.3.1 on `arm64-unknown-linux-gnu` and `arm64-w64-windows-gnu`, Apple's
and Microsoft's name of the architecture
([toolchain](../../docs/en/design/toolchain.md)). With
`--target=x86_64-pc-linux-gnu` or `--target=arm64-linux-gnu`, clang read
the config file and then found no `libclang_rt.builtins.a`: nothing
linked.

The patch has clang look under the usual spelling too: for the vendor
`pc`, `unknown` for Linux and `w64` for MinGW; for the architecture
`arm64`, `aarch64`.

- Upstream: not reported; LLVM names a runtime directory after one
  spelling of the triple, and distributions that build runtimes for one
  spelling meet the same.
- Checked: applies to 23.1.2 with `patch -F0`; the patched `ToolChain.cpp`
  compiles against 23.1.2's headers. The smoke test builds a C program for
  `<arch>-pc-linux-gnu` and `<arch>-pc-windows-gnu` on every host and runs
  it where the host can. The `arm64` spelling, added for 23.1.3.1: applies
  to 23.1.3 with `patch -F0` after the patches before it, and the patched
  `ToolChain.cpp` compiles against 23.1.3's headers. 23.1.2.10's clang,
  with the config files of the `arm64` spellings, links
  `--target=arm64-linux-gnu`, `arm64-w64-mingw32` and `arm64-linux-musl`
  against `lib/clang/23/lib/arm64-*/libclang_rt.builtins.a`, which is not
  there. The smoke test builds a C program for `arm64-linux-gnu`,
  `arm64-pc-linux-gnu`, `arm64-w64-mingw32`, `arm64-pc-windows-gnu` and
  `arm64-linux-musl` on every host and runs it where the host can.
