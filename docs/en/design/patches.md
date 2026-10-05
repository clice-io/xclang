# Patches

xclang builds LLVM's release source with the changes in
[`patches/`](https://github.com/clice-io/xclang/tree/main/patches), one directory each: the patch and a README on
what it changes, why, how it was checked, and its state upstream. They are
applied in the order of the directories right after the source is
unpacked, so a tag's workflow, run again, builds the same thing; libclang's
manifest lists them (`XCLANG_PATCHES` in `lib/cmake/xclang/libclang.cmake`).

| | |
|---|---|
| [`0001-sema-partial-ordering-depth`](https://github.com/clice-io/xclang/blob/main/patches/0001-sema-partial-ordering-depth/README.md) | partial ordering deduces at the templates' own depth: code completion in a class template no longer crashes clang ([clice#701](https://github.com/clice-io/clice/issues/701)) |
| [`0002-completion-unresolved-member-base`](https://github.com/clice-io/xclang/blob/main/patches/0002-completion-unresolved-member-base/README.md) | member-access completion reports its context when Sema finds no class for the base |
| [`0003-completion-context-base-expr`](https://github.com/clice-io/xclang/blob/main/patches/0003-completion-context-base-expr/README.md) | `CodeCompletionContext::getBaseExpr`, the member base as written |
| [`0004-windows-driver-setup-api-mingw`](https://github.com/clice-io/xclang/blob/main/patches/0004-windows-driver-setup-api-mingw/README.md) | the MinGW-built clang finds Visual Studio 2017 and later through the Setup API, like the MSVC-built one ([clice#714](https://github.com/clice-io/clice/issues/714)) |
| [`0006-libcxx-format-buffer-full`](https://github.com/clice-io/xclang/blob/main/patches/0006-libcxx-format-buffer-full/README.md) | `std::format_to` into a container no longer writes past its 256-code-unit stack buffer after an argument whose length is a multiple of 256 |
| [`0007-lld-macho-empty-section-unwind`](https://github.com/clice-io/xclang/blob/main/patches/0007-lld-macho-empty-section-unwind/README.md) | ld64.lld keeps a function's unwind entry when an empty section's symbol shares its address: ThinLTO programs linked by one clang command catch their exceptions on arm64 macOS |
| [`0008-preprocessed-raw-string-lines`](https://github.com/clice-io/xclang/blob/main/patches/0008-preprocessed-raw-string-lines/README.md) | `clang -E` writes a raw string literal's CRLF line breaks as `\n`, what they mean, and counts its lines: its output, compiled (build caches such as xmake's), gives the same strings and line numbers |
| [`0009-textapi-arm64e-x1`](https://github.com/clice-io/xclang/blob/main/patches/0009-textapi-arm64e-x1/README.md) | ld64.lld reads the macOS 27 SDK's `.tbd` stubs, which list `arm64e.x1`: macOS programs link against Xcode 27's SDK (release/23.x's backport, in 23.1.3) |

0005 (ASan's container checks in libc++'s ODR signature) was in 23.1.2.3
and 23.1.2.4; libc++'s ASan build replaced it in 23.1.2.5.
[CHANGELOG.md](https://github.com/clice-io/xclang/blob/main/CHANGELOG.md) has which release took which patch.
