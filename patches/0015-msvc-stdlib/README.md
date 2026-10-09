# -stdlib= for MSVC targets

clang's MSVC toolchain has no C++ library of its own to look for: Microsoft's
STL comes with the C runtime's headers, in the include directory of the VC
tools, and `-stdlib=` does nothing (`AddClangCXXStdlibIncludeArgs` is
empty: "FIXME: There should probably be logic here to find libc++ on
Windows"). libc++ for MSVC targets then takes `-nostdinc++` and include
directories of one's own, and nothing selects between the two libraries.

With the patch, `-stdlib=` selects it, as on other targets:

- `-stdlib=libc++` adds libc++ installed with the compiler, as the
  Fuchsia and bare-metal toolchains find it: `include/<triple>/c++/v1`
  (the target's `__config_site`), then `include/c++/v1`, before the system's
  headers, which libc++'s include. clang-cl takes it as
  `/clang:-stdlib=libc++`.
- `-stdlib=platform` (or no `-stdlib=`) is Microsoft's STL, as before.
  `CLANG_DEFAULT_CXX_STDLIB` does not change the default of MSVC targets:
  a toolchain that sets it for MinGW keeps its MSVC targets on the STL.
- `-stdlib++-isystem` stands for libc++'s directories, without
  `-stdlib=` too, as before. An explicit `-stdlib=` of another library
  than libc++ drops them (they are claimed): the STL's headers are the
  system's, so there is no directory of a C++ library for them to stand
  for. A configuration file can then select libc++ with `-stdlib=libc++`
  and `-stdlib++-isystem`, and `-stdlib=platform` on the command line
  undoes both. `AddClangCXXStdlibIsystemArgs` becomes virtual for it.

Linking is unchanged. libc++'s headers name its library themselves
(`#pragma comment(lib, ...)` in `__config`, `libc++.lib` or `c++.lib`).
xclang's libc++ for MSVC targets has its own `__config_site` name
`libc++-<arch>.lib` instead, in `lib/clang/<major>/lib/windows`, which
lld-link searches by itself, also when it links without clang.

xclang's config files of the MSVC targets give `-stdlib=libc++` and
`-stdlib++-isystem` its `libc++/include` directories; `-stdlib=platform`
(`/clang:-stdlib=platform`) is the switch to the STL, for C++ interfaces to
libraries built with MSVC.

- Upstream: not sent. Written to be sent (ykiko decides): the change and
  clang/test/Driver/msvc-libcxx.cpp are in the form of a pull request,
  against `main` as of LLVM 23.
- Checked: applies to 23.1.2 with `-F0`, after 0011 to 0013; the driver
  test passes in a build of clang with the patch, with
  clang/test/Driver/stdlibxx-isystem.cpp and the cl-*/msvc-* driver tests;
  tests/sdk/msvc.ts builds with libc++ and with `-stdlib=platform`, through
  both drivers and the CMake package.
