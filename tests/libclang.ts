/// Build and run tests/libclang, a tool on libclang, with a host's two
/// archives unpacked: the toolchain compiles and links it against the
/// libclang libraries (ThinLTO bitcode), found through find_package(Clang),
/// and its program registering every target's MC layer.
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

/// The resource directory a tool on libclang hands to every compiler it
/// stands in for carries compiler-rt's headers, as the toolchain's does.
for (const header of ["sanitizer/asan_interface.h", "fuzzer/FuzzedDataProvider.h"]) {
  if (!fs.existsSync(path.join(common.resourceDir(libclang), "include", header))) {
    common.fail(`libclang has no ${header} in its resource directory`);
  }
}

/// clang-tidy's headers with the configuration header its build generated,
/// as xclang configures it: they compile.
const tidyConfig = path.join(libclang, "include", "clang-tidy", "clang-tidy-config.h");
if (!fs.existsSync(tidyConfig) || !/#define CLANG_TIDY_ENABLE_STATIC_ANALYZER 0/.test(fs.readFileSync(tidyConfig, "utf8"))) {
  common.fail(`libclang has no ${tidyConfig} without the static analyzer`);
}
const tidy = spawnSync(path.join(tree, "bin", `clang++${exe}`),
  ["-std=c++17", "-fno-rtti", "-fsyntax-only", "-I", path.join(libclang, "include"), "-x", "c++", "-"],
  { input: "#include \"clang-tidy/ClangTidyForceLinker.h\"\n#include \"clang-tidy/ClangTidyModule.h\"\n", encoding: "utf8" });
if (tidy.status !== 0) common.fail(`clang-tidy's headers do not compile:\n${tidy.stderr}`);

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

/// Every target's MC layer registers, and is found by triple.
const targets = spawnSync(path.join(build, `targets${exe}`), [], { encoding: "utf8" });
process.stdout.write(targets.stdout ?? "");
process.stderr.write(targets.stderr ?? "");
if (targets.status !== 0) common.fail("the target registry is not every target's MC layer");
