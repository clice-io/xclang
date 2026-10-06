/// Build and run tests/libclang, a tool on libclang, with a host's two
/// archives unpacked: the toolchain compiles and links it against the
/// libclang libraries (ThinLTO bitcode), found through find_package(Clang),
/// its program registering every target's MC layer, and one that crashes.
///
///   node tests/libclang/libclang.ts --tree <xclang> --libclang <libclang>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as common from "../../toolchain/common.ts";
import * as licenses from "../../toolchain/licenses.ts";

const { values } = parseArgs({ options: { tree: { type: "string" }, libclang: { type: "string" } } });
if (!values.tree || !values.libclang) common.fail("--tree <xclang> --libclang <libclang>");
const exe = process.platform === "win32" ? ".exe" : "";
const tree = path.resolve(values.tree);
const libclang = path.resolve(values.libclang);
const build = fs.mkdtempSync(path.join(os.tmpdir(), "xclang-libclang-"));

/// The license notices of what the archive holds (toolchain/licenses.ts).
const missing = licenses.check(libclang, ["xclang", "llvm-project", "zstd"]);
if (missing.length) common.fail(missing.join("\n"));

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

/// A crash's stack trace, by LLVM's handler and the tree's llvm-symbolizer,
/// reaches the tool's frames past the C library's: from qsort's comparator,
/// and from a signal handler printing the stack itself, through the
/// exception dispatcher. On arm64 Windows both stopped at the first frame
/// of a system DLL (patches/0010).
const symbolizer = path.join(tree, "bin", `llvm-symbolizer${exe}`);
for (const mode of ["qsort", "handler"]) {
  const crash = spawnSync(path.join(build, `stacktrace${exe}`), [mode],
    { encoding: "utf8", env: { ...process.env, LLVM_SYMBOLIZER_PATH: symbolizer } });
  const trace = crash.stderr ?? "";
  process.stderr.write(trace);
  const end = trace.indexOf("--- end of the handler's trace");
  const checked = mode === "handler" ? trace.slice(0, end) : trace;
  if (crash.status === 0 || (mode === "handler" && end < 0) || !/\bframe_a\b/.test(checked)) {
    common.fail(`the stack trace of a crash in ${mode === "qsort" ? "qsort's comparator" : "a program whose signal handler prints it"} does not reach frame_a`);
  }
}
