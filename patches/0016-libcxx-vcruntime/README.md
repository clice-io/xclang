# libc++ on vcruntime: std::nothrow twice, no std::set_new_handler

libc++ built static for MSVC targets, on Microsoft's vcruntime as its ABI
library (`LIBCXX_CXX_ABI=vcruntime`, libc++'s clang-cl-static
configuration), counts on Microsoft's STL library for a part of `<new>`
and repeats another, which it links in its own tests (`libcpmt.lib` or
`msvcprt.lib`) and its users do not:

- **`std::nothrow` is defined twice.** libc++ defines it in
  `new_helpers.cpp`, next to `std::__throw_bad_alloc`, and so does the C
  runtime every program links (`std_nothrow.obj` of `libcmt.lib` and
  `msvcrt.lib`), not as a COMDAT in either. A program that takes both,
  `new (std::nothrow)` and a container that can fail to allocate, fails to
  link: `duplicate symbol: struct std::nothrow_t const std::nothrow`
  (kotatsu's tests). With vcruntime, `<new>` declares the CRT's, so libc++
  leaves the definition out.
- **No `std::set_new_handler` or `std::get_new_handler`.** vcruntime's
  `<new.h>` declares `set_new_handler`, which only the STL's library
  defines, and nothing declares `get_new_handler`: a call of the first did
  not link, and the `std` module, which exports both, did not build.
  libc++ now declares `get_new_handler` and defines both, over UCRT's
  `_set_new_handler`, whose handler vcruntime's `operator new` calls when
  `malloc` fails, as the STL does.

- Upstream: not reported. libc++'s own clang-cl configurations link the
  STL's library, which defines these, so its tests do not see them.
- Checked: applies to 23.1.2 with `-F0`; libc++ for both MSVC targets has
  no `std::nothrow` and has both handlers (llvm-nm); kotatsu's tests link
  and run, tests/sdk/msvc.ts's `std::set_new_handler` program links and
  runs, and tests/cmake's `import std` builds, for both MSVC targets.
