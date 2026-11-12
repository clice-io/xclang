/// What is checked before a release is begun (the release skill, step 0):
///
///   node tests/release/preflight.ts
///
/// From a checkout of main's head, with gh signed in (GH_TOKEN on CI;
/// preflight.yml runs it there, next to `xclang sdk update-table --check`).
/// Each check prints `ok`, `FAIL` with what to do, or `note`; the script
/// exits 1 when one failed. It changes nothing.
///
/// 1. main: this checkout is main's head, and checks.yml passed there.
/// 2. weekly.yml (examples.yml with every example's pinned module, the
///    Bazel module, the xclang command fetching both SDKs) passed on main,
///    within eight days and after the latest release was published: what
///    users run still works, and what the release run will meet (Apple's
///    and Microsoft's downloads, the registries).
/// 3. The latest release published everywhere: its published.yml run
///    passed; bazel.clice.io and conda.clice.io serve it; `latest` and main
///    have its tag.
/// 4. Nothing of another release under way: no open pull request from a
///    release/* branch, no draft, no branch of the next version.
/// 5. The next release: its version, and a full rebuild or a repack by
///    what changed since the latest (each file that decides it).
/// 6. A full rebuild: the bootstrap pinned in toolchain/common.ts is a
///    release's archive with that release's digest, still served; when LLVM
///    moved, a full release.yml run of the new LLVM passed every test stage
///    at a commit that differs from main only in what a repack takes (the
///    llvm-upgrade skill's validation run).
/// 7. A repack: the artifacts of the run that built the latest release's
///    compiler (its tag commit's Compiler-Run, or its notes' build run)
///    are still there, and until when.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import * as common from "../../toolchain/common.ts";
import { fetchRetry, TRANSIENT, WAITS } from "../lib/net.ts";

const REPO = "clice-io/xclang";
const DAY = 86_400_000;
const failures: string[] = [];
const report: string[] = [];
const say = (line: string) => { console.log(line); report.push(line); };
const ok = (what: string) => say(`ok    ${what}`);
const note = (what: string) => say(`note  ${what}`);
const fail = (what: string, todo: string) => { say(`FAIL  ${what}\n      → ${todo}`); failures.push(what); };

/// gh, tried again when GitHub's network fails; null when it fails
/// otherwise (a 404).
function gh(args: string[]): string | null {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status === 0) return r.stdout;
    const wait = WAITS[attempt - 1];
    if (wait === undefined || !TRANSIENT.test(r.stderr)) return null;
    console.error(`gh ${args.join(" ")}: ${r.stderr.trim()}; again in ${wait} s`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
  }
}
const api = <T>(path: string): T | null => {
  const out = gh(["api", path]);
  return out === null ? null : JSON.parse(out) as T;
};
const git = (args: string[]) => spawnSync("git", ["-C", common.ROOT, ...args], { encoding: "utf8" });
const link = (id: number | string) => `https://github.com/${REPO}/actions/runs/${id}`;

interface Run { id: number; status: string; conclusion: string | null; created_at: string; head_sha: string; display_title: string; event: string }
interface Release { tag_name: string; draft: boolean; published_at: string | null; target_commitish: string; body: string | null }
const runs = (workflow: string, query: string): Run[] =>
  api<{ workflow_runs: Run[] }>(`repos/${REPO}/actions/workflows/${workflow}/runs?per_page=50&${query}`)?.workflow_runs ?? [];

/// 1. main.
const main = api<{ sha: string }>(`repos/${REPO}/commits/main`)?.sha ?? common.fail("main's head: GitHub did not answer");
const head = git(["rev-parse", "HEAD"]).stdout.trim();
if (head !== main) {
  fail(`this checkout is ${head.slice(0, 9)}, main's head is ${main.slice(0, 9)}`,
    "git fetch origin main && git checkout --detach origin/main, and run it again");
}
const checks = runs("checks.yml", `branch=main&event=push&head_sha=${main}`)[0];
if (!checks) fail(`checks.yml has not run on main's head ${main.slice(0, 9)}`, "wait for it (a push to main starts it)");
else if (checks.status !== "completed") fail(`checks.yml on main is ${checks.status}: ${link(checks.id)}`, "wait for it, then run this again");
else if (checks.conclusion !== "success") {
  fail(`checks.yml failed on main's head: ${link(checks.id)}`, "fix main first (a failure there is main's, not the release's)");
} else ok(`checks.yml passed on main's head ${main.slice(0, 9)}`);

/// 3. (first: 2. compares with its publication) The latest release.
const releases: Release[] = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${REPO}/releases?per_page=100`]) ?? "[[]]").flat();
const latest = api<Release>(`repos/${REPO}/releases/latest`) ?? common.fail("the latest release: GitHub did not answer");
const L = latest.tag_name;
const publishedAt = Date.parse(latest.published_at!);
note(`the latest release is ${L}, published ${latest.published_at}`);
const tagSha = api<{ sha: string }>(`repos/${REPO}/commits/${L}`)?.sha ?? "";
const published = runs("published.yml", "status=completed")
  .filter((r) => Date.parse(r.created_at) >= publishedAt - 3_600_000);
const lastPublished = published[0];
if (!lastPublished) {
  fail(`no published.yml run since ${L} was published`, `gh workflow run published.yml -R ${REPO} --ref main -f tag=${L} -f publish=true`);
} else if (lastPublished.conclusion !== "success") {
  fail(`published.yml for ${L} failed: ${link(lastPublished.id)}`,
    `each failed job explained (.claude/skills/release/troubleshooting.md); fixed, then gh workflow run published.yml -R ${REPO} --ref main -f tag=${L} -f publish=true`);
} else ok(`published.yml passed for ${L}: ${link(lastPublished.id)}`);
const text = async (url: string) => { const r = await fetchRetry(url); return r.ok ? r.text() : ""; };
if ((await text("https://bazel.clice.io/modules/xclang/metadata.json")).includes(`"${L}"`)) ok(`bazel.clice.io has xclang ${L}`);
else fail(`bazel.clice.io has no xclang ${L}`, `published.yml's bazel-registry job: gh workflow run published.yml -R ${REPO} --ref main -f tag=${L} -f publish=true`);
const subdirs = ["linux-64", "linux-aarch64", "win-64", "win-arm64", "osx-arm64", "osx-64"];
const missing: string[] = [];
for (const subdir of subdirs) {
  if (!(await text(`https://conda.clice.io/${subdir}/repodata.json`)).includes(`"xclang-${L}-`)) missing.push(subdir);
}
if (!(await text("https://conda.clice.io/noarch/repodata.json")).includes(`"llvm-option-inc-${L}-`)) missing.push("noarch");
if (missing.length) fail(`conda.clice.io has no ${L} for ${missing.join(", ")}`, `published.yml's conda job: gh workflow run published.yml -R ${REPO} --ref main -f tag=${L} -f publish=true`);
else ok(`conda.clice.io has ${L} for every host`);
const latestBranch = api<{ commit: { sha: string } }>(`repos/${REPO}/branches/latest`)?.commit.sha;
if (latestBranch === tagSha) ok(`the latest branch is ${L}'s tag`);
else fail(`the latest branch is ${latestBranch?.slice(0, 9)}, not ${L}'s tag ${tagSha.slice(0, 9)}`, "published.yml's latest job (published.yml by hand, as above)");
const inMain = api<{ status: string }>(`repos/${REPO}/compare/${main}...${tagSha}`)?.status;
if (inMain === "behind" || inMain === "identical") ok(`${L}'s tag is in main's history`);
else fail(`${L}'s tag is not in main's history (${inMain})`, `a pull request of ${L} into main, merged as a merge commit (stage-draft.yml refuses a release whose history lacks it)`);

/// 2. weekly.yml.
const weekly = runs("weekly.yml", "branch=main");
const lastWeekly = weekly.find((r) => r.status === "completed");
const fresh = (r: Run) => Date.now() - Date.parse(r.created_at) < 8 * DAY && Date.parse(r.created_at) > publishedAt;
if (weekly[0] && weekly[0].status !== "completed") fail(`weekly.yml is running: ${link(weekly[0].id)}`, "wait for it, then run this again");
else if (!lastWeekly || !fresh(lastWeekly)) {
  fail(`no weekly.yml run on main within 8 days and after ${L} was published`, `gh workflow run weekly.yml -R ${REPO} --ref main; wait for it, then run this again`);
} else if (lastWeekly.conclusion !== "success") {
  fail(`weekly.yml failed: ${link(lastWeekly.id)}`,
    "each failed job explained (.claude/skills/release/troubleshooting.md): a stale example pin, a vendor's download, a flake; fix by a pull request, then weekly.yml again");
} else ok(`weekly.yml passed on main: ${link(lastWeekly.id)}`);
for (const file of fs.readdirSync(`${common.ROOT}/examples`).map((d) => `examples/${d}/MODULE.bazel`)) {
  if (!fs.existsSync(`${common.ROOT}/${file}`)) continue;
  const pin = /bazel_dep\(name = "xclang", version = "([^"]+)"\)/.exec(fs.readFileSync(`${common.ROOT}/${file}`, "utf8"))?.[1];
  if (pin) note(`${file} takes xclang ${pin} (the oldest it takes; weekly.yml builds it as written)`);
}

/// 4. Nothing under way.
const prs = JSON.parse(gh(["pr", "list", "-R", REPO, "--state", "open", "--json", "number,headRefName"]) ?? "[]") as { number: number; headRefName: string }[];
const open = prs.filter((p) => p.headRefName.startsWith("release/"));
if (open.length) fail(`open release pull requests: ${open.map((p) => `#${p.number} (${p.headRefName})`).join(", ")}`, "merge or close it first: one release at a time");
else ok("no release pull request is open");
const drafts = releases.filter((r) => r.draft);
if (drafts.length) fail(`drafts: ${drafts.map((r) => r.tag_name).join(", ")}`, "publish or delete each (gh release delete <tag> -R clice-io/xclang --yes, and its release/<tag> branch)");
else ok("no draft release");

/// 5. The next release.
const llvm = common.LLVM_VERSION;
const revisions = releases.map((r) => new RegExp(`^${llvm.replaceAll(".", "\\.")}\\.(\\d+)$`).exec(r.tag_name)?.[1]).filter(Boolean).map(Number);
const next = `${llvm}.${revisions.length ? Math.max(...revisions) + 1 : 1}`;
say(`next  ${next}`);
const branches = gh(["api", `repos/${REPO}/git/matching-refs/heads/release/${next}`]);
if (branches && JSON.parse(branches).some((r: { ref: string }) => r.ref === `refs/heads/release/${next}`)) {
  fail(`the branch release/${next} exists`, `left by an attempt before: git push origin --delete release/${next}, once nothing of it is wanted`);
}

/// What a file's change takes: a repack (the package stage reads it from the
/// checkout, or the archives do not hold it), a full rebuild, or a reading
/// of its diff (toolchain/common.ts: SOURCES, TARGETS, MACOS_MIN and the
/// LLVM pins are built in, the helpers package.ts uses are not).
const FULL = [
  /^patches\//, /^toolchain\/(cmake|launcher|pgo|musl)\//, /^toolchain\/(toolchain|runtimes|sysroot|bootstrap|fetch)\.ts$/,
  /^pixi\.(toml|lock)$/, /^\.github\/workflows\/stage-(runtimes|toolchain|train)\.yml$/, /^\.github\/actions\/(setup|free-disk)\//,
];
const REPACK = [
  /^toolchain\/config\//, /^toolchain\/(package|licenses|runtimes-src)\.ts$/, /^toolchain\/licenses\//, /^LICENSE$/,
  /^packages\//, /^xclang\//, /^docs\//, /^examples\//, /^tests\//, /^\.github\//, /^\.claude\//,
  /^[A-Za-z.-]+\.md$/, /^(package(-lock)?\.json|tsconfig\.json|\.gitignore|\.gitattributes)$/,
];
const kindOf = (file: string): "full" | "repack" | "read" =>
  FULL.some((r) => r.test(file)) ? "full" : REPACK.some((r) => r.test(file)) ? "repack" : "read";
const changed = (from: string, to: string): string[] | null => {
  const out = api<{ files?: { filename: string }[] }>(`repos/${REPO}/compare/${from}...${to}`);
  return out ? (out.files ?? []).map((f) => f.filename) : null;
};
const since = changed(tagSha, main) ?? common.fail(`what changed since ${L}: GitHub did not answer`);
const full = since.filter((f) => kindOf(f) === "full");
const read = since.filter((f) => kindOf(f) === "read");
const llvmMoved = !L.startsWith(`${llvm}.`);
const kind = llvmMoved || full.length ? "full rebuild" : read.length ? "full rebuild or repack" : "repack";
say(`kind  ${kind}${llvmMoved ? `: LLVM ${llvm}, ${L} is of another` : ""}`);
for (const f of full) say(`        full    ${f}`);
for (const f of read) say(`        read    ${f} (git diff ${L} origin/main -- ${f}: a pin or target, full; package.ts's helpers, repack)`);
if (!since.some((f) => /^(toolchain|xclang|packages\/(cmake|bazel)|patches|LICENSE)/.test(f))) {
  note(`nothing since ${L} reaches the archives or the Bazel module: is a release wanted?`);
}

/// 6. A full rebuild's bootstrap and validation.
if (kind !== "repack") {
  for (const name of ["bootstrap-linux", "bootstrap-macos"] as const) {
    const { url, sha256 } = common.SOURCES[name];
    const m = /\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url);
    if (!m) { note(`${name} is ${url}, not an xclang release's archive`); continue; }
    const [, tag, file] = m;
    const sums = await text(`https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS`);
    const listed = sums.split("\n").find((l) => l.trim().endsWith(` ${file}`) || l.trim().endsWith(`*${file}`))?.split(/\s+/)[0];
    const served = (await fetchRetry(url, { method: "HEAD" })).ok;
    if (listed !== sha256) fail(`${name}: ${file}'s sha256 is not ${tag}'s SHA256SUMS'`, "take the line from that release's SHA256SUMS (release skill, step 1)");
    else if (!served) fail(`${name}: ${url} is not served`, "pin a release that is");
    else ok(`${name}: ${tag}, its digest, served`);
    if (name === "bootstrap-linux" && tag !== L) note(`the bootstrap is ${tag}, the latest release ${L}: move it unless ${L} lacks something the build needs (release skill, step 1)`);
  }
  if (llvmMoved) {
    const validated = runs("release.yml", "status=success").find((r) =>
      ["runtimes", "toolchain", "package", "test", "bazel", "cmake", "sdk", "cli"].every((s) => r.display_title.includes(s)) &&
      !r.display_title.includes("against") &&
      (changed(r.head_sha, main)?.every((f) => kindOf(f) === "repack") ?? false));
    if (validated) ok(`LLVM ${llvm} validated by ${link(validated.id)} (${validated.head_sha.slice(0, 9)})`);
    else {
      fail(`LLVM moved to ${llvm} and no full release.yml run of main's build passed every test stage`,
        `the llvm-upgrade skill's validation run: gh workflow run release.yml -R ${REPO} --ref exp/${llvm} -f stages=runtimes,instrumented,train,toolchain,asan,package,test,bazel,cmake,sdk,cli,rebuild -f revision=1, green before the upgrade merges`);
    }
  }
}

/// 7. A repack's artifacts.
if (kind !== "full rebuild") {
  const trailer = git(["log", "-1", "--format=%(trailers:key=Compiler-Run,valueonly)", tagSha]).stdout.trim();
  const fromNotes = /\[build run\]\(https:\/\/github\.com\/clice-io\/xclang\/actions\/runs\/(\d+)\)/.exec(latest.body ?? "")?.[1];
  const run = /^\d+$/.test(trailer) ? trailer : fromNotes;
  if (!run) fail(`no run of ${L}'s compiler: its tag commit names no Compiler-Run, its notes no build run`, "a full rebuild");
  else {
    const artifacts = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${REPO}/actions/runs/${run}/artifacts?per_page=100`]) ?? "[]")
      .flatMap((p: { artifacts: { name: string; expired: boolean; expires_at: string }[] }) => p.artifacts);
    const wanted = [
      ...common.HOSTS.map((h) => `toolchain-${h.triple}`), "toolchain-x86_64-unknown-linux-gnu-asan", "toolchain-aarch64-apple-darwin-asan",
      ...["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-w64-mingw32", "aarch64-w64-mingw32",
        "x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl", "darwin", "msvc"].map((u) => `runtimes-${u}`),
      "profile",
    ];
    const have = new Map(artifacts.filter((a: { expired: boolean }) => !a.expired).map((a: { name: string; expires_at: string }) => [a.name, a.expires_at]));
    const gone = wanted.filter((n) => !have.has(n));
    if (gone.length) fail(`run ${run}, which built ${L}'s compiler, lacks ${gone.join(", ")} (expired)`, "a repack cannot be made: a full rebuild");
    else {
      const until = wanted.map((n) => have.get(n) as string).sort()[0]!;
      if (Date.parse(until) - Date.now() < 2 * DAY) fail(`run ${run}'s artifacts expire ${until}`, "start the repack now, or a full rebuild");
      else ok(`run ${run} (${link(run)}) has ${L}'s compiler, runtimes and profile until ${until}: reuse-run and profile-run`);
    }
  }
}

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${report.join("\n")}\n\`\`\`\n`);
if (failures.length) {
  console.log(`\n${failures.length} failed: no release until each is resolved (.claude/skills/release/troubleshooting.md)`);
  process.exit(1);
}
console.log(`\nready for ${next} (${kind})`);
