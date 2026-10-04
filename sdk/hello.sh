#!/usr/bin/env bash
# Build the C and C++ hello programs for both architectures of a target:
#   hello.sh msvc <xclang> <winsysroot> <out>   x86_64, aarch64; C++ /MT and /MD
#   hello.sh macos <xclang> <sdk> <out>         arm64, x86_64
# Writes <out>/<arch>/<program> and <out>/build.txt; exits 1 if one failed.
set -u
KIND=$1 X=$2 ROOT=$3 OUT=$4
T=$(cd "$(dirname "$0")/tests" && pwd)
mkdir -p "$OUT"
fail=0
step() { # step <name> <command...>
  local name=$1; shift
  echo "::group::$name"
  echo "+ $*"
  if "$@"; then r=PASS; else r=FAIL; fail=1; fi
  echo "::endgroup::"
  echo "$r $name" | tee -a "$OUT/build.txt"
}
if [ "$KIND" = msvc ]; then
  for arch in x86_64 aarch64; do
    o=$OUT/$arch
    mkdir -p "$o"
    # Inputs after --: clang-cl takes /Users/... (macOS) for its /U option.
    cl=("$X/bin/clang-cl" "--target=$arch-pc-windows-msvc" /winsysroot "$ROOT" -fuse-ld=lld /O2)
    step "$arch C" "${cl[@]}" "/Fe$o/hello-c.exe" -- "$T/hello.c"
    step "$arch C++ /MT" "${cl[@]}" /EHsc /std:c++latest "/Fe$o/hello-cpp.exe" -- "$T/hello.cpp"
    step "$arch C++ /MD" "${cl[@]}" /EHsc /MD /std:c++latest "/Fe$o/hello-cpp-md.exe" -- "$T/hello.cpp"
  done
  rm -f "$OUT"/*/*.lib "$OUT"/*/*.exp
else
  for arch in arm64 x86_64; do
    o=$OUT/$arch
    mkdir -p "$o"
    step "$arch C" "$X/bin/clang" "--target=$arch-apple-macos" -isysroot "$ROOT" -O2 "$T/hello.c" -o "$o/hello-c"
    step "$arch C++" "$X/bin/clang++" "--target=$arch-apple-macos" -isysroot "$ROOT" -std=c++23 -O2 "$T/hello.cpp" -o "$o/hello-cpp"
  done
fi
exit $fail
