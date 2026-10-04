#!/usr/bin/env bash
# Download xclang's release archive for <host> into <dir>, checked against
# the release's SHA256SUMS, and unpack it: get-xclang.sh <version> <host> <dir>
# Prints the tree's path (a Windows path on Windows).
set -euo pipefail
V=$1 HOST=$2 DIR=$3
A=xclang-$V-$HOST.tar.xz
mkdir -p "$DIR"
cd "$DIR"
curl -sSfLO "https://github.com/clice-io/xclang/releases/download/$V/$A"
curl -sSfLO "https://github.com/clice-io/xclang/releases/download/$V/SHA256SUMS"
want=$(grep " $A\$" SHA256SUMS | cut -d' ' -f1)
got=$( (sha256sum "$A" 2> /dev/null || shasum -a 256 "$A") | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "$A: sha256 $got, expected $want" >&2; exit 1; }
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) /c/Windows/System32/tar.exe -xf "$A"; cygpath -m "$PWD/xclang" ;;
  *) tar -xf "$A"; echo "$PWD/xclang" ;;
esac
