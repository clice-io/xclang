# Windows arm64: crash stack traces past system DLL frames

LLVM's crash handler on Windows (`llvm/lib/Support/Windows/Signals.inc`)
walks the stack with dbghelp's `StackWalk64`. On arm64, Windows' own DLLs
(ntdll, KERNELBASE, kernel32, ucrtbase) sign the return addresses they save
with pointer authentication; `StackWalk64` returns the signed address
(`0xce437ff8123a5084` for `0x00007ff8123a5084`), finds no function there,
and the walk ends. A trace from clang, lld or a tool on libclang loses
every frame past the first one of a system DLL:

- a crash in a callback of the C library, such as a comparator of
  `llvm::array_pod_sort` (which sorts with `qsort`), shows the comparator
  and ucrtbase's frame, then a signed address, and none of the code that
  sorted;
- `sys::PrintStackTrace` called from a signal handler
  (`sys::AddSignalHandler`), as clice's crash handler did, stops at
  `KERNELBASE!UnhandledExceptionFilter`, before the exception dispatcher
  and every frame of the crash;
- every trace ends with a signed address where `ntdll!RtlUserThreadStart`
  belongs.

The crash's own frames, which LLVM's handler walks from the exception's
context, were there; x64 is unaffected.

The patch walks the stack with ntdll's unwinder on arm64
(`RtlLookupFunctionEntry` and `RtlVirtualUnwind`, which strips the
signatures), stopping where it leaves the context unchanged; elsewhere
`StackWalk64` stays. The stack is walked once, for llvm-symbolizer and for
dbghelp's own symbols alike, instead of once for each.

- Upstream: not reported. The same cause in lldb:
  [#228374](https://github.com/llvm/llvm-project/issues/228374), open; a
  signed last frame from this handler is in
  [#147309](https://github.com/llvm/llvm-project/issues/147309) (flang on
  Windows on Arm, closed for its own cause).
- From: clice's crash handler
  ([clice-io/clice#775](https://github.com/clice-io/clice/pull/775)),
  which walks the same way.
- Checked: applies to 23.1.2 with `patch -F0`; `Signals.inc` is the same on
  LLVM's main of 2026-10-06. On windows-11-arm (dbghelp 10.0.26100),
  23.1.2.6 ends every crash trace of clang and lld with a signed address,
  and the libclang test's tool, crashing in a qsort comparator, shows
  nothing past ucrtbase's frame (exp/win-stacktrace, run 37434185698).
  Built with the patch (run 37434367448), the same traces end at
  `ntdll!RtlUserThreadStart`, and the tool's, from the comparator and from
  its signal handler, reach `main`; on windows-2025 the traces have the
  same frames as without it. MSVC compiles the patched `Signals.cpp` for
  x64 and arm64 (run 37447339805).
