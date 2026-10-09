/// One host's archives, unpacked for the checks that use them (the
/// archives action, .github/actions/archives):
///
///   node tests/lib/archives.ts --host <triple> --out <dir> --dist <dir>
///       the archives of a run (its dist-<host> artifact, in <dir>), before
///       they are released
///   node tests/lib/archives.ts --host <triple> --out <dir> --release <tag|latest>
///       a published release's, downloaded from GitHub and checked against
///       its SHA256SUMS, with this checkout's config files and CMake package
///       in the toolchain, and the runtimes' sources if it has none (before
///       23.1.2.11): what a repack of the release would ship
///       (toolchain/package.ts writes the same), so that a change to them is
///       tested before any build
///
/// <out> gets xclang/, libclang/ and libclang-asan/ (where the host has
/// one), unpacked as a user does: on Windows by Windows' own tar. The
/// archives and their SHA256SUMS stay in <out>/dist. For the steps after
/// it, $GITHUB_ENV gets XCLANG_TREE, XCLANG_LIBCLANG,
/// XCLANG_LIBCLANG_ASAN, XCLANG_DIST, XCLANG_URL (where the archives can
/// be downloaded from: the release, or <out>/dist) and XCLANG_VERSION.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import { runtimesSources } from "../../toolchain/runtimes-src.ts";

const { values } = parseArgs({
  options: { host: { type: "string" }, out: { type: "string" }, dist: { type: "string" }, release: { type: "string" } },
});
if (!values.host || !values.out || !values.dist === !values.release) {
  common.fail("--host <triple> --out <dir> (--dist <dir> | --release <tag|latest>)");
}
const host = common.target(values.host);
const out = path.resolve(values.out);
const dist = path.join(out, "dist");
fs.mkdirSync(dist, { recursive: true });
const REPO = "https://github.com/clice-io/xclang/releases";

async function download(url: string, file: string): Promise<void> {
  console.log(`downloading ${url}`);
  const response = await fetch(url, { headers: { "User-Agent": "xclang/ci" } });
  if (!response.ok) common.fail(`${url}: HTTP ${response.status}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
/// The host's archives: its toolchain, its libclang and its ASan libclang.
const mine = (name: string) => new RegExp(`^(xclang|libclang)-[\\d.]+-${host.triple}(-asan)?\\.tar\\.xz$`).test(name);

let version: string;
let url: string;
if (values.dist) {
  const files = fs.readdirSync(values.dist).filter(mine);
  for (const f of files) fs.copyFileSync(path.join(values.dist, f), path.join(dist, f));
  fs.writeFileSync(path.join(dist, "SHA256SUMS"), files.map((f) => `${sha256(path.join(dist, f))}  ${f}\n`).join(""));
  version = /^xclang-([\d.]+)-/.exec(files.find((f) => f.startsWith("xclang-")) ?? "")?.[1] ?? common.fail(`no toolchain of ${host.triple} in ${values.dist}`);
  url = dist;
} else {
  const sums = path.join(dist, "SHA256SUMS");
  await download(values.release === "latest" ? `${REPO}/latest/download/SHA256SUMS` : `${REPO}/download/${values.release}/SHA256SUMS`, sums);
  const listed = new Map(fs.readFileSync(sums, "utf8").split("\n").map((l) => l.trim().split(/ [ *]?/)).filter((p) => p.length === 2).map(([sum, f]) => [f!, sum!]));
  version = /^llvm-option-inc-(.+)\.tar\.xz$/.exec([...listed.keys()].find((f) => f.startsWith("llvm-option-inc-")) ?? "")?.[1] ?? common.fail(`no release in ${sums}`);
  url = `${REPO}/download/${version}`;
  for (const [f, sum] of listed) {
    if (!mine(f)) continue;
    await download(`${url}/${f}`, path.join(dist, f));
    if (sha256(path.join(dist, f)) !== sum) common.fail(`${f}: not the sha256 of ${url}/SHA256SUMS`);
  }
}

const tar = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
for (const f of fs.readdirSync(dist).filter(mine).sort()) common.run(tar, ["-xf", path.join(dist, f), "-C", out]);
const tree = path.join(out, "xclang");
if (!fs.existsSync(path.join(tree, "bin"))) common.fail(`no toolchain in ${out}`);
if (values.release) {
  common.writeConfigs(tree, host.os);
  common.writeCMakePackage(path.join(tree, "lib", "cmake", "xclang"), version);
  if (!fs.existsSync(path.join(tree, "libc++", "src"))) await runtimesSources(path.join(tree, "libc++", "src"));
  console.log(`${tree}: ${version}, with this checkout's config files, CMake package and runtimes' sources`);
}

const slash = (p: string) => p.replaceAll("\\", "/");
const env = {
  XCLANG_TREE: slash(tree),
  XCLANG_LIBCLANG: slash(path.join(out, "libclang")),
  XCLANG_LIBCLANG_ASAN: fs.existsSync(path.join(out, "libclang-asan")) ? slash(path.join(out, "libclang-asan")) : "",
  XCLANG_DIST: slash(dist),
  XCLANG_URL: slash(url),
  XCLANG_VERSION: version,
};
console.log(Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"));
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(""));
