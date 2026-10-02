/// Checks of the Bazel module beyond tests/bazel's own tests, run after them
/// with the same disk cache:
///
///   node tests/bazel.ts --disk-cache <dir> [--previous <version>]
///
/// 1. A copy of the checkout elsewhere (other paths, another output base)
///    builds tests/bazel's programs from the disk cache alone: no action's
///    key holds an absolute path.
/// 2. The copy at the previous release (bazel/versions.bzl of --previous)
///    runs every compile and link again: the toolchain's files are the
///    actions' inputs.
/// 3. On Linux and macOS, the same build without the disk cache, in the
///    sandbox and outside it, one action at a time: what staging the
///    toolchain's files as inputs costs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../scripts/common.ts";

const { values } = parseArgs({
  options: {
    "disk-cache": { type: "string" },
    previous: { type: "string", default: "23.1.2.3" },
  },
});
if (!values["disk-cache"]) common.fail("--disk-cache <dir> [--previous <version>]");
const diskCache = path.resolve(values["disk-cache"]);
const windows = process.platform === "win32";
const TARGETS = ["//c:c_test", "//cpp:all", "//modules:all", "//options:all", "//shared:all"];

/// Bazel's own summary of a build: "INFO: 12 processes: 4 internal, 8 disk cache hit."
interface Processes {
  hits: number;
  executed: number;
  seconds: number;
}

function bazel(cwd: string, args: string[]): Processes {
  const startup = windows ? ["--output_user_root=C:/b", "--windows_enable_symlinks"] : [];
  const start = Date.now();
  const result = spawnSync("bazel", [...startup, ...args], { cwd, encoding: "utf8", shell: windows, maxBuffer: 1 << 28 });
  const seconds = (Date.now() - start) / 1000;
  process.stderr.write(result.stderr);
  if (result.status !== 0) common.fail(`bazel ${args.join(" ")} failed in ${cwd}`);
  const summary = /INFO: \d+ processes?: (.*)\./.exec(result.stderr)?.[1] ?? "";
  let hits = 0;
  let executed = 0;
  for (const part of summary.split(", ")) {
    const match = /^(\d+) (.*)$/.exec(part);
    if (!match) continue;
    const count = Number(match[1]);
    if (match[2] === "disk cache hit" || match[2] === "remote cache hit") hits += count;
    else if (match[2] !== "internal" && match[2] !== "action cache hit") executed += count;
  }
  return { hits, executed, seconds };
}

const report: string[] = [];
function check(ok: boolean, line: string): void {
  console.log(`${ok ? "ok" : "FAILED"}: ${line}`);
  report.push(`| ${ok ? "ok" : "**failed**"} | ${line} |`);
  if (!ok) process.exitCode = 1;
}

/// The checkout without what is not the module's or the tests'.
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xclang-")), "checkout");
fs.cpSync(common.ROOT, copy, {
  recursive: true,
  verbatimSymlinks: true,
  filter: (src) => {
    const name = path.basename(src);
    return ![".git", "work", "node_modules", ".pixi"].includes(name) && !name.startsWith("bazel-");
  },
});
const tests = path.join(copy, "tests", "bazel");
const cache = [`--disk_cache=${diskCache}`];

const shared = bazel(tests, ["build", ...cache, ...TARGETS]);
check(shared.executed === 0 && shared.hits > 0,
  `another checkout: ${shared.hits} actions from the disk cache, ${shared.executed} run`);

const sums = path.join(copy, "SHA256SUMS");
const response = await fetch(`https://github.com/clice-io/xclang/releases/download/${values.previous}/SHA256SUMS`);
if (!response.ok) common.fail(`no SHA256SUMS for ${values.previous}: ${response.status}`);
fs.writeFileSync(sums, await response.text());
common.run(process.execPath, [path.join(copy, "scripts", "bazel.ts"), "versions", sums]);
const previous = bazel(tests, ["build", ...cache, ...TARGETS]);
check(previous.hits === 0 && previous.executed > 0,
  `xclang ${values.previous}: ${previous.executed} actions run, ${previous.hits} from the disk cache`);

if (!windows) {
  /// The release of the module again, fetched already: only the actions differ.
  common.run("git", ["-C", common.ROOT, "show", "HEAD:bazel/versions.bzl"], {
    stdio: ["ignore", fs.openSync(path.join(copy, "bazel", "versions.bzl"), "w"), "inherit"],
  });
  const timed = (strategy: string): Processes => {
    bazel(tests, ["clean"]);
    return bazel(tests, ["build", "--jobs=1", `--spawn_strategy=${strategy}`, ...TARGETS]);
  };
  const sandboxed = timed("sandboxed");
  const local = timed("local");
  const perAction = ((sandboxed.seconds - local.seconds) / Math.max(sandboxed.executed, 1)) * 1000;
  check(true, `${sandboxed.executed} actions one at a time: ${sandboxed.seconds.toFixed(1)} s in the sandbox, ` +
    `${local.seconds.toFixed(1)} s outside it, ${perAction.toFixed(0)} ms per action`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bazel: ${process.platform} ${process.arch}\n\n| | |\n|---|---|\n${report.join("\n")}\n\n`);
}
