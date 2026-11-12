/// The checker that keeps docs/zh a translation of docs/en, segment by
/// segment: @clice-io/translate of clice-io/docs, at an exact release
/// (its tools/translations/RULES.md is the contract). docs/meta/translations
/// holds the hash pairs that attest each segment's translation.
///
///   node tests/docs/translations.ts check    zh matches en, every pair attested
///   node tests/docs/translations.ts report   the pairs that drifted, with both texts
///   node tests/docs/translations.ts record   attest the pairs as they are now
///
/// `record` blesses what is on disk: run it only after reading what
/// `report` showed. CI runs `check` through clice-io/docs's
/// check-translations action, of the same release.
///
/// The release is checked out once, sparsely, under .cache/, with its
/// dependencies.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RELEASE = "v1.0.0";
const checkout = path.join(ROOT, ".cache", `clice-docs-${RELEASE}`);

function run(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed`);
    process.exit(1);
  }
}

if (!fs.existsSync(checkout)) {
  /// Built aside and renamed into place, so a checkout that exists is
  /// complete.
  const staging = `${checkout}.${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const git = (...args: string[]) => run("git", args, { cwd: staging });
  git("init", "--quiet");
  git("remote", "add", "origin", "https://github.com/clice-io/docs.git");
  git("sparse-checkout", "set", "tools/translations");
  git("fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", RELEASE);
  git("checkout", "--quiet", "FETCH_HEAD");
  /// A command line, as npm is a .cmd shim on Windows, which only a shell
  /// starts.
  run("npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent", [], {
    cwd: path.join(staging, "tools", "translations"),
    shell: true,
  });
  fs.renameSync(staging, checkout);
}

const cli = path.join(checkout, "tools", "translations", "src", "cli.ts");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" });
process.exit(result.status ?? 1);
