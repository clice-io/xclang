# ld64.lld: the macOS 27 SDK's arm64e.x1 slices

The `.tbd` stubs of the macOS 27 SDK (Xcode 27) list a new architecture,
`arm64e.x1`, among their targets. LLVM 23.1.2's TextAPI does not know it,
so ld64.lld rejects the stubs of libSystem and every framework
(`could not load TAPI file ...: malformed file`, `unknown target`):
no macOS program links against that SDK, natively (xcrun picks the newest
SDK of the selected Xcode) or from another host with the SDK fetched.

The patch teaches TextAPI, the triple parser and the Mach-O readers the
architecture (CPU subtype 12 of arm64): ld64.lld reads such stubs and
links the slice it needs, and llvm-otool and llvm-readobj name it. It is
upstream's change as release/23.x has it, where the new enumerators come
last so that LLVM 23's ABI is unchanged, without its tests.

- Upstream: [#222721](https://github.com/llvm/llvm-project/pull/222721),
  merged for LLVM 24; backported to release/23.x by
  [#224185](https://github.com/llvm/llvm-project/pull/224185) as
  532fa5afbe2b and ee66426152f9, so in 23.1.3. The backport's lldb change
  (#223090) is not here: xclang builds no lldb.
- From: `git diff 9efc50ac8a20 ee66426152f9` of release/23.x, without
  lldb/ and the tests.
- Checked: applies to 23.1.2 with `patch -F0`. Against the macOS 27.0 SDK
  (fetched by exp/sdk-fetch's `sdk/vendor-sdk.py`, preset `xcode-27`) on
  arm64 macOS, xclang 23.1.2.5 fails to link a C program with the error
  above, and the toolchain built with the patch (exp/debug-symbols, run
  37264970523) links and runs a C program, a C++ one and one on
  CoreFoundation. The smoke test links a dylib against a libSystem stub
  listing `arm64e.x1`, on every host, which 23.1.2.5's ld64.lld fails the
  same way.
