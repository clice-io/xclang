# PGO

xclang's clang and lld are built with profile-guided optimization (PGO)
and ThinLTO on every host, from one profile recorded on Linux. This page
is the home of xclang's speed measurements; each names its release.

## Summary

The profile comes from compiling real code the way builds and editors do.
Frontend instrumentation makes one profile, recorded on Linux, fit all six
hosts. On C++, 23.1.2.6 compiles as fast as LLVM's own release builds on
Linux and macOS, and takes 11 to 22% less time than LLVM's build on Windows
x64. In 23.1.2.1, the same build without the profile took 1.15 to 1.37
times as long as LLVM's.

## The Training

PGO optimizes a program for the work it was profiled on, so the training
set decides what gets faster. xclang's instrumented clang, clang-scan-deps
and lld do the work the toolchain is used for, by builds and by editors
([pgo/train.ts](https://github.com/clice-io/xclang/blob/main/pgo/train.ts)):

- C and C++ sources (sqlite, abseil) at `-O0 -g` and `-O2`, for x86_64 and
  aarch64 Linux.
- Precompiled headers: one shared header, and the preamble of every abseil
  source. An editor precompiles a preamble once per file, then parses the
  rest of the file and runs code completion on it.
- C++20 modules: libc++'s `std` and `std.compat`, real ones (magic_enum,
  and Vulkan-Hpp's, the largest in common use), a wrapped header-only
  library (nlohmann/json), a module of partitions, and their importers.
  They build in two phases at `-O2`, and in one phase with reduced module
  files at `-O0 -g`. The P1689 dependency scanning runs as CMake runs it.
- Code completion requests.
- ELF, ThinLTO and COFF (MinGW) links through lld.

About 1700 compiler runs in 23 minutes give one profile per release. It is
published with the release (`xclang-<version>.profdata`).

**Not in the training**: Objective-C, clang-cl and MSVC-mode parsing,
Mach-O links and ld64.lld, aarch64 COFF links, and code paths that only run
on a Windows or macOS host. The sanitizers are not in it either, nor the
libraries in libclang that clang itself does not use (clang-tidy's,
clangIndex, IncludeCleaner). That code gets the layout and inlining the
profile gives it from the rest, not tuned for itself.

## One Profile for Every Host

clang has two kinds of instrumentation. The choice decides whether a
profile recorded on one host fits another.

- **IR instrumentation** (`-fprofile-generate`) counts on LLVM IR after
  early optimization passes. It identifies a function by a hash of its
  control flow graph at that point. Those passes use the cost models of
  the target, so the same function has a different control flow on x86_64
  and arm64. A profile recorded on one does not match the other.
- **Frontend instrumentation** (`-fprofile-instr-generate`, LLVM's
  `LLVM_BUILD_INSTRUMENTED=Frontend`) counts on the clang AST, and hashes
  a function from its source. The same source gives the same hash on every
  target.

xclang uses frontend instrumentation. In experiments before 23.1.2.1, a
profile recorded on Linux x64 matched all but 0 or 1 of 113,000 functions
on each of the six hosts. The speed it gave was within noise of per-host
IR profiles merged from all six. The table gives the compile time of
abseil / LLVM's `Sema`, relative to no PGO, as the median of five runners:

| host | frontend, Linux profile | IR, six profiles merged |
|---|---|---|
| Linux x64 | 0.725 / 0.727 | 0.722 / 0.721 |
| Linux arm64 | 0.814 / 0.800 | 0.826 / 0.844 |
| macOS arm64 | 0.905 / 0.818 | 0.895 / 0.864 |
| Windows x64 | 0.771 / 0.792 | 0.764 / 0.820 |

So the training runs once, on one Linux runner, and its profile builds
every host's toolchain. There is no instrumented build or training per
host, no emulation, and the same profile everywhere.

### The Remapping File

A function's profile is found by its mangled name, and the same source type
mangles differently across ABIs. `size_t` and `uint64_t` are
`unsigned long` (`m`) on Linux but `unsigned long long` (`y`) on Windows,
and `uint64_t` is `unsigned long long` on macOS too. `int64_t` differs the
same way, `l` against `x`. A function taking a `size_t` thus has another
name on Windows than in the Linux profile, and gets no counts.

[pgo/remap.txt](https://github.com/clice-io/xclang/blob/main/pgo/remap.txt)
tells clang that these manglings are the same (`-fprofile-remapping-file`).
In the same experiments, it took macOS arm64 from 0.896 / 0.923 to
0.794 / 0.845, and Windows x64 from 0.787 / 0.824 to 0.772 / 0.829.

Some functions the remapping cannot match:

- On Windows, 230 functions whose template arguments are integer literals
  of those types, 1.8% of the counts.
- Functions with internal linkage: 122 on Windows and 39 on macOS, 0.06%
  and 0.02% of the counts. Frontend profile names of local functions are
  `<file>:<mangled>`, and LLVM's remapper does not split the file name
  off.

Neither is reported upstream.

## What It Buys

bench.yml times compiles on machines of each host, for that host's target
(tests/bench.ts). The code is code the training never saw:

- ten of fmt's tests: heavy templates, C++20;
- the C sources of lua;
- precompiling libc++'s `std` module.

Each is compiled at `-fsyntax-only`, `-O0 -g` and `-O2`. Every file is
compiled alone, one after another. Rounds interleave the compilers in a
rotating order on the same machine, and the median of the rounds is taken.
The report is the median, over several machines, of each machine's ratio to
the reference. Runner noise is large: read a difference of a few percent
as none.

The reference is LLVM's own release build of the same version. LLVM builds
it with PGO and ThinLTO on Linux and macOS, BOLT-optimized on Linux x64,
and with PGO but no LTO on Windows. LLVM has no build for x86_64 macOS;
there, the reference is xclang itself.

### 23.1.2.6

Time relative to LLVM 23.1.2's release build, median of five runners per
host, 2026-10-06
([run 37356476645](https://github.com/clice-io/xclang/actions/runs/37356476645),
23.1.2.6's own archives, nothing rebuilt). Linux x64 has four runners,
because one job failed listing sizes, before measuring. The `llvm.exe` rows
run xclang's Windows clang directly instead of through the `clang++.exe`
launcher.

| host | fmt (syntax / O0 / O2) | lua (syntax / O0 / O2) | std (O0 / O2) |
|---|---|---|---|
| Linux x64 | 1.035 / 1.009 / 1.069 | 1.118 / 1.062 / 1.109 | 1.013 / 1.022 |
| Linux arm64 | 1.000 / 0.976 / 1.042 | 1.082 / 1.011 / 1.075 | 0.970 / 0.994 |
| macOS arm64 | 0.902 / 0.935 / 1.014 | 1.169 / 0.971 / 0.959 | 0.980 / 0.890 |
| Windows x64 | 0.798 / 0.825 / 0.890 | 1.083 / 1.050 / 1.001 | 0.777 / 0.849 |
| Windows x64, `llvm.exe` | 0.798 / 0.809 / 0.885 | 0.968 / 0.960 / 0.974 | 0.821 / 0.844 |
| Windows arm64 | 0.888 / 0.906 / 0.954 | 1.271 / 1.212 / 1.167 | 0.925 / 0.940 |
| Windows arm64, `llvm.exe` | 0.860 / 0.898 / 0.947 | 1.019 / 1.065 / 1.056 | 0.915 / 0.932 |

Apple's clang ran on the same runners. On arm64, relative to LLVM's build,
it took fmt 1.097 / 1.207 / 1.206 and lua 0.879 / 0.875 / 1.004. On
x86_64, where LLVM has no build, relative to xclang, it took fmt
1.168 / 1.223 / 1.221 and lua 0.841 / 0.973 / 0.990.

What the numbers say, read loosely:

- **Linux and macOS**: on C++, xclang is as fast as LLVM's own PGO and
  ThinLTO builds. On lua's C it takes up to 17% more time. On Linux x64,
  whose LLVM clang is also BOLT-optimized, xclang takes up to 7% more time
  on C++ and 12% on C.
- **Windows**: against LLVM's MSVC-built clang (PGO, no LTO), xclang's
  MinGW-built clang with PGO and ThinLTO takes 11 to 22% less time on C++
  on x64, and 5 to 11% less on arm64.
- **The Windows launcher costs a process.** lua's sources are small C
  files, each compiled in a few dozen milliseconds. Starting `clang++.exe`,
  which then starts `llvm.exe`, is a visible part of that time: up to 12%
  more on x64 and 25% more on arm64 than running `llvm.exe clang++`
  directly. On C++ with real work per file, it does not show
  ([the launchers](windows.md#the-launchers)).
- **Apple's clang** takes 17 to 29% more time than xclang on fmt, on both
  macOS architectures. On lua's C, it takes between 25% less and 5% more.

### 23.1.2.1

Time relative to LLVM 23.1.2's release build, median of three runners
([run 36249036595](https://github.com/clice-io/xclang/actions/runs/36249036595)
for Linux and macOS,
[run 36250216010](https://github.com/clice-io/xclang/actions/runs/36250216010)
for Windows). "no PGO" is the same build without the profile; `llvm.exe`
runs xclang's Windows clang without the launcher.

| host | fmt (syntax / O0 / O2) | lua | std (O0 / O2) | no PGO, fmt |
|---|---|---|---|---|
| Linux x64 | 1.031 / 1.006 / 1.046 | 1.106 / 1.061 / 1.098 | 1.047 / 1.022 | 1.279 / 1.250 / 1.244 |
| Linux arm64 | 0.972 / 0.957 / 1.018 | 1.012 / 0.968 / 1.050 | 0.959 / 0.964 | 1.283 / 1.237 / 1.272 |
| macOS arm64 | 0.986 / 0.983 / 1.050 | 0.948 / 0.804 / 0.994 | 0.860 / 0.955 | 1.367 / 1.323 / 1.353 |
| Windows x64 | 0.809 / 0.830 / 0.893 | 1.075 / 1.049 / 1.041 (`llvm.exe`: 1.044 / 0.987 / 1.020) | 0.885 / 1.021 | 1.226 / 1.155 / 1.227 |
| Windows arm64 | 0.899 / 0.916 / 0.958 | 1.332 / 1.238 / 1.187 (`llvm.exe`: 1.090 / 1.058 / 1.079) | 0.944 / 0.939 | 1.178 / 1.150 / 1.162 |

What this run adds, with the same build without its profile:

- **The profile takes 16 to 34% off the time** of fmt's compiles. Without
  it, the same build takes 1.15 to 1.37 times as long as LLVM's; with it,
  about as long.
- **x86_64 macOS was the exception.** There, xclang without its profile
  was not slower than with it (0.84 to 1.12, relative to xclang), and
  Apple's clang was faster than xclang (0.89 to 1.08 on fmt, 0.57 to 0.87
  on lua).

  23.1.2.6's run, which has no build without the profile, has Apple's
  clang 17 to 22% slower on fmt. The x86_64 macOS toolchain is
  cross-compiled on arm64 macOS with the same profile, and the
  `macos-15-intel` runners are the noisiest of the six. Whether the
  profile helps there is not known.

## Not Yet Supported

| | status |
|---|---|
| [BOLT](roadmap.md#bolt), which LLVM's Linux x64 release uses on top of PGO | In research |
| [A training on more of the toolchain's work](roadmap.md#pgo-training): Objective-C, clang-cl, Mach-O links, clang-tidy's checks | Planned |

The training is widened between releases, not while one is pending.
