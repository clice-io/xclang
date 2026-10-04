#!/usr/bin/env bash
# Run the probe programs built for this machine: run.sh <dir>...
# Each <dir> holds programs and build.txt; prints PASS/FAIL per program and
# exits 1 if a required program failed.
set -u
fail=0
check() { # check <name> required|probe <command...>
  local name=$1 kind=$2; shift 2
  echo "::group::$name"
  "$@" > out.txt 2>&1
  local code=$?
  cat out.txt
  echo "::endgroup::"
  if [ $code = 0 ]; then echo "PASS $name"; else echo "FAIL $name (exit $code, $kind)"; [ "$kind" = required ] && fail=1; fi
}
for d in "$@"; do
  for f in "$d"/*; do
    case "$f" in *.txt|*.dylib|*.profraw) continue ;; esac
    [ -f "$f" ] || continue
    chmod +x "$f"
    n=${f##*/}
    case "$n" in
      asan*) check "$f (expects heap-buffer-overflow)" probe bash -c '"$1" 2>&1 | tee /dev/stderr | grep -q heap-buffer-overflow' _ "$f" ;;
      profile*) check "$f (writes a profile)" probe bash -c 'LLVM_PROFILE_FILE="$1.profraw" "$1" && test -s "$1.profraw"' _ "$f" ;;
      int128*|hello-sysroot|hello-sdkroot|hello-universal|*_tests|*_tests.exe) check "$f" probe "$f" ;;
      *) check "$f" required "$f" ;;
    esac
  done
done
exit $fail
