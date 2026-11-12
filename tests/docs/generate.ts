/// The tables of the docs that the code already says: what each target is
/// and has, from the Bazel module's table of targets
/// (packages/bazel/bazel/hosts.bzl), the config files' names of each
/// (toolchain/common.ts, cfgNames) and the versions the toolchain is built
/// with (toolchain/common.ts, pixi.toml). A page holds a table between
///
///   <!-- BEGIN GENERATED: <name> -->
///   <!-- END GENERATED -->
///
/// in docs/en and docs/zh alike, in its language.
///
///   node tests/docs/generate.ts           rewrite the tables
///   node tests/docs/generate.ts --check   fail if one is not as generated

import * as fs from "node:fs";
import * as path from "node:path";
import { cfgNames, MACOS_MIN, MINGW_VERSION, MSVC_TARGETS, MUSL_VERSION, TARGETS } from "../../toolchain/common.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/// hosts.bzl's TARGETS: per triple, its C library, the sanitizer features
/// of its prebuilt runtimes and its vendor SDK.
interface Facts {
  libc: string;
  sanitizers: string[];
  sdk: string | null;
}
function hosts(): Map<string, Facts> {
  const text = fs.readFileSync(path.join(ROOT, "packages/bazel/bazel/hosts.bzl"), "utf8");
  const table = text.slice(text.indexOf("TARGETS = {"), text.indexOf("\n}\n", text.indexOf("TARGETS = {")));
  const facts = new Map<string, Facts>();
  for (const m of table.matchAll(/"([\w-]+)": struct\(([\s\S]*?)\n    \),/g)) {
    const field = (name: string) => new RegExp(`\\n\\s+${name} = (.*),`).exec(m[2]!)?.[1] ?? "";
    const sdk = field("sdk");
    facts.set(m[1]!, {
      libc: JSON.parse(field("libc")),
      sanitizers: JSON.parse(field("sanitizers")),
      sdk: sdk === "None" ? null : JSON.parse(sdk),
    });
  }
  return facts;
}

const GLIBC = /sysroot_linux-64 = "([\d.]+)\.\*"/.exec(fs.readFileSync(path.join(ROOT, "pixi.toml"), "utf8"))![1]!;

type Lang = "en" | "zh";
const WORDS = {
  en: {
    target: "target", spellings: "also spelled", libc: "C library", runs: "runs on", sdk: "vendor SDK", yes: "yes",
    none: "", glibc: `glibc ${GLIBC}`, musl: `musl ${MUSL_VERSION}, static`, mingw: `mingw-w64 ${MINGW_VERSION}, UCRT`,
    msvc: "Microsoft's CRT and UCRT", macosx: "the SDK's libSystem",
    on: { glibc: `Linux with glibc ${GLIBC} or later`, musl: "any Linux", mingw: "Windows 10 or later", msvc: "Windows 10 or later", macosx: `macOS ${MACOS_MIN} or later` },
    macos: "Apple's, on Linux and Windows hosts", windows: "Microsoft's",
    msan: "with the runtimes from source",
  },
  zh: {
    target: "目标平台", spellings: "其他写法", libc: "C 运行时库", runs: "运行环境", sdk: "厂商 SDK", yes: "支持",
    none: "", glibc: `glibc ${GLIBC}`, musl: `musl ${MUSL_VERSION}，静态链接`, mingw: `mingw-w64 ${MINGW_VERSION}，UCRT`,
    msvc: "微软的 CRT 与 UCRT", macosx: "SDK 的 libSystem",
    on: { glibc: `glibc ${GLIBC} 及以上的 Linux`, musl: "任意 Linux", mingw: "Windows 10 及以上", msvc: "Windows 10 及以上", macosx: `macOS ${MACOS_MIN} 及以上` },
    macos: "Apple 的，在 Linux 与 Windows 主机上", windows: "微软的",
    msan: "需从源码构建运行时库",
  },
} as const;

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/// The targets, in the order of the toolchain's tables: what each is, its
/// other config file names, its C library, the systems its programs run on
/// (Windows 10: mingw-w64's _WIN32_WINNT, toolchain/sysroot.ts, and UCRT)
/// and its vendor SDK.
function targets(lang: Lang, facts: Map<string, Facts>): string {
  const w = WORDS[lang];
  const lines = [row([w.target, w.spellings, w.libc, w.runs, w.sdk]), row(["---", "---", "---", "---", "---"])];
  for (const t of [...TARGETS, ...MSVC_TARGETS]) {
    const f = facts.get(t.triple)!;
    const other = cfgNames(t).filter((n) => n !== t.triple).map((n) => `\`${n}\``).join(", ");
    const libc = f.libc as keyof typeof w.on;
    lines.push(row([`\`${t.triple}\``, other, w[libc], w.on[libc], f.sdk ? w[f.sdk as "macos" | "windows"] : w.none]));
  }
  return lines.join("\n");
}

/// The sanitizers of each target's prebuilt runtimes, and MemorySanitizer,
/// which the runtimes from source build for the glibc targets
/// (packages/bazel/bazel/runtimes.bzl, packages/cmake/runtimes.cmake).
function sanitizers(lang: Lang, facts: Map<string, Facts>): string {
  const w = WORDS[lang];
  const kinds = [["asan", "ASan"], ["lsan", "LSan"], ["tsan", "TSan"], ["ubsan", "UBSan"], ["msan", "MSan"]] as const;
  const lines = [row([w.target, ...kinds.map(([, n]) => n)]), row(["---", ...kinds.map(() => "---")])];
  for (const t of [...TARGETS, ...MSVC_TARGETS]) {
    const f = facts.get(t.triple)!;
    const cell = (k: string) => (k === "msan" ? (f.libc === "glibc" ? w.msan : "") : f.sanitizers.includes(k) ? w.yes : "");
    lines.push(row([`\`${t.triple}\``, ...kinds.map(([k]) => cell(k))]));
  }
  return lines.join("\n");
}

const TABLES: Record<string, (lang: Lang, facts: Map<string, Facts>) => string> = { targets, sanitizers };

function markdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? markdown(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

const check = process.argv.includes("--check");
const facts = hosts();
const problems: string[] = [];
let regions = 0;
for (const lang of ["en", "zh"] as const) {
  for (const page of markdown(path.join(ROOT, "docs", lang))) {
    const text = fs.readFileSync(page, "utf8");
    const out = text.replace(
      /^<!-- BEGIN GENERATED: ([\w-]+) -->\n[\s\S]*?^<!-- END GENERATED -->$/gm,
      (_, name: string) => {
        regions++;
        const render = TABLES[name];
        if (!render) {
          problems.push(`${path.relative(ROOT, page)}: no table named ${name}`);
          return _;
        }
        return `<!-- BEGIN GENERATED: ${name} -->\n\n${render(lang, facts)}\n\n<!-- END GENERATED -->`;
      },
    );
    if (out === text) continue;
    if (check) problems.push(`${path.relative(ROOT, page)}: a generated table is not current; run node tests/docs/generate.ts`);
    else fs.writeFileSync(page, out);
  }
}
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  process.exit(1);
}
console.log(`ok: ${regions} generated tables ${check ? "are current" : "written"}`);
