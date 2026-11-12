# MSVC ABI: a thrown type's copy constructor through PCHs and modules

For the Microsoft ABI, the catchable type of a thrown class (`_CT…`) names
the constructor that copies the exception object, which
`std::current_exception`, `std::exception_ptr` and a catch by value call.
Sema chooses it where it checks the throw expression and records it in the
`ASTContext`; CodeGen reads it there. The table is not in PCHs or module
files: a translation unit that emits a throw from a C++20 module or a PCH
(an inline function, a template the module instantiated) writes `_CT`,
`_CTA` and `_TI` without the copy constructor. They are COMDAT-any, so
that copy may be the program's, and the runtime then copies the object
bit by bit: a `std::runtime_error` frees its message twice (heap
corruption, 0xC0000374). `import std;` is enough: libc++'s
`__throw_bad_alloc`, `__throw_out_of_range` and the like
([xclang#27](https://github.com/clice-io/xclang/issues/27)).

The patch is llvm/llvm-project#114075: an AST record of the (class, copy
constructor) pairs, read into the table the first time CodeGen asks. With
the fixes of its review on 2026-10-22, which its author agreed to:

- the pairs are written in the order of their declaration IDs, not of the
  map, which is keyed by pointer: the same BMI or PCH is the same bytes on
  every build;
- asking for a class's copy constructor no longer puts a null one into the
  table (`lookup()`), which a compile that writes the BMI and generates
  code (`-fmodule-output` with `-c`, as xclang builds modules) wrote and
  the reader cast;
- only declarations the file has are written, as for `VTABLE_USES`
  (`wasDeclEmitted`).

And one of its own: the table is keyed by the first declarations, and the
reader keys what it loads by them too, so that an importer with its own
declaration of the class (the header the module includes, included again)
finds it. The record is number 81, as LLVM 23 has taken 78 to 80. Its
tests: the PR's PCH test, and `clang/test/Modules/msvc-throw-copy-ctor.cppm`
for a module, its full BMI, the BMI of the compile that also generates
code (the same bytes), a declaration the reduced BMI drops, and an
importer that includes the header the module includes.

- Upstream: [#53486](https://github.com/llvm/llvm-project/issues/53486)
  (the report, open); fix in
  [#114075](https://github.com/llvm/llvm-project/pull/114075), open, not
  reviewed since 2025-07; the fixes above are not on it.
- From: #114075 at 4698bff9789ee73a2161f49ba509b0ce705ec49f, rebased onto
  23.1.5, with the changes above.
- Checked: applies to 23.1.5 with `patch -F0` after the patches before it.
  A clang 23.1.5 with assertions, built with the series, passes both tests
  and clang's Modules, PCH, CodeGenCXX, SemaCXX and ClangScanDeps tests.
  With one fix taken out, the modules test fails: without the order, six
  builds of one module with 33 thrown types gave six different BMIs;
  without `lookup()`, `wasDeclEmitted` asserts on the null constructor;
  without `wasDeclEmitted`, `GetDeclRef` asserts on a declaration the
  reduced BMI dropped; without the first declarations, the importer that
  includes the header loses the constructor. #114075 as it is gives
  another BMI on each build and asserts on the dropped declaration. xclang 23.1.5.1 writes xclang#27's `_CT??_R0?AUgmf_error@@@88`,
  without the constructor. The smoke test builds that module twice for
  both MSVC targets on every host, wants the same BMI, and the importer's
  catchable type with the constructor: it passes on the six hosts of run
  [43243869198](https://github.com/clice-io/xclang/actions/runs/43243869198).
