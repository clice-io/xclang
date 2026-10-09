# MSVC targets: clang's compiler-rt ahead of Visual Studio's

When clang links for an MSVC target, it gives lld-link the library
directories of Visual Studio and the Windows SDK first, and its own
compiler-rt directory (`lib/clang/<ver>/lib/windows`) after them. Visual
Studio has `clang_rt.*.lib` of its own in its library directory
(builtins, UBSan, libFuzzer, the profile runtime: Microsoft's build, for
the clang it ships), and lld-link takes the first library of a name it
finds. On a Windows host with no fetched SDK, where xclang's config files
leave clang to find Visual Studio, those then took the place of xclang's:
on windows-2025 (Visual Studio 18, MSVC 14.51) `__int128` division, UBSan
and libFuzzer did not link. lld-link on its own already prefers clang's
directory ("Prefer the Clang provided builtins over the ones bundled with
MSVC", lld/COFF/Driver.cpp); the driver did the opposite.

The patch moves the compiler-rt directories ahead of Visual Studio's and
the SDK's in the link. A user's `-L` stays after them.

- Upstream: not reported.
- Checked: applies to 23.1.2 with `patch -F0`; the patched `MSVC.cpp`
  compiles against 23.1.2's headers. The smoke test links and runs a
  program dividing `__int128`s, and one with `-fsanitize=undefined`, for
  the MSVC target on Windows hosts without a fetched SDK.
