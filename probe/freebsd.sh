#!/usr/bin/env bash
# Probe: with xclang 23.1.2.10's clang (Linux x64), against FreeBSD 14.0's
# base.txz (usr/include without c++/v1, usr/lib, lib), build static
# libunwind, libc++abi and libc++ for x86_64-unknown-freebsd14 and link a
# C++ program with them.
set -euxo pipefail
T=x86_64-unknown-freebsd14
REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$PWD/work
X=$W/xclang
OUT=$PWD/out
SR=$W/sysroot
mkdir -p "$W" "$OUT" "$SR"
cd "$W"
curl -fsSL -o xclang.tar.xz https://github.com/clice-io/xclang/releases/download/23.1.2.10/xclang-23.1.2.10-x86_64-unknown-linux-gnu.tar.xz
tar xf xclang.tar.xz && rm xclang.tar.xz
curl -fsSL -o llvm.tar.xz https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.2/llvm-project-23.1.2.src.tar.xz
tar xf llvm.tar.xz --wildcards \
  'llvm-project-23.1.2.src/cmake/*' 'llvm-project-23.1.2.src/runtimes/*' \
  'llvm-project-23.1.2.src/libcxx/*' 'llvm-project-23.1.2.src/libcxxabi/*' \
  'llvm-project-23.1.2.src/libunwind/*' 'llvm-project-23.1.2.src/compiler-rt/*' \
  'llvm-project-23.1.2.src/llvm/cmake/*' 'llvm-project-23.1.2.src/llvm/utils/*' \
  'llvm-project-23.1.2.src/third-party/*' 'llvm-project-23.1.2.src/libc/*'
rm llvm.tar.xz
L=$W/llvm-project-23.1.2.src
curl -fsSL http://ftp-archive.freebsd.org/pub/FreeBSD-Archive/old-releases/amd64/14.0-RELEASE/base.txz \
  | tar xJ -C "$SR" ./usr/include ./usr/lib ./lib
rm -rf "$SR/usr/include/c++" "$SR"/usr/lib/libc++* "$SR"/usr/lib/libcxxrt* "$SR"/lib/libcxxrt* "$SR"/usr/lib/debug
du -sh "$SR"

common=(
  -G Ninja
  -DCMAKE_SYSTEM_NAME=FreeBSD -DCMAKE_SYSTEM_PROCESSOR=x86_64
  -DCMAKE_C_COMPILER="$X/bin/clang" -DCMAKE_CXX_COMPILER="$X/bin/clang++" -DCMAKE_ASM_COMPILER="$X/bin/clang"
  -DCMAKE_C_COMPILER_TARGET="$T" -DCMAKE_CXX_COMPILER_TARGET="$T" -DCMAKE_ASM_COMPILER_TARGET="$T"
  -DCMAKE_AR="$X/bin/llvm-ar" -DCMAKE_RANLIB="$X/bin/llvm-ranlib" -DCMAKE_NM="$X/bin/llvm-nm"
  -DCMAKE_SYSROOT="$SR" -DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld=lld
  -DCMAKE_C_FLAGS=--no-default-config -DCMAKE_CXX_FLAGS=--no-default-config -DCMAKE_ASM_FLAGS=--no-default-config
)
P=$W/cxx
cmake "${common[@]}" -S "$L/runtimes" -B b-cxx \
  -C "$REPO/toolchain/cmake/caches/cxx.cmake" \
  -DLLVM_ENABLE_RUNTIMES="libunwind;libcxxabi;libcxx" -DLIBCXXABI_USE_LLVM_UNWINDER=ON \
  -DLLVM_DEFAULT_TARGET_TRIPLE="$T" -DCMAKE_INSTALL_PREFIX="$P" \
  -DCMAKE_EXE_LINKER_FLAGS="-nostdlib++ -fuse-ld=lld"
ninja -C b-cxx install

cat > hello.cpp <<'CPP'
#include <atomic>
#include <format>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
int main() {
  std::atomic<long> n{0};
  std::vector<std::thread> ts;
  for (int i = 0; i < 4; ++i) ts.emplace_back([&] { for (int j = 0; j < 1000; ++j) n += 1; });
  for (auto& t : ts) t.join();
  try { throw std::runtime_error("caught"); }
  catch (const std::exception& e) { std::cout << std::format("freebsd c++ ok {} n={}", e.what(), n.load()) << std::endl; }
  return n == 4000 ? 0 : 1;
}
CPP
"$X/bin/clang++" --target="$T" --no-default-config --sysroot="$SR" -fuse-ld=lld -O2 -std=c++23 \
  -nostdinc++ -isystem "$P/include/c++/v1" -nostdlib++ hello.cpp "$P/lib/libc++.a" "$P/lib/libunwind.a" -pthread \
  -o "$OUT/hello-freebsd"
"$X/bin/llvm-readelf" -l -d "$OUT/hello-freebsd" | grep -E "interpreter|NEEDED"
tar -C "$P" -cf - . | xz -T0 -9 | wc -c | awk '{printf "::notice::FreeBSD x86_64 libc++, libc++abi, libunwind %.2f MB xz\n", $1/1e6}'
