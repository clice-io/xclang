#!/usr/bin/env bash
# Run the programs of every artifact under <art> built for <arch>, and write
# a table of their builds (build.txt) and runs to the job's summary:
#   run-all.sh <art> <arch>
# Exits 1 if a program that built did not run.
set -u
ART=$1 ARCH=$2
cd "$(dirname "$0")/.." || exit 1
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
{ echo "| $ARCH | build | run |"; echo "|---|---|---|"; } >> "$summary"
fail=0
for a in "$ART"/*; do
  n=${a##*/}
  built="-"
  if [ -f "$a/build.txt" ]; then
    built="$(grep -c '^PASS' "$a/build.txt")/$(grep -c '' "$a/build.txt")"
    grep -q '^FAIL' "$a/build.txt" && built="$built: $(grep '^FAIL' "$a/build.txt" | sed 's/^FAIL //' | paste -sd, -)"
  fi
  ran="-"
  if [ -d "$a/$ARCH" ]; then
    out=$(sdk/run.sh "$a/$ARCH" 2>&1)
    code=$?
    echo "$out"
    ran="$(echo "$out" | grep -c '^PASS ')/$(echo "$out" | grep -cE '^(PASS|FAIL) ')"
    if [ $code != 0 ]; then
      fail=1
      ran="$ran: $(echo "$out" | grep '^FAIL ' | sed "s|^FAIL $a/$ARCH/||" | paste -sd, -)"
    fi
  fi
  echo "| $n | $built | $ran |" >> "$summary"
done
exit $fail
