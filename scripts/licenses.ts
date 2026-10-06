/// The license notices every archive carries in share/licenses: per
/// component, its license files in share/licenses/<component>/, and for all
/// of them a README.md (what each is, its version, license and source) and
/// sbom.spdx.json, the same as an SPDX 2.3 document. The files come from the
/// pinned sources (scripts/common.ts' SOURCES), the pixi environment's
/// glibc sysroots, licenses/ (what no source ships: the Linux UAPI headers',
/// NSS's) and, for the xclang command, what scripts/cli.ts collected from
/// its crates.

import fs from "node:fs";
import path from "node:path";
import * as common from "./common.ts";

export interface Component {
  /// Its directory in share/licenses.
  name: string;
  /// What of the archive it is.
  what: string;
  version: string;
  /// SPDX license expression.
  license: string;
  /// Where its source is, most exact first.
  source: string[];
  /// Its license files: name in its directory -> the file to copy.
  files: Record<string, string>;
}

/// The time the archives are made of: SOURCE_DATE_EPOCH, else the commit's.
export function sourceDate(): Date {
  const epoch = process.env.SOURCE_DATE_EPOCH ??
    common.capture("git", ["-C", common.ROOT, "log", "-1", "--format=%ct"]).trim();
  if (!/^\d+$/.test(epoch)) common.fail(`no time of the commit (SOURCE_DATE_EPOCH or git log): ${epoch}`);
  return new Date(Number(epoch) * 1000);
}

/// Members of a pinned source, unpacked once into work/src/licenses/<name>.
async function fromSource(name: common.Source, members: string[]): Promise<string> {
  const dir = path.join(common.WORK, "src", "licenses", name);
  if (!members.every((m) => fs.existsSync(path.join(dir, m)))) {
    fs.rmSync(dir, { recursive: true, force: true });
    common.extract(await common.fetchSource(name), dir, (m) => members.includes(m));
  }
  const missing = members.filter((m) => !fs.existsSync(path.join(dir, m)));
  if (missing.length) common.fail(`not in ${name}: ${missing.join(", ")}`);
  return dir;
}

async function filesOf(name: common.Source, members: string[]): Promise<Record<string, string>> {
  const dir = await fromSource(name, members);
  return Object.fromEntries(members.map((m) => [m, path.join(dir, m)]));
}

export function xclang(version: string, what: string): Component {
  return {
    name: "xclang",
    what,
    version,
    license: "Apache-2.0",
    source: [`https://github.com/clice-io/xclang/tree/${version}`],
    files: { LICENSE: path.join(common.ROOT, "LICENSE") },
  };
}

/// LLVM's license, its sub-projects' (the same text), and the third-party
/// code in what is built of it: the regex engine and BLAKE3 of LLVMSupport,
/// clang-tidy's CERT checks.
const LLVM_FILES = [
  "LICENSE.TXT",
  ...["llvm", "clang", "clang-tools-extra", "lld", "compiler-rt", "libcxx", "libcxxabi", "libunwind"]
    .map((p) => `${p}/LICENSE.TXT`),
  "llvm/include/llvm/Support/LICENSE.TXT",
  "llvm/lib/Support/COPYRIGHT.regex",
  "llvm/lib/Support/BLAKE3/LICENSE",
  "clang-tools-extra/clang-tidy/cert/LICENSE.TXT",
];

export async function llvmProject(what: string): Promise<Component> {
  return {
    name: "llvm-project",
    what,
    version: common.LLVM_VERSION,
    license: "(Apache-2.0 WITH LLVM-exception OR NCSA) AND Spencer-94 AND (CC0-1.0 OR Apache-2.0)",
    source: [common.SOURCES["llvm-project"].url, "with xclang's patches: patches/ of the tag"],
    files: await filesOf("llvm-project", LLVM_FILES),
  };
}

/// zlib and zstd, linked statically; macOS has zlib in the system.
export async function compression(host: common.Target): Promise<Component[]> {
  return [
    ...host.os === "darwin" ? [] : [{
      name: "zlib",
      what: "linked into LLVM's programs and libraries (lib/libz.a in libclang)",
      version: "1.3.1",
      license: "Zlib",
      source: [common.SOURCES.zlib.url],
      files: await filesOf("zlib", ["LICENSE"]),
    }],
    {
      name: "zstd",
      what: "linked into LLVM's programs and libraries (lib/libzstd.a in libclang)",
      version: "1.5.7",
      license: "BSD-3-Clause OR GPL-2.0-only",
      source: [common.SOURCES.zstd.url],
      files: await filesOf("zstd", ["LICENSE", "COPYING"]),
    },
  ];
}

/// mingw-w64's notices: the headers and CRT (ZPL 2.1, with the runtime's
/// other parts in COPYING.MinGW-w64-runtime.txt), the profiling library
/// (libgmon.a, BSD code taken from Cygwin, whose license comes with it),
/// the DDK headers (from ReactOS), winpthreads.
const MINGW_FILES = [
  "COPYING",
  "COPYING.MinGW-w64/COPYING.MinGW-w64.txt",
  "COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt",
  "DISCLAIMER",
  "DISCLAIMER.PD",
  "mingw-w64-crt/profile/COPYING",
  "mingw-w64-crt/profile/CYGWIN_LICENSE",
  "mingw-w64-headers/ddk/readme.txt",
  "mingw-w64-libraries/winpthreads/COPYING",
];

export async function mingwW64(what: string): Promise<Component> {
  return {
    name: "mingw-w64",
    what,
    version: common.MINGW_VERSION,
    license: "ZPL-2.1 AND ISC AND BSD-2-Clause AND BSD-3-Clause AND MIT AND SunPro AND LGPL-2.1-or-later AND " +
      "LicenseRef-gdtoa AND LicenseRef-Public-Domain",
    source: [common.SOURCES["mingw-w64"].url],
    files: await filesOf("mingw-w64", MINGW_FILES),
  };
}

/// The conda packages of the pixi environment the Linux sysroots come from
/// (scripts/sysroot.ts), as conda-meta records them.
function condaPackages(pattern: RegExp): string[] {
  const prefix = process.env.CONDA_PREFIX;
  if (!prefix) common.fail("the Linux sysroots' notices come from the pixi environment (CONDA_PREFIX is unset)");
  const meta = path.join(prefix, "conda-meta");
  const found = fs.readdirSync(meta).filter((f) => pattern.test(f)).sort().map((f) => {
    const record = JSON.parse(fs.readFileSync(path.join(meta, f), "utf8"));
    return `conda-forge's ${record.name} ${record.version} ${record.build}: ${record.url} (sha256 ${record.sha256})`;
  });
  if (found.length !== 2) common.fail(`expected the packages of both Linux targets in ${meta}, found ${found.join("; ")}`);
  return found;
}

/// What CentOS 7's RPMs, which conda-forge's sysroot packages repackage
/// (github.com/conda-forge/linux-sysroot-feedstock), were built from: the
/// packages of build 18 hold glibc-2.17-317.el7, kernel-headers
/// 3.10.0-1160.el7 (x86_64) and 4.18.0-193.28.1.el7 (aarch64), and
/// nss-softokn-freebl 3.44.0-8.el7_7.
const SYSROOT_BUILDS = ["h0157908_18", "h68829e0_18"];

/// The glibc of the Linux targets, the kernel's UAPI headers next to it,
/// and NSS's libfreebl3, which glibc's libcrypt loads.
export function linuxSysroots(): Component[] {
  const prefix = process.env.CONDA_PREFIX ?? "";
  const sysroots = condaPackages(/^sysroot_linux-(64|aarch64)-2\.17-.*\.json$/);
  if (!SYSROOT_BUILDS.every((b) => sysroots.some((s) => s.includes(` ${b}:`)))) {
    common.fail(`the sources named in scripts/licenses.ts are those of the sysroot packages ${SYSROOT_BUILDS.join(", ")}, ` +
      `not of ${sysroots.join("; ")}`);
  }
  const doc = path.join(prefix, "x86_64-conda-linux-gnu", "sysroot", "usr", "share", "doc", "glibc-2.17");
  const vendored = (dir: string) => Object.fromEntries(fs.readdirSync(path.join(common.ROOT, "licenses", dir))
    .sort().map((f) => [f, path.join(common.ROOT, "licenses", dir, f)]));
  return [
    {
      name: "glibc",
      what: "glibc 2.17: the headers, startup files and libraries of the Linux targets",
      version: "2.17-317.el7",
      license: "LGPL-2.1-or-later",
      source: [
        "https://vault.centos.org/7.9.2009/os/Source/SPackages/glibc-2.17-317.el7.src.rpm",
        "https://ftp.gnu.org/gnu/glibc/glibc-2.17.tar.xz, with CentOS 7's patches (the source RPM)",
        ...sysroots,
      ],
      files: Object.fromEntries(["COPYING", "COPYING.LIB", "LICENSES"].map((f) => [f, path.join(doc, f)])),
    },
    {
      name: "linux",
      what: "the Linux kernel's UAPI headers in the Linux targets' usr/include",
      version: "3.10.0-1160.el7 (x86_64), 4.18.0-193.28.1.el7 (aarch64)",
      license: "GPL-2.0-only WITH Linux-syscall-note",
      source: [
        "https://vault.centos.org/7.9.2009/os/Source/SPackages/kernel-3.10.0-1160.el7.src.rpm",
        "https://cdn.kernel.org/pub/linux/kernel/v3.x/linux-3.10.tar.xz",
        "https://cdn.kernel.org/pub/linux/kernel/v4.x/linux-4.18.tar.xz, as CentOS 7 AltArch's kernel 4.18.0-193.28.1.el7",
        ...condaPackages(/^kernel-headers_linux-(64|aarch64)-.*\.json$/),
      ],
      files: vendored("linux"),
    },
    {
      name: "nss",
      what: "NSS's libfreebl3.so in the Linux targets' usr/lib64, which glibc's libcrypt loads",
      version: "3.44.0-8.el7_7",
      license: "MPL-2.0",
      source: ["https://vault.centos.org/7.9.2009/os/Source/SPackages/nss-softokn-3.44.0-8.el7_7.src.rpm", ...sysroots],
      files: vendored("nss"),
    },
  ];
}

/// The xclang command's components as scripts/cli.ts recorded them in
/// <dir>/components.json, their files below <dir>.
export function collected(dir: string): Component[] {
  const components = JSON.parse(fs.readFileSync(path.join(dir, "components.json"), "utf8")) as Component[];
  return components.map((c) => ({
    ...c,
    files: Object.fromEntries(Object.keys(c.files).map((f) => [f, path.join(dir, c.name, f)])),
  }));
}

/// The README and SPDX document's LicenseRefs.
const REFS: Record<string, string> = {
  "LicenseRef-gdtoa": "David M. Gay's gdtoa license, in mingw-w64/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt",
  "LicenseRef-Public-Domain": "parts in the public domain, as mingw-w64/DISCLAIMER.PD says",
};

/// share/licenses of an archive whose files are under `root`.
export function write(root: string, archive: string, version: string, components: Component[], date: Date): void {
  const dest = path.join(root, "share", "licenses");
  fs.rmSync(dest, { recursive: true, force: true });
  const names = new Set<string>();
  for (const c of components) {
    if (names.has(c.name)) common.fail(`two components named ${c.name}`);
    names.add(c.name);
    for (const [name, from] of Object.entries(c.files)) {
      if (!fs.existsSync(from)) common.fail(`${c.name}: no ${from}`);
      const to = path.join(dest, c.name, name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  const cell = (s: string) => s.replaceAll("|", "\\|");
  fs.writeFileSync(path.join(dest, "README.md"), [
    `# What ${archive} holds`,
    "",
    "Every component, under the license of its files in the directory of its",
    "name here, and where its source is. sbom.spdx.json says the same as an",
    "SPDX 2.3 document.",
    "",
    "| directory | what | version | license | source |",
    "|---|---|---|---|---|",
    ...components.map((c) => `| ${c.name}/ | ${cell(c.what)} | ${cell(c.version)} | ${cell(c.license)} | ${c.source.map(cell).join("<br>")} |`),
    "",
    ...Object.entries(REFS).filter(([ref]) => components.some((c) => c.license.includes(ref)))
      .map(([ref, text]) => `${ref}: ${text}.`),
    "",
  ].join("\n"));
  const id = (name: string) => `SPDXRef-${name.replace(/[^A-Za-z0-9.-]/g, "-")}`;
  const download = (c: Component) => c.source.find((s) => /^https:\/\/\S+$/.test(s)) ?? "NOASSERTION";
  const spdx = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: archive,
    documentNamespace: `https://github.com/clice-io/xclang/releases/download/${version}/${archive}.tar.xz`,
    creationInfo: { created: date.toISOString().replace(/\.\d+Z$/, "Z"), creators: ["Tool: xclang-scripts/package.ts"] },
    packages: [
      {
        SPDXID: id(archive),
        name: archive,
        versionInfo: version,
        downloadLocation: `https://github.com/clice-io/xclang/releases/download/${version}/${archive}.tar.xz`,
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        copyrightText: "NOASSERTION",
      },
      ...components.map((c) => ({
        SPDXID: id(c.name),
        name: c.name,
        versionInfo: c.version,
        downloadLocation: download(c),
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: c.license,
        copyrightText: "NOASSERTION",
        comment: `${c.what}. Source: ${c.source.join("; ")}. License files: share/licenses/${c.name}/.`,
      })),
    ],
    hasExtractedLicensingInfos: Object.entries(REFS).filter(([ref]) => components.some((c) => c.license.includes(ref)))
      .map(([ref, text]) => ({ licenseId: ref, extractedText: text })),
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: id(archive) },
      ...components.map((c) => ({ spdxElementId: id(archive), relationshipType: "CONTAINS", relatedSpdxElement: id(c.name) })),
    ],
  };
  fs.writeFileSync(path.join(dest, "sbom.spdx.json"), JSON.stringify(spdx, null, 2) + "\n");
}

/// What is wrong with the share/licenses of the archive unpacked at root:
/// a component of `expected` missing from its SPDX document, or one without
/// its directory of files.
export function check(root: string, expected: string[]): string[] {
  const dest = path.join(root, "share", "licenses");
  const file = path.join(dest, "sbom.spdx.json");
  if (!fs.existsSync(file) || !fs.existsSync(path.join(dest, "README.md"))) return [`no README.md and sbom.spdx.json in ${dest}`];
  const names = (JSON.parse(fs.readFileSync(file, "utf8")).packages as { name: string; comment?: string }[])
    .filter((p) => p.comment).map((p) => p.name);
  return [
    ...expected.filter((n) => !names.some((m) => m === n || m.startsWith(`${n}/`))).map((n) => `no ${n} in ${file}`),
    ...names.filter((n) => !fs.existsSync(path.join(dest, n))).map((n) => `no ${path.join(dest, n)}`),
  ];
}
