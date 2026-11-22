# -stdlib= selects the platform's configuration file

xclang's configuration file of a target gives it xclang's libc++, and for
Linux, musl and MinGW xclang's sysroot: `-stdlib++-isystem` for libc++'s
headers, `-L` for its library (macOS), `--sysroot`. Nothing that comes
after them takes them back. `-stdlib++-isystem` stands for the C++ library's
include directories whatever `-stdlib=` says (`Clang.cpp`), and has no
negation. So a `-stdlib=libstdc++` or `-stdlib=platform` on the command line
compiled against libc++'s headers and failed to link, and on macOS changed
nothing. The platform's C++ library (GCC's libstdc++, the SDK's libc++
dylib, Microsoft's STL) took `--no-default-config`, which also drops what
the target needs besides its C++ library: the vendor SDK, lld, the C
runtime.

xclang ships a second configuration file per target for that,
`<triple>-system.cfg`: the target's file without xclang's C++ library and,
where the platform's library lives in a sysroot of its own, without
xclang's sysroot. With the patch, a `-stdlib=` of another library than
libc++ (`platform`, `libstdc++`) selects it:

- the default configuration file is `<triple>-<mode>-system.cfg` or
  `<triple>-system.cfg` in place of `<triple>-<mode>.cfg` or
  `<triple>.cfg`, where there is one; in clang-cl, `/clang:-stdlib=`
  selects it. The last `-stdlib=` decides, so `-stdlib=libc++` after it
  keeps the default. `--no-default-config` loads neither;
- a `-stdlib=` that selected the file is claimed: a C compile or a link,
  which have no use for it, does not report it unused.

clang then finds the platform's library by itself, as upstream clang does,
also for MSVC targets, whose STL comes with the C runtime's headers. This
replaces patches/0015, which made `-stdlib=platform` drop
`-stdlib++-isystem` for MSVC targets only.

Alpine's libstdc++, for the musl targets on an Alpine host (a musl host's
toolchain) or with an Alpine root as `--sysroot`: Alpine's GCC is
`<arch>-alpine-linux-musl`, and `/usr/lib/gcc/<arch>-linux-musl` a link to
it. clang found GCC through the link, as `<arch>-linux-musl`, and looked
for the target headers of libstdc++ (`bits/c++config.h`) in
`include/c++/<version>/<arch>-linux-musl`, which Alpine names
`<arch>-alpine-linux-musl`: `'bits/c++config.h' file not found`. With the
patch, clang tries Alpine's triple for a musl target of the unknown vendor
before the one without a vendor (`Gnu.cpp`).

- Upstream: not sent. It is about configuration files that give a C++
  library; it could be proposed as configuration files per `-stdlib=`.
  Alpine's triple: not sent either (board 11-22#3); Alpine's own clang adds
  `<arch>-linux-musl` to the candidates instead (aports
  main/clang23/10-add-musl-triples.patch), its default target being
  Alpine's.
- Checked: applies to 23.1.2 with `-F0` after 0001 to 0017, without 0015. A
  clang 23.1.2 built with it, in a 23.1.2.10 tree with `-system.cfg` files
  added, built and ran programs with `-stdlib=platform` against GCC's
  libstdc++ (Linux), linked `/usr/lib/libc++.1.dylib` (macOS, the fetched
  SDK) and Microsoft's STL (MSVC, the fetched SDK, clang and clang-cl);
  `config-file-stdlib.c` and the config-file, cl-options and
  stdlibxx-isystem driver tests pass. Applies to 23.1.3 and 23.1.5 with
  `patch -F0` after the patches before it; 23.1.3, 23.1.4 and 23.1.5 changed
  none of its files. Alpine's triple (added for 23.1.5.3, on 23.1.5): the
  smoke test's and tests/cmake's `-stdlib=platform` programs on Alpine 3.24
  with its g++, x64 and arm64, pass with it (release run 45012646652 on
  exp/musl-release) and failed without it (exp-musl-pipeline run
  45012634786).
