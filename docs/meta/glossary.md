# Translating the xclang docs into Chinese

docs/zh is a translation of docs/en, page by page and segment by segment.
The contract and the general wording rules are clice-io/docs's
tools/translations/RULES.md at v1.0.0 (`node tests/docs/translations.ts`
checks it out under .cache/ and runs its checker). This page adds what is
xclang's: its page conventions and its terms.

## Page conventions

- **Code stays as it is.** Code blocks, the `<!-- file: -->`,
  `<!-- excerpt: -->` and `<!-- not run: -->` markers, code spans, link
  targets and URLs are byte for byte the English page's. Comments inside
  code blocks stay English: they are part of the files CI runs.
- **Headings** are translated, and every heading but the page's title ends
  in `{#id}`, the id of the English heading in its place (its slug, as
  `tests/docs/docs.ts` names it), so links and anchors work on both sites:
  `## 构建其他目标平台的程序 {#build-for-another-target}`. A heading that is
  an identifier (`xclang sdk fetch`, `toolchain.cmake`) stays as it is.
- **Status words** in a table's status column (状态) are the roadmap's,
  translated one way: Supported → 已支持, Unreleased → 未发布, Planned → 计划中,
  In research → 研究中, Considered → 考虑中, Not planned → 不计划.
- **Sidebar labels** are in docs/zh/sidebar.yaml: 指南, 目标平台, 构建系统,
  功能, 参考, 设计.

## Terms

Keep in English, never transliterated: xclang, clang, clang-cl, lld,
ld64.lld, lld-link, LLVM, libc++, libc++abi, libunwind, compiler-rt,
libclang, glibc, musl, MinGW, mingw-w64, UCRT, MSVC, STL, Xcode, CMake,
Bazel, Meson, Make, Ninja, cargo, rustup, pixi, conda, GitHub Actions;
PGO, LTO, ThinLTO, BOLT, ABI, CRT, SDK, DLL, PDB, DWARF, GSYM, dSYM, BMI;
ASan, TSan, LSan, UBSan, MSan, libFuzzer; sysroot, sanitizer, profile (of
PGO), tier (Tier 1, Tier 2, Tier 3), triple, runner, repack.

Translate, one way within a page:

| English | 中文 |
|---|---|
| toolchain, toolchain directory | 工具链，工具链目录 |
| target (a platform built for) | 目标平台；short: 目标 |
| host | 主机 |
| cross-compiling | 交叉编译 |
| release; revision | 版本（发布）；修订号 |
| archive (`.tar.xz`) | 压缩包 |
| asset (of a GitHub release) | 发布文件 |
| runtimes (libc++, libunwind, compiler-rt) | 运行时库 |
| config file (clang's `.cfg`) | 配置文件 |
| vendor SDK | 厂商 SDK |
| hermetic, hermeticity | 封闭的，封闭性（hermeticity） |
| static, statically linked | 静态，静态链接 |
| shared library, shared object | 共享库 |
| module file | 模块文件 |
| build cache | 构建缓存 |
| debug information, debug symbols | 调试信息，调试符号 |
| linker; link | 链接器；链接 |
| the platform's C++ library | 平台的 C++ 标准库 |
| known limitations | 已知限制 |
| registry (Bazel's); repository (Bazel's) | registry；仓库 |

## Style

Natural technical Chinese, as a developer writes it, not translated
English:

- Say what the English says, not word for word. Split long English
  clauses; drop "这个" as an article and "该" as a demonstrative (该版本 →
  这个版本, or 它), 进行/对于/通过……的方式 stacks and
  passive chains.
- No calques: 服务所有的 checkout → 所有机器共用一份缓存; 相同的字节 → 逐字节相同;
  导入者 → import 它的文件; 这意味着 → 也就是说; 为了做到这一点 → 做法是.
- No filler or drama: 深入, 强大, 无缝, 赋能, 极大地, 显著地, 值得注意的是, 总而言之,
  综上所述, 恰恰, 悄无声息, 真正地, 所谓, 一律, 从不, 永远 where the English has
  no such absolute.
- Full-width punctuation in Chinese sentences, a space between CJK and
  Latin text or code, 「」 for quotes.
