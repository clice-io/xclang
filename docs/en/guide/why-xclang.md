# Why xclang?


A C++ build is hermetic when its result depends only on its declared
inputs: the same sources and the same toolchain give the same program, on
any machine, in any directory, and the program runs on any machine of its
target. Most C++ toolchains are not built for that. They take headers and
libraries from the machine they run on, link runtimes the target machine
has to provide, and write the build's paths into the output.

xclang is built to be close to the current best practice for hermetic,
modern C++ builds. This page makes that case angle by angle. For each: what
xclang does, why it is the right practice, what shows it works (a test or a
CI run), and what is not supported yet. The
[last sections](#not-yet-supported) collect the gaps, each with its status.

## Reproducible

**What xclang does.** A toolchain is a release, `<llvm version>.<revision>`,
and a release is never replaced: a rebuild is the next revision, and the
workflow that drafts a release refuses a version that exists. Its archives'
sha256 are in the release's `SHA256SUMS`. The Bazel module pins each archive
by its sha256, and CMake's download checks it. In Bazel builds, no path on a
compile or link command line is absolute (the macOS SDK's aside), the debug
information names paths relative to the execution root
(`-ffile-compilation-dir=.`), macOS debug maps drop the build directory
(`-oso_prefix`), Windows programs have no link timestamp
(`--no-insert-timestamp`), and `__DATE__` and `__TIME__` are redacted.

**Why.** A toolchain found on `PATH` or installed by a system package
manager is whatever that machine has; two developers and a CI runner
building "the same commit" use three compilers. A digest names one
toolchain. Paths in outputs are what makes the same build differ between
two checkouts, and what keeps a shared build cache from serving one
machine's results to another.

**Evidence.** tests/bazel.ts, run for every release on every host
([23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37345631067)):
the actions' keys hold no absolute path, for the host and for a target of
another OS; a program built with `-c dbg` in a second checkout is the same
bytes, its dSYM's DWARF too on macOS; and another release rebuilds every
action. Programs linked with and without the ThinLTO cache are the same
bytes on every host (tests/bazel.ts, tests/cmake.ts).

**Not yet supported.** CMake builds write the build tree's absolute paths
into debug information; relative paths there are
[planned](../design/roadmap.md#cmake-relative-paths). The release archives
are not reproducible: they are `tar | xz` without sorted entries or fixed
times, and no test compares two builds of one commit. Reproducible archives
are [planned](../design/roadmap.md#reproducible-archives).

**Known issues.** lld's ThinLTO links of a large Windows program are not
always the same bytes. clice, 600 MB with debug information, came out in
three layouts from six links of the same inputs. Small programs are
identical, and the cause is not known. llvm-gsymutil's multithreaded
conversion writes a different GSYM file each run, with the same lookups.
One thread is deterministic, and `xclang_debug_symbols` passing it is
[planned](../design/roadmap.md#gsym-determinism).

## Portable Programs

**What xclang does.** A program depends at run time only on the system
libraries every installation of its OS has: glibc 2.17 or later on Linux,
libSystem on macOS 13 or later, the OS's DLLs and UCRT on Windows 10 or
later. libc++, libc++abi, libunwind and compiler-rt are linked into it.
Build scripts written for GCC (`-latomic`, `-lgcc_s`, `-lstdc++`,
`windres`, ...) link unchanged.

**Why.** The glibc a Linux program is linked against is the oldest it runs
on, so building against the machine's glibc ties the program to machines as
new as the build machine. A shared C++ runtime has to be installed or
shipped next to the program, in the version the program was built with.
Linking it in, against an old C library, is what Rust does by default
(its standard library is linked into every program, and its Linux targets
are built for glibc 2.17), and what Chromium arranges for itself, with a
Debian sysroot and its own libc++ built into the browser.

**Evidence.** The [quick start](quick-start.md)'s programs for every target
load, on every host: `libc.so.6`, `libm.so.6`, `libdl.so.2`,
`libpthread.so.0` and the dynamic loader on Linux; `KERNEL32.dll` and UCRT
on Windows; `libSystem.B.dylib` on macOS
([examples.yml](https://github.com/clice-io/xclang/actions/runs/37354730630)).
tests/smoke.ts checks on every host that the toolchain's own programs load
no C++ runtime and need glibc 2.17 at most, and that `-static`, `-latomic`
and the other GCC names link.

**Not yet supported.** musl targets, for fully static Linux programs, are
[planned](../design/roadmap.md#musl).

**Known issues.** Each shared library has its own libc++, so C++ types and
exceptions should not cross shared objects. A standard exception thrown in
one is caught in another only by `catch (...)` on Linux and macOS
([hermeticity](../design/hermeticity.md#one-libc-per-shared-object)).
glibc 2.17 has no `-static-pie`.

## Cross-Compiling Is a Flag

**What xclang does.** Every toolchain archive carries every target's
sysroot and runtimes, and a config file per target that tells clang where
they are. `clang++ --target=aarch64-w64-mingw32` is the whole difference
between a native and a cross build; in CMake it is `XCLANG_TARGET`, in
Bazel a platform, and cargo uses the same toolchain as its C compiler and
linker.

**Why.** Cross toolchains have traditionally been one per target pair:
`aarch64-linux-gnu-g++` from a distribution package, a MinGW GCC, a
Docker image per target, each with its own compiler version and its own
sysroot. clang is a cross compiler for every LLVM target already; what it
lacks is the target's libraries. Providing those, prebuilt and next to the
compiler, makes one compiler version cover every target, so a bug fixed or
a warning added applies to all of them at once.

**Evidence.** bazel.yml builds tests/bazel for every other target from every
host, 22 host-to-target pairs, and runs the tests on a machine of the
target: Linux-built Windows programs on Windows, Windows-built Linux
programs on Linux
([23.1.2.6](https://github.com/clice-io/xclang/actions/runs/37345631067)).
tests/smoke.ts and tests/cmake.ts build for every target on every host.

**Not yet supported.** macOS targets build on macOS hosts only, as Apple's
SDK cannot be redistributed. Building them elsewhere with the SDK fetched
from Apple is [in research](../design/roadmap.md#macos-any-host). MSVC-ABI
and musl targets are [planned](../design/roadmap.md#targets). More Linux
architectures and WebAssembly are
[considered](../design/roadmap.md#targets). The `xclang` command that
fetches SDKs is [unreleased](../design/roadmap.md#xclang-command).

## Build Caches That Are Correct

**What xclang does.** In Bazel, every file of the toolchain an action
reads is a declared input, so a new release rebuilds what it should and a
disk or remote cache can serve any machine. Module files (BMIs) are
declared inputs of their importers, compiled with paths relative to the
execution root, so they are the same wherever they are built.

**Why.** A cache is only as correct as its key. A toolchain found on the
machine is not in the key: change the compiler and the cache serves objects
built by the old one. C++20 modules make this sharper, because an importer's
object depends on the module file's content, which the importer's command
line names only by path. Given CMake's command lines, ccache never caches a
module interface unit, and ccache 4.13.6 serves an importer's stale object
after the module's interface changed (4.14.1 recompiles it)
([C++20 modules](../features/modules.md#build-caches-and-modules)). Bazel
keys each action by the content of every input, module files included.

**Evidence.** tests/bazel.ts: another checkout's build is served entirely
from the disk cache (the action keys hold no absolute path), and another
release's rebuilds. The ccache behaviour above is examples.yml's `ccache`
job ([run](https://github.com/clice-io/xclang/actions/runs/37356757050)).

**Known issues.** Bazel's C++20 module support is behind
`--experimental_cpp_modules` in Bazel 9. Bazel runs actions on Windows
without a sandbox by default, so there an action can read an undeclared
file and nothing notices. The Linux and macOS builds of the same targets
enforce the declarations.

## C++20 Modules


**What xclang does.** libc++'s `std` and `std.compat` modules are built for
the build, with the build's language options, as a library to link:
`xclang::std` in CMake, `@xclang//bazel:std` in Bazel. CMake needs no
experimental switch; module dependencies are scanned with clang-scan-deps
(P1689) in both.

**Why.** A module file is only usable by importers compiled with the same
language options (`-std`, exceptions, RTTI, ...), so a prebuilt `std`
module cannot be shipped; it has to be built with the project's flags.
CMake's own `import std` support is still experimental, and asks the
compiler for it in a way that depends on CMake's version.

**Evidence.** tests/cmake builds `xclang::std` and a module of partitions on
every host with CMake 3.28 and the newest CMake, for every target
(cmake.yml); tests/bazel builds modules and `import std` on every host and
for every other target (bazel.yml); the quick start builds `import std`
on every host.

**Known issues.** Neither CMake nor Bazel builds header units
(`import <vector>;`). Bazel's module support is experimental (above).

## Fast

**What xclang does.** clang and lld are built with PGO and ThinLTO, from a
profile of compiling real code at `-O0 -g` and `-O2`, with precompiled
headers and preambles, code completion, C++20 modules and their scanning,
and links. The profile comes from frontend instrumentation, so the one
profile recorded on Linux applies to every host. libclang ships as ThinLTO
bitcode, so tools built on it are optimized across it, and the linker's
ThinLTO cache makes their relinks take seconds.

**Why.** A compiler is run thousands of times per build; its own speed is a
large part of a build's. PGO and ThinLTO are what LLVM's own release builds
use on Linux and macOS too; what xclang adds is the same on every host,
Windows included, and a training set that covers what editors and modern
builds do.

**Evidence.** On C++, 23.1.2.6 compiles as fast as LLVM's own builds on
Linux and macOS, and faster than LLVM's Windows build. Apple's clang takes
longer than xclang on C++. The ThinLTO cache turns a libclang tool's
relink from minutes into seconds. The numbers, each with its release and
method, are in [PGO](../design/pgo.md#what-it-buys) and
[the ThinLTO cache](../features/thinlto-cache.md#what-the-cache-does).

**Not yet supported.** BOLT is [in research](../design/roadmap.md#bolt). The
training runs on Linux only, so Objective-C, clang-cl, Mach-O and
Windows-only code paths are not in it; a wider training is
[planned](../design/roadmap.md#pgo-training).

## Correctness Tools

**What xclang does.** ASan, TSan, LSan, UBSan and libFuzzer for Linux and
macOS targets, with an ASan build of libc++ that ASan programs link. Debug
information that holds wherever the build ran, GSYM files for every target
and dSYMs for macOS, made by the toolchain's own tools.

**Why.** An ASan program linked against an uninstrumented libc++ reports
container overflows that are not there: `std::vector`'s annotations are
made by the instrumented half and checked against the uninstrumented half's
writes. The fix is a libc++ instrumented like the program. Debug
information with relative paths is what lets a debugger find sources in
any checkout, and lets a release's symbols be made once and kept.

**Evidence.** tests/smoke.ts runs an ASan program against libc++'s ASan
build on Linux and macOS and expects a real container overflow and no false
one; tests/bazel.ts has gdb, lldb and llvm-symbolizer find source lines of
a program built in the workspace and in an external repository.

**Not yet supported.** Sanitizers for MSVC targets are part of the
[planned](../design/roadmap.md#msvc) MSVC targets; for MinGW targets they
are [considered](../design/roadmap.md#mingw-sanitizers). MemorySanitizer
needs every library instrumented, and is
[planned](../design/roadmap.md#msan) through libc++ built from source on
demand.

## Supply Chain and Licenses

**What xclang does.** Every archive is listed in its release's
`SHA256SUMS`; the Bazel module pins each by sha256. LLVM's source is the
release's tarball, pinned by sha256, with the patches in the repository
applied, and every patch has a README saying what it changes and where it
stands upstream. Vendor SDKs (Apple's, Microsoft's) are never in an
archive. Today the macOS targets use the installed Xcode's SDK. Fetching
SDKs from the vendor, with the user accepting the license, is the
[unreleased](../design/roadmap.md#xclang-command) `xclang` command's job.

**Why.** A toolchain is code that runs on every developer's machine and
writes every shipped binary. Knowing exactly which source built it, and
that the bytes downloaded are the bytes published, is the minimum.

**Evidence.** The release workflow writes `SHA256SUMS` from the files it
uploads; the Bazel module and `xclang.cmake` refuse an archive whose digest
differs.

**Not yet supported.** An archive and its `SHA256SUMS` could in principle be
replaced together; immutable releases are
[planned](../design/roadmap.md#immutable-releases). The archives carry
xclang's own license only; the notices of glibc, mingw-w64, the Linux kernel
headers and LLVM's runtimes are
[planned](../design/roadmap.md#license-notices). SLSA provenance
attestations are [considered](../design/roadmap.md#slsa).

## One Toolchain for Every Build

**What xclang does.** The same archive is the compiler of plain clang
commands, CMake (a package and a toolchain file), Bazel (a module), Meson,
Make, and cargo's C compiler and linker; it is installed with pixi or conda,
unpacked from an archive, downloaded by CMake, or fetched by Bazel.

**Why.** A project usually has more than one build: the main one, a script,
a Rust crate with C code, a test harness. When they use different
compilers, their outputs differ in subtle ways (a different libc++, a
different glibc floor); one toolchain makes them agree.

**Evidence.** examples.yml builds the quick start, a CMake project, a
FetchContent project, a Bazel project, Meson and Make on every host from
the published release; scripts/cli.ts builds xclang's own Rust command
with cargo and xclang for every host.

**Not yet supported.** cargo needs a few environment variables per target
([Rust and Cargo](../integrations/cargo.md)). A helper that sets them,
`xclang cargo`, is [considered](../design/roadmap.md#cargo-helper).

## Not Yet Supported

| | status |
|---|---|
| [MSVC-ABI targets](../design/roadmap.md#msvc) | Planned |
| [musl targets](../design/roadmap.md#musl) | Planned |
| [macOS targets from Linux or Windows](../design/roadmap.md#macos-any-host) | In research |
| [More Linux architectures, WebAssembly, Android, BSDs, bare metal](../design/roadmap.md#targets) | Considered |
| [The `xclang` command](../design/roadmap.md#xclang-command) | Unreleased |
| [MemorySanitizer, through libc++ built on demand](../design/roadmap.md#msan) | Planned |
| [Sanitizers for MinGW targets](../design/roadmap.md#mingw-sanitizers) | Considered |
| [Relative debug paths in CMake builds](../design/roadmap.md#cmake-relative-paths) | Planned |
| [Deterministic GSYM files](../design/roadmap.md#gsym-determinism) | Planned |
| [Immutable releases](../design/roadmap.md#immutable-releases) | Planned |
| [Reproducible archives](../design/roadmap.md#reproducible-archives) | Planned |
| [Third-party license notices](../design/roadmap.md#license-notices) | Planned |
| [SLSA provenance](../design/roadmap.md#slsa) | Considered |
| [BOLT](../design/roadmap.md#bolt) | In research |
| [An `xclang cargo` helper](../design/roadmap.md#cargo-helper) | Considered |

## Known Limitations

- **No Bazel sandbox on Windows** by default: an action can read
  undeclared files there. The Linux and macOS builds of the same targets
  enforce the declarations.
- **Large Windows ThinLTO links** are not always the same bytes; the cause
  is not known.
- **Header units** are built by neither CMake nor Bazel.
