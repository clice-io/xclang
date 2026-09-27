# Patches

Changes to LLVM that xclang builds with, each in a directory of its own:
the patch against the llvm-project release (`llvm-project-<version>.src`,
paths `a/…`, `b/…`) and a README saying what it changes, why, and where it
stands upstream. `scripts/common.ts` applies them in the order of the
directory names, right after unpacking the source, so a release's tag holds
the exact series its build used; the libclang manifest lists them
(`XCLANG_PATCHES`).

A patch comes with the check it was made against (see its README); a new
LLVM version means checking each again, dropping those upstream took.
