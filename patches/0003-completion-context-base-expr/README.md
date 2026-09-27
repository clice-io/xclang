# The completion context carries the member base expression

`CodeCompletionContext::getBaseType` is the base's type after Sema's
approximations of dependent types (a smart pointer's first template
argument, a bare template parameter). The patch adds `getBaseExpr`, the
base expression as written, whose declared type a consumer (clice) can
resolve itself. Sema sets it for member-access completion.

The patch adds a member to `CodeCompletionContext` (clang/include/clang/
Sema/CodeCompleteConsumer.h): everything using the class is built with it.

- Upstream: not submitted.
- From: clice-llvm `patches/23.1.1/0003` (applies to 23.1.2 unchanged).
- Checked: applies to 23.1.2; SemaCodeComplete.cpp and
  CodeCompleteConsumer.cpp compile against xclang's libclang.
