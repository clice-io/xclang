# Plain clang, Make and Meson

Any build that runs a compiler by name works with xclang: put xclang's
`bin/` first in `PATH` (pixi does) or name the programs by their path, and
add `--target` for another target. Every command on this page is run as
written on every host by
[examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml)
([the run for 23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37354730630)),
Make on Linux and macOS hosts.

## clang

```sh
clang++ -O2 hello.cpp -o hello
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

and on macOS hosts `--target=aarch64-apple-darwin` and
`--target=x86_64-apple-darwin`, against Xcode's SDK (found by `xcrun`, or
given with `-isysroot`). clang's other spellings of the targets
(`x86_64-pc-linux-gnu`, `aarch64-pc-windows-gnu`, `arm64-apple-macos`, ...)
reach the same config files.

What the config files decide, so that a command does not:

- the sysroot (`--sysroot`), libc++, libunwind and compiler-rt of the
  target, linked statically;
- lld as the linker (ld64.lld for macOS targets, on macOS too;
  `-fuse-ld=ld` selects Apple's, with xclang's `libLTO.dylib`);
- macOS: deployment target 13.0, a later `-mmacos-version-min` replaces it.

`--no-default-config` drops all of it and gives the bare compiler, for
building against the system's own headers and libraries as upstream clang
would. [The toolchain's shape](../design/toolchain.md#a-config-file-per-target)
says why the choices are config files and not built in.

Build scripts written for GCC keep working: `-latomic`, `-lgcc`, `-lgcc_eh`,
`-lgcc_s` and on Windows `-lssp` find empty archives, the functions being in
compiler-rt, libunwind and mingw-w64; `-lstdc++` means libc++; `-static`
links fully static Linux programs; `windres` is `llvm-windres`
([GCC library names](../design/hermeticity.md#gcc-library-names)).
tests/smoke.ts checks each on every host.

libc++ is built with hardening mode `none`. The mode is a per-translation-unit
macro, so a debug build opts in with `-D_LIBCPP_HARDENING_MODE=...`
(tests/smoke.ts builds with `_LIBCPP_HARDENING_MODE_DEBUG`).

## Make

[examples/make](https://github.com/clice-io/xclang/tree/main/examples/make):

<!-- file: examples/make/Makefile -->
```make
# make CXX=clang++
# make CXX="clang++ --target=aarch64-unknown-linux-gnu"
hello: hello.cpp
	$(CXX) $(CXXFLAGS) -O2 hello.cpp -o $@ $(LDFLAGS)
```

```sh
make CXX=clang++
make CXX="clang++ --target=aarch64-unknown-linux-gnu"
```

The target goes into the compiler's name, so every rule that compiles or
links gets it; `AR=llvm-ar` and `RANLIB=llvm-ranlib` for a build that makes
static libraries. A configure script takes the same `CC`, `CXX` and `AR`.

## Meson

[examples/meson](https://github.com/clice-io/xclang/tree/main/examples/meson).
For the host, Meson finds the compiler by `CXX`:

```sh
CXX=clang++ meson setup build
meson compile -C build
```

For another target, a cross file names the compiler with `--target` and the
machine Meson builds for:

<!-- file: examples/meson/cross/aarch64-w64-mingw32.ini -->
```ini
[binaries]
c = ['clang', '--target=aarch64-w64-mingw32']
cpp = ['clang++', '--target=aarch64-w64-mingw32']
ar = 'llvm-ar'
strip = 'llvm-strip'
windres = ['llvm-windres', '--target=aarch64-w64-mingw32']

[host_machine]
system = 'windows'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
```

```sh
meson setup build-aarch64-w64-mingw32 --cross-file cross/aarch64-w64-mingw32.ini
meson compile -C build-aarch64-w64-mingw32
```

`cross/aarch64-unknown-linux-gnu.ini` is the same for Linux on Arm, without
`windres`, with `system = 'linux'`.

## More

- Sanitizers, and the ASan build of libc++ an ASan program links:
  [sanitizers](../features/sanitizers.md).
- `import std` by hand: [C++20 modules](../features/modules.md#by-hand).
- Debug symbols with the toolchain's dsymutil and llvm-gsymutil:
  [debugging](../features/debugging.md).
