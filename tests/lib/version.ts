/// The release of the archives under test, when tests/lib/archives.ts
/// unpacked them (XCLANG_VERSION). checks.yml tests the latest release, so a
/// check of a change that release does not have waits for the one that does.

/// Whether the archives are of `release` or later; true for a tree that
/// tests/lib/archives.ts did not unpack.
export function since(release: string): boolean {
  const version = process.env.XCLANG_VERSION;
  if (!version) return true;
  const have = version.split(".").map(Number);
  const want = release.split(".").map(Number);
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) > (want[i] ?? 0);
  }
  return true;
}
