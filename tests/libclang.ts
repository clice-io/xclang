/// Build and run tests/libclang, a tool on libclang, with a host's two
/// archives unpacked: the toolchain compiles and links it against the
/// libclang libraries (ThinLTO bitcode), found through find_package(Clang).
///
///   node tests/libclang.ts --tree <xclang> --libclang <libclang>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../scripts/common.ts";

const { values } = parseArgs({ options: { tree: { type: "string" }, libclang: { type: "string" } } });
if (!values.tree || !values.libclang) common.fail("--tree <xclang> --libclang <libclang>");
const exe = process.platform === "win32" ? ".exe" : "";
const tree = path.resolve(values.tree);
const libclang = path.resolve(values.libclang);
const build = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-libclang-"));

common.run("cmake", [
  "-G", "Ninja", "-S", path.join(common.ROOT, "tests", "libclang"), "-B", build,
  "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_CXX_COMPILER=${path.join(tree, "bin", `clang++${exe}`)}`,
  `-DCMAKE_PREFIX_PATH=${libclang}`,
]);
common.run("cmake", ["--build", build]);
const result = spawnSync(path.join(build, `consumer${exe}`), [], { encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0 || !/clang version 23/.test(result.stdout) || !result.stdout.includes("tokens 9 zlib 1 zstd 1")) {
  common.fail("the libclang consumer did not run as expected");
}
