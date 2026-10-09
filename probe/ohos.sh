#!/usr/bin/env bash
# Probe: with xclang 23.1.2.10's clang (Linux x64), against the sysroot of
# the OpenHarmony 7.0 SDK, build the compiler-rt builtins and static
# libunwind, libc++abi and libc++ for aarch64-linux-ohos; link a static and
# a dynamic C++ program.
set -euxo pipefail
T=aarch64-linux-ohos
REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$PWD/work
X=$W/xclang
OUT=$PWD/out
mkdir -p "$W" "$OUT"
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

# Only the Linux native package of the SDK tarball, streamed.
curl -fsSL https://repo.huaweicloud.com/openharmony/os/7.0-Release/ohos-sdk-windows_linux-public_20260829.tar.gz \
  | tar xz --wildcards --no-anchored '*linux/native-linux*'
Z=$(find . -name 'native-linux*.zip' | head -1)
ls -l "$Z"
unzip -q "$Z" 'native/sysroot/*' 'native/oh-uni-package.json' || unzip -q "$Z" 'native/sysroot/*'
cat native/oh-uni-package.json || true
SR=$W/native/sysroot
ls "$SR/usr/lib/$T" | head -40
du -sh "$SR/usr/include" "$SR/usr/lib/$T"

common=(
  -G Ninja
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 -DOHOS=ON
  -DCMAKE_C_COMPILER="$X/bin/clang" -DCMAKE_CXX_COMPILER="$X/bin/clang++" -DCMAKE_ASM_COMPILER="$X/bin/clang"
  -DCMAKE_C_COMPILER_TARGET="$T" -DCMAKE_CXX_COMPILER_TARGET="$T" -DCMAKE_ASM_COMPILER_TARGET="$T"
  -DCMAKE_AR="$X/bin/llvm-ar" -DCMAKE_RANLIB="$X/bin/llvm-ranlib" -DCMAKE_NM="$X/bin/llvm-nm"
  -DCMAKE_SYSROOT="$SR" -DCMAKE_LINKER_TYPE=LLD
  "-DCMAKE_C_FLAGS=--no-default-config -D__MUSL__" "-DCMAKE_CXX_FLAGS=--no-default-config -D__MUSL__" -DCMAKE_ASM_FLAGS=--no-default-config
)
RES=$("$X/bin/clang" -print-resource-dir)
cmake "${common[@]}" -S "$L/compiler-rt/lib/builtins" -B b-builtins \
  -C "$REPO/toolchain/cmake/caches/builtins.cmake" -DCOMPILER_RT_INSTALL_PATH="$RES" -DCOMPILER_RT_BUILD_CRT=ON
ninja -C b-builtins install
find "$RES/lib" -path '*ohos*' -type f
# The OHOS driver looks in lib/<multiarch> (aarch64-linux-ohos) only.
for d in "$RES"/lib/*ohos*; do [ "$d" = "$RES/lib/$T" ] || cp -r "$d/." "$RES/lib/$T/" 2>/dev/null || { mkdir -p "$RES/lib/$T"; cp -r "$d/." "$RES/lib/$T/"; }; done
ls -l "$RES/lib/$T"

P=$W/cxx
cmake "${common[@]}" -S "$L/runtimes" -B b-cxx \
  -C "$REPO/toolchain/cmake/caches/cxx.cmake" \
  -DLLVM_ENABLE_RUNTIMES="libunwind;libcxxabi;libcxx" -DLIBCXXABI_USE_LLVM_UNWINDER=ON -DLIBCXX_HAS_MUSL_LIBC=ON \
  -DLLVM_DEFAULT_TARGET_TRIPLE="$T" -DCMAKE_INSTALL_PREFIX="$P" \
  -DCMAKE_EXE_LINKER_FLAGS="--rtlib=compiler-rt --unwindlib=none -nostdlib++ -fuse-ld=lld"
ninja -C b-cxx install

cat > hello.cpp <<'CPP'
#include <atomic>
#include <format>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
thread_local int tls = 41;
int main() {
  std::atomic<long> n{0};
  std::vector<std::thread> ts;
  for (int i = 0; i < 4; ++i) ts.emplace_back([&] { tls += 1; for (int j = 0; j < 1000; ++j) n += 1; });
  for (auto& t : ts) t.join();
  try { throw std::runtime_error("caught"); }
  catch (const std::exception& e) { std::cout << std::format("ohos c++ ok {} n={} tls={}", e.what(), n.load(), tls + 1) << std::endl; }
  return n == 4000 ? 0 : 1;
}
CPP
flags=(--target="$T" --no-default-config --sysroot="$SR" -D__MUSL__ -rtlib=compiler-rt -fuse-ld=lld -O2
  -nostdinc++ -isystem "$P/include/c++/v1" -nostdlib++ -L"$P/lib")
"$X/bin/clang++" "${flags[@]}" -std=c++23 -static hello.cpp "$P/lib/libc++.a" "$P/lib/libunwind.a" -o "$OUT/hello-static" \
  || echo "::warning::static OHOS link fails"
"$X/bin/clang++" "${flags[@]}" -std=c++23 hello.cpp "$P/lib/libc++.a" "$P/lib/libunwind.a" -o "$OUT/hello-dynamic" \
  || echo "::warning::dynamic OHOS link fails"
for f in "$OUT"/*; do "$X/bin/llvm-readelf" -l -d "$f" | grep -E "interpreter|NEEDED" || true; done
tar -C "$P" -cf - . | xz -T0 -9 | wc -c | awk '{printf "::notice::OHOS aarch64 libc++, libc++abi, libunwind %.2f MB xz\n", $1/1e6}'
tar -C "$SR/usr" -cf - include "lib/$T" | xz -T0 -9 | wc -c | awk '{printf "::notice::OHOS sysroot (headers + aarch64) %.1f MB xz\n", $1/1e6}'
