#!/usr/bin/env bash
# Probe: with xclang 23.1.2.10's clang (Linux x64), against the sysroot of
# NDK r30, build the compiler-rt builtins and static libunwind, libc++abi
# and libc++ (in the NDK's __ndk1 namespace) for one Android ABI; link C
# and C++ programs with them, and a C++ program with the NDK's own
# libc++_static. Nothing of the NDK leaves the job but the programs.
#
#   probe/android.sh <arch>-linux-android<api>
set -euxo pipefail
T=$1
REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$PWD/work
X=$W/xclang
OUT=$PWD/out
mkdir -p "$W" "$OUT"
cd "$W"

if [ ! -x "$X/bin/clang" ]; then
  curl -fsSL -o xclang.tar.xz https://github.com/clice-io/xclang/releases/download/23.1.2.10/xclang-23.1.2.10-x86_64-unknown-linux-gnu.tar.xz
  tar xf xclang.tar.xz && rm xclang.tar.xz
fi
L=$W/llvm-project-23.1.2.src
if [ ! -d "$L/runtimes" ]; then
  curl -fsSL -o llvm.tar.xz https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.2/llvm-project-23.1.2.src.tar.xz
  tar xf llvm.tar.xz --wildcards \
    'llvm-project-23.1.2.src/cmake/*' 'llvm-project-23.1.2.src/runtimes/*' \
    'llvm-project-23.1.2.src/libcxx/*' 'llvm-project-23.1.2.src/libcxxabi/*' \
    'llvm-project-23.1.2.src/libunwind/*' 'llvm-project-23.1.2.src/compiler-rt/*' \
    'llvm-project-23.1.2.src/llvm/cmake/*' 'llvm-project-23.1.2.src/llvm/utils/*' \
    'llvm-project-23.1.2.src/third-party/*' 'llvm-project-23.1.2.src/libc/*'
  rm llvm.tar.xz
fi
NDK=$W/android-ndk-r30
if [ ! -d "$NDK" ]; then
  curl -fsSL -o ndk.zip https://dl.google.com/android/repository/android-ndk-r30-linux.zip
  unzip -q ndk.zip 'android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/sysroot/*' 'android-ndk-r30/source.properties'
  rm ndk.zip
  cat "$NDK/source.properties"
fi
SR=$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot
arch=${T%%-*}
case $arch in armv7a) gnu=arm-linux-androideabi ;; *) gnu=$arch-linux-android ;; esac
ls "$SR/usr/lib/"
du -sh "$SR/usr/include" "$SR/usr/lib"/* || true

common=(
  -G Ninja
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR="$arch"
  -DCMAKE_C_COMPILER="$X/bin/clang" -DCMAKE_CXX_COMPILER="$X/bin/clang++" -DCMAKE_ASM_COMPILER="$X/bin/clang"
  -DCMAKE_C_COMPILER_TARGET="$T" -DCMAKE_CXX_COMPILER_TARGET="$T" -DCMAKE_ASM_COMPILER_TARGET="$T"
  -DCMAKE_AR="$X/bin/llvm-ar" -DCMAKE_RANLIB="$X/bin/llvm-ranlib" -DCMAKE_NM="$X/bin/llvm-nm"
  -DCMAKE_SYSROOT="$SR" -DCMAKE_LINKER_TYPE=LLD
  -DCMAKE_C_FLAGS=--no-default-config -DCMAKE_CXX_FLAGS=--no-default-config -DCMAKE_ASM_FLAGS=--no-default-config
)
RES=$("$X/bin/clang" -print-resource-dir)

rm -rf b-builtins
cmake "${common[@]}" -S "$L/compiler-rt/lib/builtins" -B b-builtins \
  -C "$REPO/toolchain/cmake/caches/builtins.cmake" \
  -DCOMPILER_RT_INSTALL_PATH="$RES" -DCOMPILER_RT_BUILD_CRT=OFF
ninja -C b-builtins install
find "$RES/lib" -path "*android*" -type f | head

P=$W/cxx-$T
rm -rf b-cxx "$P"
cmake "${common[@]}" -S "$L/runtimes" -B b-cxx \
  -C "$REPO/toolchain/cmake/caches/cxx.cmake" \
  -DLLVM_ENABLE_RUNTIMES="libunwind;libcxxabi;libcxx" \
  -DLIBCXXABI_USE_LLVM_UNWINDER=ON -DLIBCXX_ABI_VERSION=1 -DLIBCXX_ABI_NAMESPACE=__ndk1 \
  -DLLVM_DEFAULT_TARGET_TRIPLE="$T" -DCMAKE_INSTALL_PREFIX="$P" \
  -DCMAKE_EXE_LINKER_FLAGS="--rtlib=compiler-rt --unwindlib=none -nostdlib++ -fuse-ld=lld"
ninja -C b-cxx install
ls -l "$P/lib"

cat > hello.c <<'EOF'
#include <stdio.h>
#include <sys/system_properties.h>
int main(void) {
  char v[PROP_VALUE_MAX] = "?";
  __system_property_get("ro.build.version.sdk", v);
  printf("c ok, API %s\n", v);
  return 0;
}
EOF
cat > hello.cpp <<'EOF'
#include <atomic>
#include <format>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
int main() {
  std::atomic<long long> n{0};
  std::vector<std::thread> ts;
  for (int i = 0; i < 4; ++i) ts.emplace_back([&] { for (int j = 0; j < 1000; ++j) n += 1; });
  for (auto& t : ts) t.join();
  try { throw std::runtime_error("caught"); }
  catch (const std::exception& e) { std::cout << std::format("c++ ok {} n={}", e.what(), n.load()) << std::endl; }
  return n == 4000 ? 0 : 1;
}
EOF
flags=(--target="$T" --no-default-config --sysroot="$SR" -rtlib=compiler-rt -fuse-ld=lld -O2)
"$X/bin/clang" "${flags[@]}" hello.c -o "$OUT/c-$T"
"$X/bin/clang++" "${flags[@]}" -std=c++23 -nostdinc++ -isystem "$P/include/c++/v1" \
  -nostdlib++ hello.cpp "$P/lib/libc++.a" "$P/lib/libunwind.a" -o "$OUT/cxx-xclang-$T"
"$X/bin/clang++" "${flags[@]}" -std=c++23 -static-libstdc++ hello.cpp -o "$OUT/cxx-ndk-$T" \
  || echo "::warning::$T: the NDK's libc++_static does not link with xclang's clang"
for f in "$OUT"/*-"$T"; do "$X/bin/llvm-readelf" -d "$f" | grep -E "NEEDED|RUNPATH" || true; done
ls -l "$OUT"
tar -C "$P" -cf - . | xz -T0 -9 | wc -c | awk -v t="$T" '{printf "::notice::%s libc++, libc++abi, libunwind %.2f MB xz\n", t, $1/1e6}'
tar -C "$SR/usr" -cf - include "lib/$gnu" 2>/dev/null | xz -T0 -9 | wc -c | awk -v t="$T" '{printf "::notice::%s NDK sysroot (headers + this ABI) %.1f MB xz\n", t, $1/1e6}' || true
