# ld64.lld: no unwind entry from a symbol of an empty section

ld64.lld's `__unwind_info` gets an entry per function address, from every
symbol defined in code. A symbol of an empty section has the address of
whatever follows it: its entry, without unwind information, can take the
place of that function's, which then cannot unwind. A ThinLTO link with
`-object_path_lto` (which clang's Darwin driver passes when it compiles
and links in one command) writes an empty `0.arm64.lto.o` whose `ltmp0`
comes first in `__text`: `main` loses its unwind entry, and on arm64 a
program built that way cannot catch what it throws (`terminate`). This is
what kept xclang's macOS targets on the system's ld until now.

The patch skips symbols of empty sections when the unwind entries are
collected; a real function without unwind information still gets its
zero entry. It is upstream's fix, without its test.

- Upstream: [#224949](https://github.com/llvm/llvm-project/issues/224949)
  (#226786 is a duplicate of it); fix in
  [#225055](https://github.com/llvm/llvm-project/pull/225055), open.
- Checked: built from #225055 and with its change reverted (xclang branch
  exp/lld-225055, runs 36519151429 and 36521671251, Linux and macOS
  arm64): a ThinLTO program linked with `-object_path_lto` catches its
  exception only with the fix. The smoke test's ThinLTO program, compiled
  and linked by one command, throws and catches.
