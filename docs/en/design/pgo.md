# PGO

xclang's `clang` and `lld` are built with profile-guided optimization (PGO)
and ThinLTO on all six hosts from a single frontend profile recorded on Linux
x64. On C++ benchmarks in 23.1.2.6, xclang compiles as fast as LLVM's own
PGO+ThinLTO release builds on Linux and macOS and takes 11 to 22% less time
than LLVM's build on Windows x64; in 23.1.2.1, the profile cut C++ compile
times by 16 to 34% compared to the same build without PGO.

## The Training

PGO optimizes the compiler and linker for the code paths exercised during
training. In
[`toolchain/pgo/train.ts`](https://github.com/clice-io/xclang/blob/main/toolchain/pgo/train.ts),
an instrumented Linux x64 build of `clang`, `clang-scan-deps` and `lld`
runs workloads matching both build systems and language servers:

- **C and C++ compiles**: Abseil (`-std=c++20`) and SQLite (`sqlite3.c`,
  `shell.c`) at `-O0 -g` and `-O2` for `x86_64` and `aarch64` Linux, plus
  SQLite with `-O2 -flto=thin` for both Linux targets and at `-O0 -g` and
  `-O2` for `x86_64-w64-mingw32`.
- **Precompiled headers and editor preambles**: one shared precompiled header
  consumed at `-O0 -g`, `-O2` and `-fsyntax-only` with code completion on
  `absl::`, and a preamble extracted from the leading `#include` block of
  each Abseil source file, precompiled once per file and used to parse the
  body and run code completion (`std::`, `absl::`) as an editor does.
- **C++20 modules and P1689 scanning**: `libc++`'s `std` and `std.compat`,
  `magic_enum`, `Vulkan-Hpp` (`vulkan.cppm` and `vulkan_video.cppm` on
  `x86_64`), a wrapped `nlohmann/json` module, a multi-partition `geometry`
  module (`shapes`, `detail`, `algorithms`), and their importers at
  `-std=c++23`. At `-O2`, modules build in two phases (`--precompile` to
  `.pcm`, then `.pcm` to `.o`); at `-O0 -g`, in one phase with reduced module
  files (`-fmodules-reduced-bmi -fmodule-output=`). `clang-scan-deps -format=p1689` scans individual compile commands (as CMake runs it) and a
  whole `compile_commands.json` database for Abseil.
- **Code completion**: `-fsyntax-only -Xclang -code-completion-at=...` across
  Abseil sources, PCH users, preambles and module importers (`std::`,
  `nlohmann::`, `magic_enum::`, `geometry::`, `vk::`, `j.`).
- **Linking**: ELF links (at `-O0 -g`, `-O2`, and `-O2 -flto=thin` for
  `x86_64` and `aarch64` Linux, plus the module programs) and COFF links
  (`x86_64-w64-mingw32` SQLite at `-O0 -g` and `-O2`) through `lld`.

About 1,700 runs in 23 minutes produce one merged profile per release,
published as `xclang-<version>.profdata`
([releases](../reference/releases.md#assets)).

The training corpus does not currently include Objective-C, `clang-cl` and
MSVC-mode parsing, Mach-O links (`ld64.lld`), `aarch64` COFF links,
Windows- or macOS-only host code paths, sanitizer passes, or `libclang`
libraries that `clang` itself does not call (`clang-tidy` checks,
`clangIndex`, `clangIncludeCleaner`). Widening the training corpus to cover
those is [planned](roadmap.md#pgo-training) and happens between releases.

## One Profile for Every Host

`clang` supports two PGO instrumentation modes, which determine whether a
profile recorded on one host can optimize another:

- **IR instrumentation** (`-fprofile-generate`) instruments LLVM IR after
  early optimization passes and hashes each function's control-flow graph at
  that point. Because early passes consult target cost models, the same
  source function can produce different control-flow graphs on `x86_64` and
  `arm64`, so a profile recorded on one architecture does not match the other.
- **Frontend instrumentation** (`-fprofile-instr-generate`, LLVM's
  `LLVM_BUILD_INSTRUMENTED=Frontend`) instruments the `clang` AST and hashes
  each function from its source structure. The same source produces the same
  hash on every target.

xclang uses frontend instrumentation. In experiments before 23.1.2.1, a
profile recorded on Linux x64 matched all but 0 or 1 of 113,000 functions on
each of the six hosts and gave compile times within runner noise of per-host
IR profiles merged from all six hosts (compile time of Abseil / LLVM's `Sema`
relative to no PGO, median of five runners):

| host | frontend, Linux profile | IR, six profiles merged |
|---|---|---|
| Linux x64 | 0.725 / 0.727 | 0.722 / 0.721 |
| Linux arm64 | 0.814 / 0.800 | 0.826 / 0.844 |
| macOS arm64 | 0.905 / 0.818 | 0.895 / 0.864 |
| Windows x64 | 0.771 / 0.792 | 0.764 / 0.820 |

Training therefore runs once on a single Linux x64 runner, and its profile
optimizes all six host toolchains and `libclang` archives without per-host
instrumented builds or emulation.

### The Remapping File

Frontend profiles look up each function by its mangled name, and fixed-width
and pointer-sized integer types mangle differently across LP64 and
LLP64/Darwin ABIs: `size_t` and `uint64_t` are `unsigned long` (`m`) on Linux
but `unsigned long long` (`y`) on Windows (and `uint64_t` is `unsigned long long` on macOS), while `int64_t` is `long` (`l`) on Linux and `long long`
(`x`) on Windows and macOS. Without remapping, functions taking `size_t` or
`uint64_t` have different mangled names on Windows and macOS than in the Linux
profile and receive no profile counts.

[`toolchain/pgo/remap.txt`](https://github.com/clice-io/xclang/blob/main/toolchain/pgo/remap.txt)
maps `type m y` and `type l x` via `-fprofile-remapping-file`. In the same
pre-23.1.2.1 experiments, adding the remapping file improved the Abseil /
`Sema` compile-time ratios on macOS arm64 from `0.896 / 0.923` to
`0.794 / 0.845` and on Windows x64 from `0.787 / 0.824` to `0.772 / 0.829`.

Two small groups of functions are not matched by LLVM's remapper:

- On Windows, 230 functions with integer-literal template arguments of those
  types (1.8% of total counts).
- Functions with internal linkage: 122 on Windows and 39 on macOS (0.06% and
  0.02% of total counts), because frontend profile keys for `static` functions
  have the form `<file>:<mangled>` and the remapper does not strip the
  `<file>:` prefix before parsing the mangled name.

## What It Buys

`bench.yml` (`tests/bench/bench.ts`) measures native compile times on runners
of each host using code that is not in the training corpus:

- ten of `fmt`'s tests (template-heavy C++20);
- the C source files of `lua`;
- precompiling `libc++`'s `std` module.

Each workload is compiled at `-fsyntax-only`, `-O0 -g` and `-O2`, one file at
a time. Rounds interleave the compilers in rotating order on the same runner,
taking the median across rounds on each machine and then the median of each
machine's ratio to the reference across runners. Differences of a few percent
are within runner noise.

The reference compiler is LLVM's official release build of the same version:
built with PGO and ThinLTO on Linux and macOS (plus BOLT on Linux x64; BOLT
for xclang's Linux hosts is [in research](roadmap.md#bolt)), and with PGO
without LTO on Windows. Because LLVM publishes no `x86_64` macOS binary,
xclang itself is the reference on `x86_64` macOS.

### 23.1.2.6

Compile time relative to LLVM 23.1.2's release build, median of five runners
per host, 2026-10-06
([run 37356476645](https://github.com/clice-io/xclang/actions/runs/37356476645),
measuring the published 23.1.2.6 archives; Linux x64 has four runners because
one job failed while listing sizes before benchmarking). The `llvm.exe` rows
invoke `llvm.exe clang++` directly without the `clang++.exe` launcher:

| host | fmt (syntax / O0 / O2) | lua (syntax / O0 / O2) | std (O0 / O2) |
|---|---|---|---|
| Linux x64 | 1.035 / 1.009 / 1.069 | 1.118 / 1.062 / 1.109 | 1.013 / 1.022 |
| Linux arm64 | 1.000 / 0.976 / 1.042 | 1.082 / 1.011 / 1.075 | 0.970 / 0.994 |
| macOS arm64 | 0.902 / 0.935 / 1.014 | 1.169 / 0.971 / 0.959 | 0.980 / 0.890 |
| Windows x64 | 0.798 / 0.825 / 0.890 | 1.083 / 1.050 / 1.001 | 0.777 / 0.849 |
| Windows x64, `llvm.exe` | 0.798 / 0.809 / 0.885 | 0.968 / 0.960 / 0.974 | 0.821 / 0.844 |
| Windows arm64 | 0.888 / 0.906 / 0.954 | 1.271 / 1.212 / 1.167 | 0.925 / 0.940 |
| Windows arm64, `llvm.exe` | 0.860 / 0.898 / 0.947 | 1.019 / 1.065 / 1.056 | 0.915 / 0.932 |

Apple's `clang` ran on the same macOS runners: on `arm64`, relative to LLVM's
build, it took `1.097 / 1.207 / 1.206` on `fmt` and `0.879 / 0.875 / 1.004`
on `lua`; on `x86_64`, relative to xclang, it took `1.168 / 1.223 / 1.221` on
`fmt` and `0.841 / 0.973 / 0.990` on `lua`.

Summary of the 23.1.2.6 measurements:

- **Linux and macOS**: on C++, xclang matches LLVM's PGO+ThinLTO builds; on
  `lua`'s small C files it takes up to 17% longer. On Linux x64, where LLVM's
  binary is also BOLT-optimized, xclang takes up to 7% longer on C++ and 12%
  longer on C.
- **Windows**: compared to LLVM's MSVC-built `clang` (PGO without LTO),
  xclang's MinGW-built `clang` (PGO and ThinLTO) takes 11 to 22% less time on
  C++ on x64 and 5 to 11% less on arm64.
- **Windows launcher overhead**: `lua`'s C files each compile in a few dozen
  milliseconds, so spawning `clang++.exe` before `llvm.exe` adds up to 12% on
  x64 and 25% on arm64 compared to running `llvm.exe clang++` directly; on
  C++ files, the process-start cost is negligible
  ([the launchers](windows.md#the-launchers)).
- **Apple's `clang`**: takes 17 to 29% more time than xclang on `fmt` across
  both macOS architectures, and between 25% less and 5% more on `lua`.

### 23.1.2.1

Compile time relative to LLVM 23.1.2's release build, median of three runners
([run 36249036595](https://github.com/clice-io/xclang/actions/runs/36249036595)
for Linux and macOS,
[run 36250216010](https://github.com/clice-io/xclang/actions/runs/36250216010)
for Windows), including the same xclang build compiled without its PGO profile
(`no PGO, fmt`):

| host | fmt (syntax / O0 / O2) | lua | std (O0 / O2) | no PGO, fmt |
|---|---|---|---|---|
| Linux x64 | 1.031 / 1.006 / 1.046 | 1.106 / 1.061 / 1.098 | 1.047 / 1.022 | 1.279 / 1.250 / 1.244 |
| Linux arm64 | 0.972 / 0.957 / 1.018 | 1.012 / 0.968 / 1.050 | 0.959 / 0.964 | 1.283 / 1.237 / 1.272 |
| macOS arm64 | 0.986 / 0.983 / 1.050 | 0.948 / 0.804 / 0.994 | 0.860 / 0.955 | 1.367 / 1.323 / 1.353 |
| Windows x64 | 0.809 / 0.830 / 0.893 | 1.075 / 1.049 / 1.041 (`llvm.exe`: 1.044 / 0.987 / 1.020) | 0.885 / 1.021 | 1.226 / 1.155 / 1.227 |
| Windows arm64 | 0.899 / 0.916 / 0.958 | 1.332 / 1.238 / 1.187 (`llvm.exe`: 1.090 / 1.058 / 1.079) | 0.944 / 0.939 | 1.178 / 1.150 / 1.162 |

- **Effect of the profile**: without PGO, the same ThinLTO build took 1.15 to
  1.37 times as long as LLVM's release build on `fmt`; with the Linux frontend
  profile, compile time dropped by 16 to 34%.
- **`x86_64` macOS runner noise**: on `macos-15-intel`, the noisiest of the
  six runner types, 23.1.2.1 without PGO measured `0.84` to `1.12` relative to
  xclang with PGO and Apple's `clang` measured `0.89` to `1.08` on `fmt`
  (`0.57` to `0.87` on `lua`), whereas in 23.1.2.6's five-runner run Apple's
  `clang` was 17 to 22% slower on `fmt`. Whether PGO helps the cross-compiled
  `x86_64` macOS host binary on Intel Macs is not established beyond runner
  noise.
