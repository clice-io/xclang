# COFF objects of windows-gnu targets without a timestamp

Since LLVM 23 clang writes the time of the compile into every COFF
object's header (`TimeDateStamp`), for MinGW targets too: llvm/llvm-project
#188800 moved the default of `-mincremental-linker-compatible` into cc1's
option marshalling, where the negative flag's default (true) wins for
every target, not only MSVC and UEFI ones. LLVM 22 wrote 0 for MinGW, as
GNU tools do. An object then differs on every compile: build caches miss
and a rebuild is other bytes, xclang's own runtimes included.

The patch is upstream's fix: one boolean option with the target's default
(MSVC and UEFI: incremental-linker compatible, others not), in cc1 and in
the integrated assembler (cc1as). Without its tests.

- Upstream: [#219457](https://github.com/llvm/llvm-project/issues/219457)
  (the report, open); fix in
  [#222099](https://github.com/llvm/llvm-project/pull/222099), open, not
  reviewed yet.
- From: #222099 at a331d027664962892db1192676c3a96fc0042e4c, without
  `clang/test` and `clang/unittests`, regenerated against 23.1.2.
- Checked: applies to 23.1.2 with `patch -F0`; the patched `cc1as_main.cpp`
  compiles against 23.1.2's headers; upstream's CI passes on #222099.
  xclang 23.1.2.9 writes the compile time into an `x86_64-w64-mingw32`
  object and LLVM 22.1.5 writes 0. The smoke test compiles one C file for
  `x86_64-w64-mingw32` and for `x86_64-pc-windows-msvc` on every host: the
  MinGW object's `TimeDateStamp` is 0, the MSVC one's is not.
