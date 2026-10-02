# clang -E: raw string literals across lines

`clang -E` writes a string literal's spelling as it is in the file. A raw
string literal can span lines, and two things go wrong when it does:

- In a file with CRLF line endings its line breaks are `\r\n`. Compiling
  the file turns each into `\n` (`StringLiteralParser`), as the standard's
  phase 1 has it. On Windows, `-E` writes through a text-mode stream when
  the main file's first line ends in CRLF (a choice from 2011), which makes
  them `\r\r\n`: compiling the output gives a string with a `\r` in each
  line break that compiling the file did not.
- The printer does not count the lines the literal spans, so the next
  line starts one line late for each line break: on every OS, the
  `__LINE__`, `std::source_location` and diagnostics of everything after a
  multi-line raw string are off in the compiled output.

Compiling what `-E` wrote is what build caches do: xmake's, which catter
and kotatsu use. The patch writes a string literal's `\r\n` as `\n`, its
meaning, and counts its line breaks as the printer already does for
comments.

- Upstream: [#122070](https://github.com/llvm/llvm-project/issues/122070),
  open since January 2025, no fix.
- Checked: the patched `PrintPreprocessedOutput.cpp` compiles against
  23.1.2's headers. The smoke test preprocesses a CRLF file with a
  two-line raw string, compiles the output, and runs it: the string is
  `a\nb` and the line after it has its own number, on every host.
