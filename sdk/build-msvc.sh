#!/usr/bin/env bash
# Cross-compile the probe programs for x64 and arm64 Windows (MSVC ABI) with
# an xclang tree and the CRT + Windows SDK splatted by xwin in /winsysroot
# layout: build-msvc.sh <xclang> <winsysroot> <out>
# Writes <out>/<arch>/<program>.exe and <out>/build.txt; exits 1 if a
# required step failed. Steps marked probe may fail.
set -u
X=$1 W=$2 OUT=$3
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
R=$("$X/bin/clang" -print-resource-dir)
for arch in x86_64 aarch64; do
  o=$OUT/$arch
  mkdir -p "$o"
  t=$arch-pc-windows-msvc
  cl=("$X/bin/clang-cl" "--target=$t" /winsysroot "$W" -fuse-ld=lld)
  gnu=("$X/bin/clang++" "--target=$t" -Xmicrosoft-windows-sys-root "$W" -fuse-ld=lld)
  step "$arch clang-cl C" required "${cl[@]}" /O2 "$T/hello.c" "/Fe$o/hello-c.exe"
  step "$arch clang-cl C++ /MT (exceptions, threads, filesystem, format)" required "${cl[@]}" /O2 /EHsc /std:c++latest "$T/hello.cpp" "/Fe$o/hello-cpp.exe"
  step "$arch clang-cl C++ /MD" required "${cl[@]}" /O2 /EHsc /MD /std:c++latest "$T/hello.cpp" "/Fe$o/hello-cpp-md.exe"
  step "$arch clang-cl C++ ThinLTO" required "${cl[@]}" /O2 /EHsc /std:c++latest -flto=thin "$T/hello.cpp" "/Fe$o/hello-cpp-lto.exe"
  step "$arch clang++ (GNU driver) C++" required "${gnu[@]}" -O2 -std=c++23 "$T/hello.cpp" -o "$o/hello-cpp-gnu.exe"
  step "$arch clang-cl Win32 API" required "${cl[@]}" /O2 "$T/win32.c" user32.lib advapi32.lib "/Fe$o/win32.exe"
  step "$arch __int128 without compiler-rt" probe "${cl[@]}" /O2 "$T/int128.c" "/Fe$o/int128.exe"
  # xclang's MinGW builtins have the same calling convention.
  step "$arch __int128 with the MinGW builtins" probe "${cl[@]}" /O2 "$T/int128.c" "$R/lib/$arch-w64-windows-gnu/libclang_rt.builtins.a" "/Fe$o/int128-mingwrt.exe"
  step "$arch profile runtime" probe "${cl[@]}" -fprofile-instr-generate "$T/hello.c" "/Fe$o/profile.exe"
  step "$arch ASan" probe "${cl[@]}" -fsanitize=address "$T/asan.c" "/Fe$o/asan.exe"
done
rm -f "$OUT"/*/*.lib "$OUT"/*/*.exp "$OUT"/*/*.obj
for f in "$OUT"/x86_64/hello-cpp.exe "$OUT"/x86_64/hello-cpp-md.exe "$OUT"/aarch64/win32.exe; do
  [ -f "$f" ] && { echo "== $f"; "$X/bin/llvm-objdump" -p "$f" | grep 'DLL Name' | sort -u; }
done
exit $fail
