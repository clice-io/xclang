# Partial ordering deduces at the templates' own depth

`isAtLeastAsSpecializedAs` (clang/lib/Sema/SemaTemplateDeduction.cpp) sets
up its `TemplateDeductionInfo` at depth 0. Inside an uninstantiated class
template, which code completion's signature help reaches, the implicit
object type carries the outer template's parameter packs; taken for the
member template's own, they index its deduced arguments out of bounds and
crash clang
([clice#701](https://github.com/clice-io/clice/issues/701): completing the
constructor arguments of a placement new).

The fix gives the deduction the depth of the template parameter list being
deduced.

- Upstream: [#226788](https://github.com/llvm/llvm-project/issues/226788).
  A regression in clang 19 (18.1 is fine): since #83279 both constructor
  templates get the implicit object parameter, `V<T, Ts...>`, and with it
  the outer pack.
- From: clice-llvm `patches/23.1.1/0001` (applies to 23.1.2 unchanged).
- Checked: applies to 23.1.2; SemaTemplateDeduction.cpp compiles against
  xclang's libclang.
