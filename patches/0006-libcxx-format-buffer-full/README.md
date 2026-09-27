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
(clice temp/issues 09-23#222). LLVM's main branch has the same code.

The patch makes the bulk writes flush a full buffer when they finish, as
`push_back` does.

- Upstream: not submitted; a candidate.
- Checked: `format_to` of a 256-code-unit argument and a literal into a
  `back_inserter(std::string)` is a stack-buffer-overflow under ASan with
  xclang 23.1.2.2's headers and correct with the patched ones; for every
  argument length from 0 to 1100, copy, fill and `{:X}` into a string, a
  vector and through `format_to_n` equal `std::format`'s result. The smoke
  test runs the first case.
