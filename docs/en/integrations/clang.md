# Plain Clang, Make and Meson

Any build that runs a compiler by name works with xclang. Put xclang's
`bin/` first in `PATH`, as `pixi shell` does, or name the programs by their
path, and add `--target` for another target.

Requires: xclang's `bin/` in `PATH` ([installation](../guide/install.md)).

## Clang

These are the commands of the [quick start](../guide/quick-start.md), for
its `hello.cpp`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 hello.cpp -o hello
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

On macOS hosts, `--target=aarch64-apple-darwin` and
`--target=x86_64-apple-darwin` build against Xcode's SDK, found by `xcrun`
or given with `-isysroot`. clang's other spellings of the targets, such as
`x86_64-pc-linux-gnu` or `arm64-apple-macos`, reach the same config files.

The config file of each target decides what a command does not have to.
It names the sysroot, the static libc++, libunwind and compiler-rt, lld as
the linker, and for macOS the deployment target 13.0
([config files](../design/toolchain.md#a-config-file-per-target)).
`--no-default-config` gives the bare compiler, which builds against the
system's own headers and libraries.

Build scripts written for GCC keep working. `-latomic`, `-lgcc`,
`-lgcc_eh`, `-lgcc_s` and on Windows `-lssp` find empty archives;
`-lstdc++` means libc++; `windres` is `llvm-windres`
([GCC library names](../design/hermeticity.md#gcc-library-names)).

## Make

The target goes into the name of the compiler, so every rule that compiles
or links gets it. The project is
[examples/make](https://github.com/clice-io/xclang/tree/main/examples/make):

<!-- file: examples/make/Makefile -->
```make
# make CXX=clang++
# make -B CXX="clang++ --target=aarch64-unknown-linux-gnu"
hello: hello.cpp
	$(CXX) $(CXXFLAGS) -O2 hello.cpp -o $@ $(LDFLAGS)
```

<!-- excerpt: .github/workflows/examples.yml -->
```sh
make CXX=clang++
./hello
```

For another target, `-B` rebuilds `hello`, which make would otherwise
take as up to date:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
make -B CXX="clang++ --target=aarch64-unknown-linux-gnu"
```

A build that makes static libraries also takes `AR=llvm-ar` and
`RANLIB=llvm-ranlib`. A configure script takes the same `CC`, `CXX` and
`AR`.

## Meson

The project is
[examples/meson](https://github.com/clice-io/xclang/tree/main/examples/meson).
For the host, Meson finds the compiler through `CXX`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
CXX=clang++ meson setup build
meson compile -C build
./build/hello
```

For another target, a cross file names the compiler with `--target`, and
the machine Meson builds for:

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

<!-- excerpt: .github/workflows/examples.yml -->
```sh
meson setup build-aarch64-w64-mingw32 --cross-file cross/aarch64-w64-mingw32.ini
meson compile -C build-aarch64-w64-mingw32
```

`cross/aarch64-unknown-linux-gnu.ini` is the same for Linux on Arm, with
`system = 'linux'` and without `windres`.

## Turn On libc++ Hardening

libc++ is built with the hardening mode `none`. The mode is a macro of each
translation unit, so a build opts in on its own command line. A debug build,
for example, passes `-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG`.

## See Also

- [Sanitizers](../features/sanitizers.md#plain-clang), and the ASan libc++
  an ASan program links.
- [C++20 modules by hand](../features/modules.md#plain-clang).
- [Debug symbols](../features/debugging.md#plain-clang) with the
  toolchain's dsymutil and llvm-gsymutil.
