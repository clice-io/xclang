# 直接使用 Clang、Make 与 Meson

任何按名称调用编译器的构建工具都可以配合 xclang 使用。将 xclang 的 `bin/` 排在 `PATH` 最前面（`pixi shell` 会自动这样设置），或按路径调用这些可执行文件，并传入 `--target=<triple>` 即可构建其他目标平台。

要求：xclang 的 `bin/` 已加入 `PATH`（[安装](../guide/quick-start.md)）。

## Clang

直接运行 `clang` 或 `clang++` 可为主机构建，加上 `--target=<triple>` 则可构建其他目标平台。以下是[快速开始](../guide/quick-start.md)中编译 `hello.cpp` 的命令：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 hello.cpp -o hello
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello-windows-x64.exe
clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

每个目标平台都有对应的配置文件（`bin/<triple>.cfg`），用于选取其 sysroot 或 SDK，静态链接 `libc++`、`libunwind` 与 `compiler-rt`，使用 `lld`，并设置最低操作系统版本（[交叉编译](../guide/cross-compiling.md#how-clang-finds-a-target-s-files)、[工具链结构](../design/toolchain.md)）。Clang 支持的目标平台其他写法（如 `x86_64-pc-linux-gnu` 或 `arm64-apple-macos`）也会加载同一组配置文件。

- **musl 目标平台**：`--target=x86_64-unknown-linux-musl` 与 `--target=aarch64-unknown-linux-musl` 会构建静态链接的 Linux 二进制文件（[musl 目标平台](../guide/cross-compiling.md#musl-targets)）。
- **macOS 目标平台**：`--target=aarch64-apple-darwin` 与 `--target=x86_64-apple-darwin` 在 macOS 主机上基于 Xcode 的 SDK 构建，在 Linux 与 Windows 主机上则基于 `xclang sdk fetch macos --accept-license` 下载的 SDK 构建（[macOS](../guide/cross-compiling.md#macos)）。
- **MSVC 目标平台**：`--target=x86_64-pc-windows-msvc`、`--target=aarch64-pc-windows-msvc` 与 `clang-cl` 基于 `xclang sdk fetch windows --accept-license` 下载的 Windows SDK 构建，在 Windows 主机上也可使用本机安装的 Visual Studio（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)）。
- **平台的 C++ 标准库**：传入 `-stdlib=platform`（或 `/clang:-stdlib=platform`，配合 `clang-cl` 时）会选用 `<triple>-system.cfg`，并基于目标平台的系统 C++ 标准库构建：Linux 与 MinGW 上为 `libstdc++`，MSVC 上为微软的 STL，macOS 上为 `/usr/lib/libc++.1.dylib`（[平台的 C++ 标准库](../guide/cross-compiling.md#the-platform-s-c-library)）。传入 `--no-default-config` 则会完全停用 xclang 的配置文件。
- **GCC 兼容**：面向 GCC 编写的构建脚本无需修改即可工作。`-latomic`、`-lgcc`、`-lgcc_eh`、`-lgcc_s` 以及（Windows 上的）`-lssp` 会解析为空桩静态库，`-lstdc++` 会链接 `libc++`，而 `windres` 会调用 `llvm-windres`（[GCC 库名兼容](../design/hermeticity.md#gcc-library-names)、[封闭性](../design/hermeticity.md)）。

## Make

将 `--target=<triple>` 包含在 `CC` 与 `CXX` 中，使每条编译与链接规则都能接收到它。示例项目位于 [examples/make](https://github.com/clice-io/xclang/tree/main/examples/make)：

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

切换目标平台时请传入 `-B`，让 `make` 重新构建磁盘上已有的目标：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
make -B CXX="clang++ --target=aarch64-unknown-linux-gnu"
```

如果构建需要打包静态库，请同时传入 `AR=llvm-ar` 与 `RANLIB=llvm-ranlib`。Autotools 的 `configure` 脚本也接受相同的 `CC`、`CXX`、`AR` 与 `RANLIB` 变量。

## Meson

设置 `CC=clang` 与 `CXX=clang++`（或将 `clang`、`clang++`、`llvm-ar` 与 `llvm-strip` 写入 `[binaries]` 并通过 `--native-file` 传入），即可为主机配置 Meson。示例项目位于 [examples/meson](https://github.com/clice-io/xclang/tree/main/examples/meson)：

<!-- excerpt: .github/workflows/examples.yml -->
```sh
CXX=clang++ meson setup build
meson compile -C build
./build/hello
```

构建其他目标平台时，传入一个 `--cross-file`，在其中设置 `--target=<triple>`（位于 `[binaries]` 节）并在 `[host_machine]` 节中描述目标平台：

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

同目录下的 `cross/aarch64-unknown-linux-gnu.ini` 使用 `system = 'linux'` 且不设 `windres`，用于配置 Arm64 Linux。

## 启用 libc++ 加固模式

预编译的 `libc++` 静态库按 `none` 加固模式编译。由于头文件中的加固检查按翻译单元独立控制，在编译器命令行传入 `-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST`（或 `_EXTENSIVE`、`_DEBUG`）即可启用这些检查。如需同时在编译出的 `libc++` 库代码内部启用加固断言，请在 CMake 或 Bazel 中从源码构建运行时库（[从源码构建运行时库](../features/runtimes-from-source.md)）。

## 功能

- **C++20 模块与 `import std`**：使用 `std.cppm` 与项目自身的模块接口配合 `--precompile` 预编译模块（[C++20 模块](../features/modules.md#plain-clang)）。
- **Sanitizer**：传入 `-fsanitize=...`，并在 Linux、MinGW 与 macOS 上使用 AddressSanitizer 链接时加上 `-L$XCLANG/<target>/lib/asan`（[Sanitizer](../features/sanitizers.md#plain-clang)）。
- **调试符号**：运行 `dsymutil` 与 `llvm-gsymutil`（位于工具链的 `bin/` 下）提取 `.dSYM` 与 `.gsym` 文件（[调试](../features/debugging.md#plain-clang)）。
- **libclang 与 ThinLTO 缓存**：链接 `libclang-<version>-<target>.tar.xz` 中的静态库，并传入目标平台链接器对应的 ThinLTO 缓存参数（[libclang](../features/libclang.md#plain-clang)、[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)）。
