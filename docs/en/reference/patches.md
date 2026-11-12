# LLVM Patches

xclang builds its compiler, linkers, runtimes and libclang from LLVM's
release source, `llvm-project-<version>.src.tar.xz`, with the changes in
[`patches/`](https://github.com/clice-io/xclang/tree/main/patches). Each
patch's README says what goes wrong without it, what it changes, how it was
checked and where it stands upstream.

## Patches

| patch | what it changes |
|---|---|
| [`0001-sema-partial-ordering-depth`](https://github.com/clice-io/xclang/blob/main/patches/0001-sema-partial-ordering-depth/README.md) | partial ordering deduces at the templates' own depth: code completion in a class template no longer crashes clang ([clice#701](https://github.com/clice-io/clice/issues/701)) |
| [`0002-completion-unresolved-member-base`](https://github.com/clice-io/xclang/blob/main/patches/0002-completion-unresolved-member-base/README.md) | member-access completion reports its context when Sema finds no class for the base |
| [`0003-completion-context-base-expr`](https://github.com/clice-io/xclang/blob/main/patches/0003-completion-context-base-expr/README.md) | `CodeCompletionContext::getBaseExpr`, the member base as written |
| [`0004-windows-driver-setup-api-mingw`](https://github.com/clice-io/xclang/blob/main/patches/0004-windows-driver-setup-api-mingw/README.md) | the MinGW-built clang finds Visual Studio 2017 and later through the Setup API, like the MSVC-built one ([clice#714](https://github.com/clice-io/clice/issues/714)) |
| [`0007-lld-macho-empty-section-unwind`](https://github.com/clice-io/xclang/blob/main/patches/0007-lld-macho-empty-section-unwind/README.md) | ld64.lld keeps a function's unwind entry when an empty section's symbol shares its address: ThinLTO programs linked by one clang command catch their exceptions on arm64 macOS |
| [`0008-preprocessed-raw-string-lines`](https://github.com/clice-io/xclang/blob/main/patches/0008-preprocessed-raw-string-lines/README.md) | `clang -E` writes a raw string literal's CRLF line breaks as `\n`, what they mean, and counts its lines: its output, compiled (build caches such as xmake's), gives the same strings and line numbers |
| [`0010-windows-stack-trace`](https://github.com/clice-io/xclang/blob/main/patches/0010-windows-stack-trace/README.md) | crash stack traces on arm64 Windows go past system DLL frames, whose return addresses are signed: a crash in a C library callback, or a trace printed from a signal handler, reaches the code that crashed |
| [`0011-clang-cl-config-pass-through`](https://github.com/clice-io/xclang/blob/main/patches/0011-clang-cl-config-pass-through/README.md) | clang-cl reports no option of a config file unused, also those it passes through with `/clang:`: the MSVC targets' C compiles with `/WX` |
| [`0012-msvc-compiler-rt-libpath-first`](https://github.com/clice-io/xclang/blob/main/patches/0012-msvc-compiler-rt-libpath-first/README.md) | clang links MSVC targets with its own compiler-rt ahead of Visual Studio's `clang_rt.*.lib`: without a fetched SDK, `__int128` division, UBSan and libFuzzer link |
| [`0013-runtime-dir-pc-vendor`](https://github.com/clice-io/xclang/blob/main/patches/0013-runtime-dir-pc-vendor/README.md) | `--target=x86_64-pc-linux-gnu` and `x86_64-pc-windows-gnu`, GCC's spellings, and `arm64-linux-gnu` and `arm64-w64-mingw32` find compiler-rt under the usual spelling: they link |
| [`0014-coff-timestamp-default`](https://github.com/clice-io/xclang/blob/main/patches/0014-coff-timestamp-default/README.md) | COFF objects for MinGW targets have no compile time in their header again, as in LLVM 22 and GNU tools: the same source gives the same object (llvm/llvm-project#222099) |
| [`0016-libcxx-vcruntime`](https://github.com/clice-io/xclang/blob/main/patches/0016-libcxx-vcruntime/README.md) | libc++ on vcruntime defines no `std::nothrow`, the C runtime's, and defines `std::set_new_handler` and `get_new_handler`, which only Microsoft's STL library did |
| [`0017-lld-coff-call-graph-order`](https://github.com/clice-io/xclang/blob/main/patches/0017-lld-coff-call-graph-order/README.md) | lld-link lays out a PGO-built program the same way on every link: local functions of the same name in several objects no longer move from one link to the next |
| [`0018-stdlib-system-config`](https://github.com/clice-io/xclang/blob/main/patches/0018-stdlib-system-config/README.md) | a `-stdlib=` of another library than libc++ (`platform`, `libstdc++`; clang-cl `/clang:-stdlib=platform`) selects the target's `<triple>-system.cfg`: the platform's C++ library, and its sysroot, on every target ([the system's C++ library](../guide/cross-compiling.md#the-platform-s-c-library)) |

## How They Are Applied

`toolchain/common.ts` applies every `patches/NNNN-name/NNNN.patch`, in the
order of the directories, right after it unpacks LLVM's source, with
`patch -p1 -F0 --forward`: without fuzz, so a patch applies where it was
made or the build fails. The runtimes' sources that every toolchain carries
in `libc++/src` get the same patches, those of their files
([runtimes from source](../features/runtimes-from-source.md)). libclang's
`lib/cmake/xclang/libclang.cmake` lists the series in `XCLANG_PATCHES`
([CMake API](cmake-api.md)).

## What a Patch Has

- A directory `patches/NNNN-short-name/` with one `NNNN.patch`, a `git diff`
  against LLVM's release tag, and a `README.md`: what goes wrong and who
  hits it, what the patch changes, its state upstream (`Upstream:`), where
  it came from (`From:`) and how it was checked (`Checked:`).
- A check that fails without it, in `tests/toolchain/smoke.ts` (every
  host's toolchain), `tests/cmake` or `tests/bazel`.
- A number that is never reused: a patch that upstream took is deleted with
  the LLVM release that has it.
