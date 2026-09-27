# Member-access completion reports an unresolved base

When Sema's heuristics find no class for the base of a member access (the
`->` of a dependent iterator), `CodeCompleteMemberReferenceExpr`
(clang/lib/Sema/SemaCodeComplete.cpp) returns without handing anything to
the code-completion consumer. The patch hands it the member-access context
with whatever results there are, so a consumer that resolves dependent
types itself, as clice does, still gets to complete.

- Upstream: not submitted; clangd would see an extra, empty member-access
  context.
- From: clice-llvm `patches/23.1.1/0002` (applies to 23.1.2 unchanged).
- Checked: applies to 23.1.2; SemaCodeComplete.cpp compiles against
  xclang's libclang.
