# Runtimes found for the "pc" spellings of Linux and MinGW triples

clang looks for compiler-rt in `lib/clang/<ver>/lib/<triple>`, with the
triple as the command line spells it. xclang builds its runtimes for one
spelling of each target (`x86_64-unknown-linux-gnu`,
`x86_64-w64-windows-gnu`) and writes config files for others too, among
them GCC's `x86_64-pc-linux-gnu` and `x86_64-pc-windows-gnu`
([toolchain](../../docs/en/design/toolchain.md)). With
`--target=x86_64-pc-linux-gnu`, clang read the config file and then found
no `libclang_rt.builtins.a`: nothing linked.

The patch has clang look under the usual spelling too when the vendor is
`pc`: `unknown` for Linux, `w64` for MinGW.

- Upstream: not reported; LLVM names a runtime directory after one
  spelling of the triple, and distributions that build runtimes for one
  spelling meet the same.
- Checked: applies to 23.1.2 with `patch -F0`; the patched `ToolChain.cpp`
  compiles against 23.1.2's headers. The smoke test builds a C program for
  `<arch>-pc-linux-gnu` and `<arch>-pc-windows-gnu` on every host and runs
  it where the host can.
