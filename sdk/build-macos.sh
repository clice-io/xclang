#!/usr/bin/env bash
# Cross-compile the probe programs for arm64 and x86_64 macOS with an xclang
# tree and an SDK unpacked by vendor-sdk.py: build-macos.sh <xclang> <sdk> <out>
# Writes <out>/<arch>/<program> and <out>/build.txt (PASS/FAIL per step);
# exits 1 if a required step failed. Steps marked probe may fail.
set -u
X=$1 SDK=$2 OUT=$3
T=$(cd "$(dirname "$0")/tests" && pwd)
mkdir -p "$OUT"
fail=0
step() { # step <name> required|probe <command...>
  local name=$1 kind=$2; shift 2
  echo "::group::$name ($kind)"
  echo "+ $*"
  local start=$SECONDS
  if "$@"; then r=PASS; else r=FAIL; [ "$kind" = required ] && fail=1; fi
  echo "::endgroup::"
  echo "$r $name ($kind, $((SECONDS - start)) s)" | tee -a "$OUT/build.txt"
}
EXE=
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*)
  EXE=.exe X=$(cygpath -m "$X") SDK=$(cygpath -m "$SDK") T=$(cygpath -m "$T") ;;
esac
for arch in arm64 x86_64; do
  o=$OUT/$arch
  mkdir -p "$o"
  cc=("$X/bin/clang$EXE" "--target=$arch-apple-macos" -isysroot "$SDK")
  cxx=("$X/bin/clang++$EXE" "--target=$arch-apple-macos" -isysroot "$SDK")
  step "$arch C" required "${cc[@]}" -O2 "$T/hello.c" -o "$o/hello-c"
  step "$arch C++ (exceptions, threads, filesystem, format)" required "${cxx[@]}" -std=c++23 -O2 "$T/hello.cpp" -o "$o/hello-cpp"
  step "$arch C++ ThinLTO" required "${cxx[@]}" -std=c++23 -O2 -flto=thin "$T/hello.cpp" -o "$o/hello-cpp-lto"
  step "$arch CoreFoundation" required "${cc[@]}" -O2 "$T/cf.c" -framework CoreFoundation -o "$o/cf"
  step "$arch Objective-C Foundation" required "${cc[@]}" -O2 -fobjc-arc "$T/objc.m" -framework Foundation -o "$o/objc"
  step "$arch __int128 (compiler-rt builtins)" required "${cc[@]}" -O2 "$T/int128.c" -o "$o/int128"
  step "$arch --sysroot instead of -isysroot" probe "$X/bin/clang$EXE" "--target=$arch-apple-macos" "--sysroot=$SDK" "$T/hello.c" -o "$o/hello-sysroot"
  step "$arch SDKROOT instead of -isysroot" probe env SDKROOT="$SDK" "$X/bin/clang$EXE" "--target=$arch-apple-macos" "$T/hello.c" -o "$o/hello-sdkroot"
  step "$arch profile runtime" probe "${cc[@]}" -fprofile-instr-generate "$T/hello.c" -o "$o/profile"
  # The ASan runtime is a dylib, found next to the program (clang adds the
  # rpath @executable_path).
  step "$arch ASan" probe "${cc[@]}" -g -fsanitize=address "$T/asan.c" -o "$o/asan"
  cp "$X"/lib/clang/*/lib/darwin/libclang_rt.asan_osx_dynamic.dylib "$o/" 2>/dev/null || true
done
step "universal C (-arch arm64 -arch x86_64)" probe "$X/bin/clang$EXE" -isysroot "$SDK" --target=arm64-apple-macos -arch arm64 -arch x86_64 "$T/hello.c" -o "$OUT/hello-universal"
for f in "$OUT"/arm64/hello-cpp "$OUT"/x86_64/objc; do
  [ -f "$f" ] || continue
  echo "== $f"
  "$X/bin/llvm-otool$EXE" -L "$f"
  "$X/bin/llvm-otool$EXE" -l "$f" | grep -A5 -E 'LC_BUILD_VERSION|LC_CODE_SIGNATURE' | grep -E 'cmd|minos|sdk|datasize'
done
exit $fail
