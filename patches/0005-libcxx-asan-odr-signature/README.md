# ASan's container checks in libc++'s ODR signature

libc++ tags its internal functions with an ABI tag (`[abi:nqe230102]`) made
of the configuration their code depends on (hardening, assertion
semantic, exceptions, version), so that a program never links one TU's
copy of `vector<T>::push_back` built one way into another TU built the
other way. With `-fsanitize=address`, libc++'s containers annotate their
unused capacity for ASan (`__sanitizer_annotate_contiguous_container`),
and the signature does not say so.

xclang's libc++ is a static library built without ASan. An ASan program
that instantiates a function libc++.a also uses (`std::filesystem`'s
`vector<string_view>::push_back`) gets one copy of it: a mix of annotating
and non-annotating members over the same vector, and a false
container-overflow report (`std::filesystem::relative` in catter's debug
tests on macOS; on Linux at `-O0`).

The patch adds `a` to the signature when the container checks are on, so
an ASan program's copies (`[abi:nqea230102]`) stay apart from the
library's; programs without ASan keep the same names. Upstream's rule for
the signature is any property that makes a function's code differ
(bc792a284362); the checks are one it misses. The condition that turns
them on moves next to the signature, and `__debug_utils/sanitizers.h` uses
it from there, so the two cannot drift apart. libc++ as a shared library
does not show the bug: its copies stay hidden inside it.

Limits: code built without ASan that grows a container an ASan TU owns can
still produce a false report (ASan's documented limitation, not libc++'s);
an `import std` built without `-fsanitize=address` gives an ASan program
no container checks at all, so build the module with the same flags.

- Upstream: not submitted; a candidate, with a test modelled on
  `odr_signature.*.sh.cpp`.
- Checked: a program calling `std::filesystem::weakly_canonical` and
  `relative` after its own `vector<string_view>::push_back`, at `-O0` with
  `-fsanitize=address`, reports a container overflow with xclang
  23.1.2.2's headers and runs clean with the patched ones; without ASan
  the symbol names are unchanged. The smoke test runs it.
