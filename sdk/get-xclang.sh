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
if command -v sha256sum > /dev/null; then grep " $A\$" SHA256SUMS | sha256sum -c >&2; else grep " $A\$" SHA256SUMS | shasum -a 256 -c >&2; fi
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) /c/Windows/System32/tar.exe -xf "$A"; cygpath -m "$PWD/xclang" ;;
  *) tar -xf "$A"; echo "$PWD/xclang" ;;
esac
