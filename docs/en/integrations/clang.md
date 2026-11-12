# Plain Clang, Make and Meson

Any build tool that invokes a compiler by name works with xclang. Put xclang's `bin/` first in `PATH` (as `pixi shell` does) or invoke the binaries by path, and pass `--target=<triple>` to build for another target.

Requires: xclang's `bin/` in `PATH` ([Install](../guide/quick-start.md)).

## Clang

Run `clang` or `clang++` for the host, or add `--target=<triple>` for another target. These are the commands from the [quick start](../guide/quick-start.md) for `hello.cpp`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 hello.cpp -o hello
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

Each target has a config file (`bin/<triple>.cfg`) that selects its sysroot or SDK, links `libc++`, `libunwind` and `compiler-rt` statically, uses `lld`, and sets the OS floor ([Cross-Compiling](../guide/cross-compiling.md#how-clang-finds-a-target-s-files), [Toolchain Design](../design/toolchain.md)). Clang's alternate target spellings, such as `x86_64-pc-linux-gnu` or `arm64-apple-macos`, load the same config files.

- **musl targets**: `--target=x86_64-unknown-linux-musl` and `--target=aarch64-unknown-linux-musl` build static Linux binaries ([musl targets](../guide/cross-compiling.md#musl-targets)).
- **macOS targets**: `--target=aarch64-apple-darwin` and `--target=x86_64-apple-darwin` build against Xcode's SDK on macOS hosts, and against the SDK fetched by `xclang sdk fetch macos --accept-license` on Linux and Windows hosts ([macOS](../guide/cross-compiling.md#macos)).


- **MSVC targets**: `--target=x86_64-pc-windows-msvc`, `--target=aarch64-pc-windows-msvc` and `clang-cl` build against the Windows SDK fetched by `xclang sdk fetch windows --accept-license`, or an installed Visual Studio on Windows hosts ([MSVC targets](../guide/cross-compiling.md#msvc-targets)).


- **The platform's C++ library**: `-stdlib=platform` (or `/clang:-stdlib=platform` with `clang-cl`) selects `<triple>-system.cfg` and builds against the target's system C++ library: `libstdc++` on Linux and MinGW, Microsoft's STL on MSVC, or `/usr/lib/libc++.1.dylib` on macOS ([the platform's C++ library](../guide/cross-compiling.md#the-platform-s-c-library)). `--no-default-config` disables xclang's config files altogether.
- **GCC compatibility**: Build scripts written for GCC work without changes. `-latomic`, `-lgcc`, `-lgcc_eh`, `-lgcc_s` and (on Windows) `-lssp` resolve to empty stub archives, `-lstdc++` links `libc++`, and `windres` invokes `llvm-windres` ([GCC library names](../design/hermeticity.md#gcc-library-names), [Hermeticity](../design/hermeticity.md)).

## Make

Include `--target=<triple>` in `CC` and `CXX` so every compile and link rule receives it. The project is [examples/make](https://github.com/clice-io/xclang/tree/main/examples/make):

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

Pass `-B` when switching targets so `make` rebuilds targets that are already present on disk:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
make -B CXX="clang++ --target=aarch64-unknown-linux-gnu"
```

When a build creates static archives, also pass `AR=llvm-ar` and `RANLIB=llvm-ranlib`. Autotools `configure` scripts accept the same `CC`, `CXX`, `AR` and `RANLIB` variables.

## Meson

Set `CC=clang` and `CXX=clang++` (or list `clang`, `clang++`, `llvm-ar` and `llvm-strip` under `[binaries]` in a `--native-file`) to configure Meson for the host. The project is [examples/meson](https://github.com/clice-io/xclang/tree/main/examples/meson):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
CXX=clang++ meson setup build
meson compile -C build
./build/hello
```

For another target, pass a `--cross-file` that sets `--target=<triple>` in `[binaries]` and describes the target in `[host_machine]`:

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

`cross/aarch64-unknown-linux-gnu.ini` in the same directory configures Linux on Arm64 with `system = 'linux'` and without `windres`.

## Turn On libc++ Hardening

The prebuilt `libc++` archive is compiled with hardening mode `none`. Because hardening checks in headers are controlled per translation unit, pass `-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST` (or `_EXTENSIVE` or `_DEBUG`) on the compiler command line to turn them on. To enable hardening assertions inside the compiled `libc++` library as well, build the runtimes from source in CMake or Bazel ([Runtimes from Source](../features/runtimes-from-source.md)).

## Features

- **C++20 modules and `import std`**: Precompile `std.cppm` and your module interfaces with `--precompile` ([C++20 Modules](../features/modules.md#plain-clang)).
- **Sanitizers**: Pass `-fsanitize=...`, and add `-L$XCLANG/<target>/lib/asan` on Linux, MinGW and macOS when linking with AddressSanitizer ([Sanitizers](../features/sanitizers.md#plain-clang)).
- **Debug symbols**: Run `dsymutil` and `llvm-gsymutil` from the toolchain's `bin/` to extract `.dSYM` and `.gsym` files ([Debugging](../features/debugging.md#plain-clang)).
- **libclang and the ThinLTO cache**: Link the archives from `libclang-<version>-<target>.tar.xz` with the ThinLTO cache flag for your target's linker ([libclang](../features/libclang.md#plain-clang), [the ThinLTO cache](../features/libclang.md#the-thinlto-cache)).
