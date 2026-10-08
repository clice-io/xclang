# Xmake

Xmake can use xclang through its existing `llvm` toolchain. Install Xmake
and unpack xclang for your host ([installation](../guide/install.md)).
`--sdk` below names the unpacked xclang root, whose `bin/` holds `clang`
and `clang++`; replace `/path/to/xclang` with that directory. Quote paths
containing spaces. On Windows, a path such as `C:/tools/xclang` works.

The [quick-start example](https://github.com/clice-io/xclang/tree/main/examples/quickstart)
uses C++20 and exercises standard-library output and exceptions:

<!-- file: examples/quickstart/xmake.lua -->
```lua
set_languages("c++20")

target("hello")
    set_kind("binary")
    add_files("hello.cpp")
```

## Build for Windows and Linux

Run from the repository checkout. These commands select Windows x64 with
the bundled MinGW sysroot, then build the `hello` target:

<!-- not run: manual commands use the reader's local xclang installation path -->
```sh
cd examples/quickstart
xmake f -c -y -p mingw -a x86_64 --toolchain=llvm --sdk=/path/to/xclang
xmake
```

For another bundled target, configure again and rebuild. `-c` clears the
previous configuration so the selected platform and architecture take
effect. No separate GCC or MinGW installation is required; xclang's target
configuration selects the sysroot, linker and static C++ runtime.

<!-- not run: manual commands use the reader's local xclang installation path -->
```sh
xmake f -c -y -p mingw -a arm64 --toolchain=llvm --sdk=/path/to/xclang
xmake
xmake f -c -y -p linux -a x86_64 --toolchain=llvm --sdk=/path/to/xclang
xmake
xmake f -c -y -p linux -a arm64 --toolchain=llvm --sdk=/path/to/xclang
xmake
```

Run `xmake run hello` when the selected target matches your machine.
Cross-built programs need a matching target machine or emulator. The
[CI workflow](https://github.com/clice-io/xclang/blob/main/.github/workflows/test-xmake.yml)
contains the automated checks for this integration.

Use `-p mingw` for xclang's bundled Windows GNU ABI. Xmake's `windows`
platform selects the MSVC ABI instead. Microsoft's SDK and Apple's SDK
are user-provided: fetch or install them separately before using targets
that require them ([vendor SDKs](../design/vendor-sdks.md)).

## Dedicated Toolchain Status

A dedicated `--toolchain=xclang` integration is proposed in
[Xmake PR #7841](https://github.com/xmake-io/xmake/pull/7841) and is awaiting
upstream merge. It is not yet available in stable Xmake releases. Keep
using `--toolchain=llvm` unless your Xmake includes that change.
