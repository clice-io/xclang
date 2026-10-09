# libc++ on vcruntime: std::nothrow twice, get_new_handler in std

libc++ built static for MSVC targets, on Microsoft's vcruntime as its ABI
library (`LIBCXX_CXX_ABI=vcruntime`, libc++'s clang-cl-static
configuration), has two faults:

- **`std::nothrow` is defined twice.** libc++ defines it in
  `new_helpers.cpp`, next to `std::__throw_bad_alloc`, and so does the C
  runtime every program links (`std_nothrow.obj` of `libcmt.lib` and
  `msvcrt.lib`), not as a COMDAT in either. A program that takes both,
  `new (std::nothrow)` and a container that can fail to allocate, fails to
  link: `duplicate symbol: struct std::nothrow_t const std::nothrow`
  (kotatsu's tests). With vcruntime, `<new>` declares the CRT's, so libc++
  leaves the definition out.
- **`import std` does not build.** The std module exports
  `std::get_new_handler`, which vcruntime's `<new.h>` does not declare
  (Microsoft's STL has it, in its own library). It is exported if it
  exists, as the module does for the C library's functions
  (`_LIBCPP_USING_IF_EXISTS`).

- Upstream: not reported.
- Checked: applies to 23.1.2 with `-F0`; libc++ for both MSVC targets
  without `std::nothrow` (llvm-nm); kotatsu's tests link and run with it,
  and tests/cmake's `import std` builds for both MSVC targets.
