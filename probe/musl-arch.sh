#!/usr/bin/env bash
# Probe: with xclang 23.1.2.10's clang (Linux x64), build musl 1.2.6, the
# compiler-rt builtins and crt objects, and static libunwind, libc++abi and
# libc++ for one target, as toolchain/runtimes.ts does for the shipped
# ones; then link a static C++ program (threads, exceptions, std::format)
# and a C program with the profile runtime.
#
#   probe/musl-arch.sh <triple> <kernel ARCH>
set -euxo pipefail
T=$1
KARCH=$2
REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$PWD/work
X=$W/xclang
SR=$W/sysroot-$T
OUT=$PWD/out
mkdir -p "$W" "$SR" "$OUT"
cd "$W"

start=$SECONDS
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
echo "::notice::$T downloads $((SECONDS - start)) s"

# The kernel's UAPI headers.
if [ ! -d linux-6.18 ]; then
  curl -fsSL https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.tar.xz | tar xJ
fi
make -s -C linux-6.18 ARCH="$KARCH" INSTALL_HDR_PATH="$SR/usr" headers_install

# musl.
step=$SECONDS
rm -rf musl-1.2.6
curl -fsSL https://musl.libc.org/releases/musl-1.2.6.tar.gz | tar xz
(cd musl-1.2.6 && ./configure --target="$T" --prefix=/usr --disable-shared --disable-wrapper \
  CC="$X/bin/clang --target=$T --no-default-config" AR="$X/bin/llvm-ar" RANLIB="$X/bin/llvm-ranlib" \
  CFLAGS="-funwind-tables -fasynchronous-unwind-tables" \
  && make -j"$(nproc)" && make install-libs install-headers DESTDIR="$SR")
echo "::notice::$T musl $((SECONDS - step)) s"

common=(
  -G Ninja
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR="${T%%-*}"
  -DCMAKE_C_COMPILER="$X/bin/clang" -DCMAKE_CXX_COMPILER="$X/bin/clang++" -DCMAKE_ASM_COMPILER="$X/bin/clang"
  -DCMAKE_C_COMPILER_TARGET="$T" -DCMAKE_CXX_COMPILER_TARGET="$T" -DCMAKE_ASM_COMPILER_TARGET="$T"
  -DCMAKE_AR="$X/bin/llvm-ar" -DCMAKE_RANLIB="$X/bin/llvm-ranlib" -DCMAKE_NM="$X/bin/llvm-nm"
  -DCMAKE_SYSROOT="$SR" -DCMAKE_LINKER_TYPE=LLD
  -DCMAKE_C_FLAGS=--no-default-config -DCMAKE_CXX_FLAGS=--no-default-config -DCMAKE_ASM_FLAGS=--no-default-config
)
RES=$("$X/bin/clang" -print-resource-dir)

# compiler-rt builtins and crt objects.
step=$SECONDS
rm -rf b-builtins
cmake "${common[@]}" -S "$L/compiler-rt/lib/builtins" -B b-builtins \
  -C "$REPO/toolchain/cmake/caches/builtins.cmake" \
  -DCOMPILER_RT_INSTALL_PATH="$RES" -DCOMPILER_RT_BUILD_CRT=ON
ninja -C b-builtins install
echo "::notice::$T builtins $((SECONDS - step)) s"

# libunwind, libc++abi, libc++.
step=$SECONDS
rm -rf b-cxx
cmake "${common[@]}" -S "$L/runtimes" -B b-cxx \
  -C "$REPO/toolchain/cmake/caches/cxx.cmake" \
  -DLLVM_ENABLE_RUNTIMES="libunwind;libcxxabi;libcxx" \
  -DLIBCXXABI_USE_LLVM_UNWINDER=ON -DLIBCXX_HAS_MUSL_LIBC=ON \
  -DLLVM_DEFAULT_TARGET_TRIPLE="$T" -DCMAKE_INSTALL_PREFIX="$SR/usr" \
  -DCMAKE_EXE_LINKER_FLAGS="--rtlib=compiler-rt --unwindlib=none -nostdlib++ -static -fuse-ld=lld"
ninja -C b-cxx install
echo "::notice::$T libc++ $((SECONDS - step)) s"

# The profile runtime and UBSan's minimal runtime, only those targets.
# musl 1.2.4 and later declare stat64 and the other LFS64 names only with
# _LARGEFILE64_SOURCE, which sanitizer_common needs on 32-bit targets.
step=$SECONDS
rm -rf b-crt
cmake "${common[@]}" -S "$L/compiler-rt" -B b-crt \
  -DCMAKE_C_FLAGS="--no-default-config -D_LARGEFILE64_SOURCE" -DCMAKE_CXX_FLAGS="--no-default-config -D_LARGEFILE64_SOURCE" \
  -DCMAKE_BUILD_TYPE=Release -DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=ON \
  -DCOMPILER_RT_INSTALL_PATH="$RES" \
  -DCOMPILER_RT_BUILD_BUILTINS=OFF -DCOMPILER_RT_BUILD_CRT=OFF -DCOMPILER_RT_BUILD_PROFILE=ON \
  -DCOMPILER_RT_BUILD_SANITIZERS=ON -DCOMPILER_RT_SANITIZERS_TO_BUILD=ubsan_minimal \
  -DCOMPILER_RT_BUILD_LIBFUZZER=OFF -DCOMPILER_RT_BUILD_XRAY=OFF -DCOMPILER_RT_BUILD_MEMPROF=OFF \
  -DCOMPILER_RT_BUILD_ORC=OFF -DCOMPILER_RT_BUILD_GWP_ASAN=OFF -DCOMPILER_RT_BUILD_CTX_PROFILE=OFF \
  -DCOMPILER_RT_USE_BUILTINS_LIBRARY=ON -DSANITIZER_CXX_ABI=libc++ -DSANITIZER_USE_STATIC_CXX_ABI=ON \
  -DCMAKE_EXE_LINKER_FLAGS="--rtlib=compiler-rt --unwindlib=libunwind -stdlib=libc++ -static -fuse-ld=lld" \
  -DCMAKE_SHARED_LINKER_FLAGS="--rtlib=compiler-rt --unwindlib=libunwind -stdlib=libc++ -fuse-ld=lld" \
  -DCOMPILER_RT_INCLUDE_TESTS=OFF
targets=$(ninja -C b-crt -t targets all | grep -oE '^clang_rt\.(profile|ubsan_minimal|ubsan_standalone)-[A-Za-z0-9_]+' | sort -u)
echo "targets: $targets"
for t in $targets; do
  ninja -C b-crt "$t" && echo "::notice::$T $t builds" || echo "::warning::$T $t fails"
done
find b-crt/lib -name 'libclang_rt.*.a' -exec cp {} "$RES/lib/$T/" \;
echo "::notice::$T profile $((SECONDS - step)) s"
ls -l "$RES/lib/$T" || ls -lR "$RES/lib"

flags=(--target="$T" --no-default-config --sysroot="$SR" -rtlib=compiler-rt -unwindlib=libunwind
  -stdlib=libc++ -static -fuse-ld=lld -O2)
cat > hello.cpp <<'EOF'
#include <atomic>
#include <cstdint>
#include <format>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <algorithm>
int main() {
  std::atomic<std::int64_t> n{0};
  std::vector<std::thread> ts;
  for (int i = 0; i < 4; ++i) ts.emplace_back([&] { for (int j = 0; j < 1000; ++j) n += 1; });
  for (auto& t : ts) t.join();
  std::vector<int> v{3, 1, 2};
  std::sort(v.begin(), v.end());
  try {
    throw std::logic_error("caught");
  } catch (const std::exception& e) {
    std::cout << std::format("ok {} n={} v={}{}{}\n", e.what(), n.load(), v[0], v[1], v[2]);
  }
  return n == 4000 ? 0 : 1;
}
EOF
cat > prof.c <<'EOF'
#include <stdio.h>
int main(void) { puts("profile ok"); return 0; }
EOF
"$X/bin/clang++" "${flags[@]}" -std=c++23 hello.cpp -o "$OUT/hello-$T"
"$X/bin/clang" "${flags[@]}" -fprofile-instr-generate prof.c -o "$OUT/prof-$T" \
  || echo "::warning::$T profile program does not link"
"$X/bin/clang" "${flags[@]}" -fsanitize=undefined -fsanitize-minimal-runtime prof.c -o "$OUT/ubsan-$T" \
  || echo "::warning::$T ubsan minimal program does not link"
"$X/bin/clang++" "${flags[@]}" -std=c++23 -fsanitize=undefined hello.cpp -o "$OUT/ubsanfull-$T" \
  || echo "::warning::$T ubsan (standalone) program does not link"
"$X/bin/llvm-readelf" -h "$OUT/hello-$T" | grep -E 'Class|Machine|Flags'
ls -l "$OUT"
# Sizes: the sysroot and the runtimes as a target archive would carry them.
du -sh "$SR" "$RES/lib/$T" || true
tar -C "$W" -cf - "sysroot-$T" | xz -T0 -6 | wc -c | awk -v t="$T" '{printf "::notice::%s sysroot+libc++ %.1f MB xz\n", t, $1/1e6}'
tar -C "$RES/lib" -cf - "$T" | xz -T0 -6 | wc -c | awk -v t="$T" '{printf "::notice::%s compiler-rt %.1f MB xz\n", t, $1/1e6}'
echo "::notice::$T total $((SECONDS - start)) s"
