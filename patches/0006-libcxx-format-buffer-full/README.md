# format_to's buffer is never left full

`__output_buffer` (libcxx/include/__format/buffer.h) keeps one free code
unit for `push_back`, which writes first and flushes after. Its bulk
writes, `__copy`, `__transform` and `__fill`, can end with the buffer full:
formatting into a `back_inserter(std::string)` (a 256-code-unit buffer on
the stack) an argument whose length is a multiple of 256 fills it, and the
literal that follows is written past its end. `std::format_to` and
`std::vformat_to` into a container overflow the stack; `std::format`,
whose buffer grows, does not. clice's log lines through spdlog's
`std::format` back end took a file path of exactly 256 bytes down this way
(clice temp/issues 09-23#222). Past the overflow `__available()` wraps
around and later writes are unbounded; through `format_to_n` the first
stray code unit lands inside the buffer object, which ASan cannot see and
only libc++'s debug hardening catches. The bug came with
[14b44179](https://github.com/llvm/llvm-project/commit/14b44179cb61)
(LLVM 20) and is still open upstream as
[#154670](https://github.com/llvm/llvm-project/issues/154670) (#160666 and
#199354 are duplicates of it).

The patch makes the bulk writes flush a full buffer when they finish, as
`push_back` does; only the container buffer, whose `__prepare_write`
leaves exactly one free slot, could be left full. The `__transform` hunk
is defensive: its only caller, integer `{:X}`, writes a few dozen code
units at most.

- Upstream: #154670; fix in [#226791](https://github.com/llvm/llvm-project/pull/226791),
  with a regression test, to be backported to 23.x once merged.
- Checked: `format_to` of a 256-code-unit argument and a literal into a
  `back_inserter(std::string)` is a stack-buffer-overflow under ASan with
  xclang 23.1.2.2's headers and correct with the patched ones; for every
  argument length from 0 to 1100, copy, fill and `{:X}` into a string, a
  vector and through `format_to_n` equal `std::format`'s result; a review
  under ASan and debug hardening covered char and wchar_t, six container
  types and twelve `format_to_n` limits. The smoke test runs the first case
  and a `format_to_n` one, with debug hardening.
