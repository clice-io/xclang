#!/bin/bash
# exp only: how xclang's clang links bitcode archives and sanitizer runtimes
# on macOS when it runs by a relative path, as under Bazel.
set -x
curl -sL -o x.tar.xz https://github.com/clice-io/xclang/releases/download/23.1.2.4/xclang-23.1.2.4-aarch64-apple-darwin.tar.xz
mkdir -p ws/external && tar -C ws/external -xf x.tar.xz && cd ws
ls -la external/xclang/lib | head
X=external/xclang/bin
echo 'int f(void){return 1;}' > a.c
echo 'int f(void); int main(void){return f()-1;}' > m.c
$X/clang -flto=thin -c a.c -o a.o
$X/clang -c m.c -o m.o
$X/llvm-ar rcs liba.a a.o
$X/clang -no-canonical-prefixes -### m.o liba.a -o m 2>&1 | tail -2
$X/clang -no-canonical-prefixes -v m.o liba.a -o m && ./m && echo relative-ok
$X/clang -### m.o liba.a -o m 2>&1 | tail -2
$X/clang m.o liba.a -o m && ./m && echo absolute-ok
$X/clang -no-canonical-prefixes -Wl,-lto_library,external/xclang/lib/libLTO.dylib m.o liba.a -o m && ./m && echo explicit-relative-ok
$X/clang -no-canonical-prefixes -Wl,-lto_library,$PWD/external/xclang/lib/libLTO.dylib m.o liba.a -o m && ./m && echo explicit-absolute-ok
$X/clang -no-canonical-prefixes -mlinker-version=1200 -### m.o liba.a -o m 2>&1 | tail -1
$X/clang -no-canonical-prefixes -mlinker-version=1200 m.o liba.a -o m && ./m && echo version-ok
ld -v 2>&1 | head -2
$X/clang --version
$X/clang -no-canonical-prefixes -resource-dir=external/xclang/lib/clang/23 -fsanitize=address -### m.c -o m 2>&1 | tail -1
