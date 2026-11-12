# Cross-Compiling

Pass `--target=<triple>` to `clang` or `clang++` to compile and link for
another target. Every host archive contains the compiler, `lld`, and the
sysroots, prebuilt runtimes and config files for all bundled targets, so
cross-compiling needs no external sysroot or wrapper script.

## Build for Another Target

From the [quick start](quick-start.md) directory (`examples/quickstart`),
compile `hello.cpp` for Windows on Arm:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello-windows-arm64.exe
```

## Targets and Hosts

The same `--target` flag builds for any of xclang's ten targets:

<!-- BEGIN GENERATED: targets -->

| target | also spelled | C library | runs on | vendor SDK |
| --- | --- | --- | --- | --- |
| `x86_64-unknown-linux-gnu` | `x86_64-pc-linux-gnu` | glibc 2.17 | Linux with glibc 2.17 or later |  |
| `aarch64-unknown-linux-gnu` | `aarch64-pc-linux-gnu`, `arm64-unknown-linux-gnu`, `arm64-pc-linux-gnu` | glibc 2.17 | Linux with glibc 2.17 or later |  |
| `x86_64-w64-mingw32` | `x86_64-w64-windows-gnu`, `x86_64-pc-windows-gnu` | mingw-w64 14.0.0, UCRT | Windows 10 or later |  |
| `aarch64-w64-mingw32` | `aarch64-w64-windows-gnu`, `aarch64-pc-windows-gnu`, `arm64-w64-windows-gnu`, `arm64-pc-windows-gnu` | mingw-w64 14.0.0, UCRT | Windows 10 or later |  |
| `aarch64-apple-darwin` | `aarch64-apple-macos`, `aarch64-apple-macosx`, `arm64-apple-darwin`, `arm64-apple-macos`, `arm64-apple-macosx` | the SDK's libSystem | macOS 13.0 or later | Apple's, on Linux and Windows hosts |
| `x86_64-apple-darwin` | `x86_64-apple-macos`, `x86_64-apple-macosx` | the SDK's libSystem | macOS 13.0 or later | Apple's, on Linux and Windows hosts |
| `x86_64-unknown-linux-musl` | `x86_64-pc-linux-musl` | musl 1.2.6, static | any Linux |  |
| `aarch64-unknown-linux-musl` | `aarch64-pc-linux-musl`, `arm64-unknown-linux-musl`, `arm64-pc-linux-musl` | musl 1.2.6, static | any Linux |  |
| `x86_64-pc-windows-msvc` | `x86_64-unknown-windows-msvc` | Microsoft's CRT and UCRT | Windows 10 or later | Microsoft's |
| `aarch64-pc-windows-msvc` | `aarch64-unknown-windows-msvc`, `arm64-pc-windows-msvc`, `arm64-unknown-windows-msvc` | Microsoft's CRT and UCRT | Windows 10 or later | Microsoft's |

<!-- END GENERATED -->

Every target links xclang's `libc++` and `compiler-rt` statically by default
and uses `lld` as its linker (`ld.lld`, `lld-link` or `ld64.lld`). Programs
depend at run time only on the OS libraries of their target family
([hermeticity](../design/hermeticity.md)).

All ten targets are **Tier 1**: built for every release and tested on a
native GitHub-hosted runner without an emulator (Tier 2 runs tests under
emulation or virtualization; Tier 3 compiles and links without running).
Other targets are in the [roadmap](../design/roadmap.md#targets). Sanitizer support per target is in
[sanitizers](../features/sanitizers.md).

A host is a machine the toolchain runs on. Each host has its own archive
([releases](../reference/releases.md#assets)), and every archive carries all
targets above:

| host | archive built on | tested on | what the toolchain needs on the host |
|---|---|---|---|
| `x86_64-unknown-linux-gnu` | Linux x64 | `ubuntu-24.04` | glibc 2.17 or later |
| `aarch64-unknown-linux-gnu` | Linux x64, cross-compiled | `ubuntu-24.04-arm` | glibc 2.17 or later |
| `x86_64-w64-mingw32` | Linux x64, cross-compiled (MinGW program) | `windows-2025` | Windows 10 or later |
| `aarch64-w64-mingw32` | Linux x64, cross-compiled (MinGW program) | `windows-11-arm` | Windows 10 or later |
| `aarch64-apple-darwin` | macOS arm64 | `macos-15` | macOS 13 or later; Xcode or the Command Line Tools for macOS targets |
| `x86_64-apple-darwin` | macOS arm64, cross-compiled | `macos-15-intel` | macOS 13 or later; Xcode or the Command Line Tools for macOS targets |

## How Clang Finds a Target's Files

For each `--target`, `clang` reads `bin/<triple>.cfg` (`clang-cl` reads
`bin/<triple>-clang-cl.cfg`), with copies for alternate target spellings
([toolchain structure](../design/toolchain.md)). `<CFGDIR>` in the config
file expands to `bin/`, pointing `clang` to the target's sysroot or SDK,
`libc++` headers, `compiler-rt`, `libunwind` and `lld`
([archive layout](../reference/layout.md)).

The config files apply to native builds as well, so `clang++ hello.cpp` on
Linux compiles against the bundled glibc 2.17 sysroot rather than the host's
`/usr/include` and `/usr/lib`. Build scripts written for GCC (`-latomic`,
`-lgcc`, `-lgcc_s`, `-lgcc_eh`, `-lstdc++`) link without changes
([GCC library names](../design/hermeticity.md#gcc-library-names)). Pass
`--no-default-config` to skip the target config file and run a bare `clang`
that looks for the system's headers, runtime libraries and linker.

## Vendor SDKs

Two target families build against a vendor SDK that xclang cannot
redistribute:

- **[macOS targets](#macos)**: on macOS hosts, `clang` uses the SDK of Xcode
  or the Command Line Tools. On Linux and Windows hosts, run
  `xclang sdk fetch macos --accept-license` once to fetch the macOS SDK from
  Apple.
- **[Windows MSVC targets](#msvc-targets)**: on any host, run
  `xclang sdk fetch windows --accept-license` once to fetch Microsoft's CRT,
  STL and Windows SDK. On a Windows host with no SDK fetched, `clang` uses an
  installed Visual Studio.

`xclang sdk fetch` unpacks each SDK into `<toolchain>/sdk/` and points
`<toolchain>/sdk/macos` or `<toolchain>/sdk/windows` at the active SDK, so
the target config files reference a fixed path while SDK versions change
([the `xclang` command](../reference/xclang-command.md)). In Bazel,
`MODULE.bazel` accepts the license and a repository rule unpacks the SDK as
an external repository
([Bazel](../integrations/bazel.md#build-for-msvc-and-for-macos-anywhere)).

Apple's SDK agreement and Microsoft's Visual Studio license allow use, not
redistribution. `xclang sdk fetch` prints the vendor's terms unless you pass
`--accept-license`, and downloads directly from Apple's and Microsoft's
servers using package URLs, sizes, `sha256` digests and SDK content digests
pinned in `xclang/sdk-versions.json` to match GitHub's runner images
(`macos-latest`, `windows-2025`, `windows-2022`). Apple's terms allow use of
the macOS SDK on Apple hardware; whether to build for macOS on Linux or
Windows with it is the user's decision under those terms.

## The Platform's C++ Library

A program that passes C++ types across an interface to a library built with
the platform's C++ library, such as a Linux distribution's Qt or Boost or a
Windows library built with MSVC, must use that same C++ library. Pass
`-stdlib=platform` (or `-stdlib=libstdc++`; in `clang-cl`,
`/clang:-stdlib=platform`) to every compile and link command, C files
included:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 -stdlib=platform hello.cpp -o hello
clang++ -O2 -stdlib=platform --target=x86_64-pc-windows-msvc hello.cpp -o hello.exe
```

The flag selects `bin/<triple>-system.cfg` (or
`<triple>-clang-cl-system.cfg`, via [patch 0018](../reference/patches.md)),
which keeps `lld`, the deployment target and the C runtime, and leaves out
xclang's `libc++` and bundled sysroot:

| target | C++ library | sysroot or SDK | loaded at run time |
|---|---|---|---|
| Linux (glibc) | GCC's `libstdc++`, shared | the host's, a distribution's cross packages (`g++-aarch64-linux-gnu`), or `--sysroot` | the system's `libstdc++.so.6` and `libgcc_s.so.1`, and the build's glibc (not 2.17) |
| Linux (musl) | the sysroot's `libstdc++` | `--sysroot`, such as an Alpine root | what that sysroot links |
| Windows (MinGW) | the sysroot's `libstdc++` | `--sysroot`, such as MSYS2's `ucrt64` or a directory linking a distribution's `mingw-w64` | what that sysroot links |
| Windows (MSVC) | Microsoft's STL | the fetched Windows SDK, or Visual Studio on Windows | nothing more: the STL is linked statically, with the hybrid CRT |
| macOS | the SDK's `libc++` | Xcode's SDK, or the SDK fetched with `xclang sdk fetch macos` | `/usr/lib/libc++.1.dylib` of the OS |

For MinGW on Debian or Ubuntu, point `--sysroot` to a directory containing
two symbolic links, `x86_64-w64-mingw32` to `/usr/x86_64-w64-mingw32` and
`lib/gcc` to `/usr/lib/gcc` (passing `--sysroot=/usr` directly would add the
Linux host's `/usr/include` and `/usr/lib`).

## Linux

### glibc 2.17 Floor, `-static-pie` and `-pg`

`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` compile and link
against the bundled glibc 2.17 sysroot in `<toolchain>/<triple>/`, the
oldest glibc version the resulting binary can run on
([why glibc 2.17](../design/hermeticity.md#why-glibc-2-17); a newer glibc
target is [considered](../design/roadmap.md#glibc-newer)).

- **No `-static-pie`**: glibc 2.17 has no `rcrt1.o`. Use `-static` for a
  static glibc binary, or build for a [musl target](#musl-targets), which
  supports `-static-pie`.
- **`-pg` requires `-no-pie`**: glibc 2.17's `gcrt1.o` is not compiled as
  position-independent code.
- **No `quadmath.h`**: `libquadmath` is a GCC library; `__float128`
  arithmetic itself works through `clang` and `compiler-rt`.
- **`-nodefaultlibs` and `libunwind`**: because `libgcc_s.a` in the sysroot
  is an empty archive, linking with `-nodefaultlibs` (as `rustc` does for
  `*-unknown-linux-gnu`) provides no unwinder. Build Rust projects with
  `xclang cargo` or pass `-Clink-arg=-l:libunwind.a`
  ([Rust and Cargo](../integrations/cargo.md)).

### musl Targets

`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` link musl 1.2.6
(with upstream security patches, unwind tables for C callbacks, and Linux
6.18 UAPI headers) and every runtime statically into the executable:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=x86_64-unknown-linux-musl hello.cpp -o hello-static-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-musl hello.cpp -o hello-static-arm64
pixi run llvm-readelf --program-headers hello-static-x64
```

The binary has no `INTERP` program header and no dynamic section, makes
system calls directly to the Linux kernel, and runs on any Linux of its
architecture.

- **`-static` by default, `-static-pie` on request**: the config file passes
  `-static`, producing an `ET_EXEC` binary so `-no-pie` from CMake or
  `rustc` is not rejected. Pass `-static-pie` on the command line to build a
  position-independent static binary with `rcrt1.o` for ASLR.
- **No shared libraries**: the sysroot is built with `--disable-shared` and
  has no `libc.so`. Dynamic linking against musl, `dlopen`, and building
  `-shared` libraries are not supported with the bundled sysroot (use
  [`-stdlib=platform`](#the-platform-s-c-library) with `--sysroot` for
  dynamic musl builds).

Where musl's runtime behavior differs from glibc's (measured on 4-core
GitHub Linux x64 runners):

- **`malloc` under threads**: musl's allocator uses a lock that threads
  contend for. Four million `malloc` and `free` calls of 16 to 528 bytes
  took 0.21 s on one thread (glibc: 0.07 s) and 4.8 s across four threads at
  once (glibc: 0.12 s). Link an allocator of your own into programs that
  allocate heavily across threads.
- **Locales**: musl has no locale data and formats as the `C` locale:
  `printf("%'.1f", 1234567.5)` prints `1234567.5` under `en_US.UTF-8` where
  glibc prints `1,234,567.5`, and `libc++`'s `std::locale` behaves the same
  way.
- **Name lookup**: musl reads `/etc/hosts` and `/etc/resolv.conf` and
  queries DNS directly without NSS (`nsswitch.conf` modules), so mDNS
  `.local` names and LDAP or SSSD users and groups are not resolved through
  it.

## Windows

Both the MinGW and MSVC targets use UCRT, part of Windows 10 and later
([Windows design](../design/windows.md)).

### MinGW Targets

`x86_64-w64-mingw32` and `aarch64-w64-mingw32` ship in every toolchain
archive and link `libc++`, `libc++abi`, `libunwind`, `winpthreads` and
`compiler-rt` statically with `ld.lld`.

- **`.exe` output names**: a MinGW link appends `.exe` to an output name
  without an extension on every host (`-o hello` writes `hello.exe`).
- **Headers and `--gc-sections`**: MinGW-w64's headers are lowercase
  (`windows.h`, `basetsd.h`, `winsock2.h`); use lowercase `#include` names
  so builds succeed on case-sensitive file systems, and avoid passing
  `-Wl,--gc-sections` when unreferenced COMDAT initializers register tests
  ([`gc-sections` and static initializers](../design/windows.md#gc-sections-and-static-initializers)).
- **Rust's `-gnullvm` targets**: use `x86_64-pc-windows-gnullvm` and
  `aarch64-pc-windows-gnullvm` rather than `*-pc-windows-gnu`. The
  `-gnullvm` targets link `libunwind` and UCRT, matching xclang's MinGW
  sysroots ([Rust and Cargo](../integrations/cargo.md)).

### MSVC Targets

`x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` build for the MSVC
ABI, needed when linking libraries compiled with MSVC, COM-heavy code or
Windows vendor SDKs. Fetch Microsoft's CRT, STL and Windows SDK once, then
build from any host with `clang++` or `clang-cl`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch windows --accept-license
clang++ -O2 --target=x86_64-pc-windows-msvc hello.cpp -o hello-msvc-x64.exe
clang-cl /O2 /EHsc hello.cpp /Fehello-cl.exe
clang-cl /O2 /EHsc --target=aarch64-pc-windows-msvc hello.cpp /Fehello-cl-arm64.exe
```

- **Choosing SDK versions**: by default, `xclang sdk fetch windows` fetches
  the `windows-latest` preset (`windows-2025-vs2026`: MSVC 14.51 and Windows
  SDK 10.0.26100). Pass `--preset windows-2022` for MSVC 14.44, or pass
  `--msvc-version`, `--sdk-version` and `--arch x86_64,aarch64,x86`.
  `xclang sdk use <name>` switches the active SDK
  ([the `xclang` command](../reference/xclang-command.md)). On a Windows
  host without a fetched SDK (or with `--no-default-config`), `clang` uses
  an installed Visual Studio; on Linux and macOS hosts without a fetched
  SDK, compiling a file that includes a CRT header stops immediately
  (`-ffreestanding` works without an SDK).
- **`clang-cl`**: a plain `clang-cl` command reads
  `<host-triple>-clang-cl.cfg` and builds for the host architecture's MSVC
  target without `--target`. On macOS, `clang-cl` treats an input path such
  as `/Users/me/hello.cpp` as its `/U` option: put inputs after `--`, or
  name them with `/Tp`. In [CMake](../integrations/cmake.md) and
  [Bazel](../integrations/bazel.md), xclang uses the GNU-style `clang++`
  driver rather than `clang-cl`.
- **C runtime choices**: by default, binaries link `libc++` (or Microsoft's
  STL) and the VC runtime (`libvcruntime.lib`, `libcmt.lib`) statically and
  UCRT dynamically against `ucrtbase.dll` (the hybrid CRT;
  [Windows design](../design/windows.md#the-hybrid-crt)). To select another
  C runtime:

  | C runtime | `clang`, `clang++` | `clang-cl` |
  |---|---|---|
  | hybrid CRT (default) | (default) | `/MT` (default) |
  | DLL runtime (`vcruntime140.dll`, plus `msvcp140.dll` with the STL) | `-fms-runtime-lib=dll` | `/MD` |
  | all static, UCRT included | `-Wl,/nodefaultlib:ucrt.lib -llibucrt` | `/link /nodefaultlib:ucrt.lib libucrt.lib` |
  | static debug CRT | `-fms-runtime-lib=static_dbg -Wl,/nodefaultlib:ucrt.lib` | `/MTd /link /nodefaultlib:ucrt.lib` |

  `/MDd` loads `ucrtbased.dll`, which only Visual Studio installs.
- **The C++ standard**: `clang` defaults to C++14 for MSVC targets, matching
  `cl.exe`. Microsoft's STL exposes some C++17 library templates such as
  `std::is_integral_v` in C++14 mode, whereas `libc++` provides them only
  from C++17 onward; pass `-std=c++17` (`/std:c++17`) or later when code
  relies on them.

## macOS

The macOS targets, `aarch64-apple-darwin` and `x86_64-apple-darwin`,
compile against Apple's macOS SDK and link xclang's `libc++` and `libc++abi`
statically with `ld64.lld` ([macOS design](../design/macos.md)).

### On macOS Hosts

On a macOS host, `clang` uses the SDK of Xcode or the Command Line Tools
without fetching anything through `xclang`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=aarch64-apple-darwin hello.cpp -o hello-macos-arm64
pixi run clang++ -O2 --target=x86_64-apple-darwin hello.cpp -o hello-macos-x64
```

### On Linux and Windows Hosts

On Linux and Windows hosts, fetch Apple's macOS SDK once with
`xclang sdk fetch macos --accept-license`, then build for either macOS
architecture with `--target`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
xclang sdk fetch macos --accept-license
clang++ -O2 --target=arm64-apple-macos hello.cpp -o hello-macos-arm64
```

| host | SDK used |
|---|---|
| macOS | the last `-isysroot`, else `SDKROOT`, else Xcode's (`xcselect`) |
| Linux, Windows | the last `-isysroot` on the command line, else `<toolchain>/sdk/macos` |

On Linux and Windows hosts, the target config file begins with
`-isysroot <CFGDIR>/../sdk/macos`. Because `clang` reads `SDKROOT` only when
no `-isysroot` flag is present, and `--sysroot` affects only the link step,
pass `-isysroot <dir>` on the command line to select another SDK (Cargo,
`rustc` and xclang's [CMake](../integrations/cmake.md) package pass
`SDKROOT` as `-isysroot`).

### Presets and Versions

- **Presets**: by default, `xclang sdk fetch macos` uses the `macos-latest`
  preset (`macOS-26-arm64`, SDK 26.5). Pass `--preset macos-15` (or
  `macOS-26`, `macOS-15-arm64`) to match that GitHub Actions runner image.
- **Pinned versions**: pass `--version <ver>` (such as `--version 15` or
  `--version 15.5`) to pick the newest matching SDK pinned in
  `xclang/sdk-versions.json`, and run `xclang sdk use <name>` to switch
  `<toolchain>/sdk/macos` between fetched versions
  ([the `xclang` command](../reference/xclang-command.md)).
- **`--version latest`**: queries Apple's live software update catalogs for
  the newest SDK available when the command runs; it is unpinned and not
  reproducible.
- **Withdrawn packages**: when Apple withdraws a Command Line Tools package
  from its CDN and posts a re-signed package in its place,
  `xclang sdk fetch` falls back to Apple's catalogs and verifies the
  unpacked SDK by its content digest
  ([macOS design](../design/macos.md#packages-apple-withdraws-and-content-digests)).

### `-stdlib=platform` and the Deployment Target

The target config file sets `-mmacos-version-min=13.0`; pass a later
`-mmacos-version-min=<ver>` on the command line to override it. With
xclang's default static `libc++`, standard library features depend on the
xclang release rather than the target macOS version. With
`-stdlib=platform` (which links `/usr/lib/libc++.1.dylib` of the OS), newer
C++ library symbols require a matching deployment target: for example,
`std::format` of a floating-point number requires
`-mmacos-version-min=13.3` or later.

### `ld64.lld` and `-fuse-ld=ld`

macOS targets link with `ld64.lld` on every host. `ld64.lld` signs `arm64`
binaries ad hoc so they run on Apple silicon without invoking `codesign`,
and `llvm-install-name-tool` re-signs binaries when modifying them. Signing
with a Developer ID certificate and notarizing require Apple's tools, and
compiling `.nib`, `.xib` or asset catalogs requires `actool` and `ibtool` on
macOS.

On a macOS host, pass `-fuse-ld=ld` to link non-LTO object files with
Apple's `ld` instead. Because xclang does not ship `libLTO.dylib`, LTO
builds always link with `ld64.lld`.

### Two Architectures

Every host archive carries both `aarch64-apple-darwin` and
`x86_64-apple-darwin`, and `llvm-lipo` combines binaries of both into a
universal binary. In CMake on a macOS host, building for the other macOS
architecture sets `CMAKE_OSX_ARCHITECTURES` rather than cross-compiling
([CMake](../integrations/cmake.md)).

## Running What You Built

Inspect the format and architecture of the cross-compiled binary with
`llvm-readobj`:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run llvm-readobj --file-headers hello-windows-arm64.exe
```

Among the headers, it prints `Format: COFF-ARM64` and `Arch: aarch64`. Copy
the binary to a machine of its target and run it; no runtime package needs
to be installed. Some hosts also run binaries of another architecture of the
same OS:

- `arm64` macOS runs `x86_64` macOS binaries through Rosetta.
- Windows on Arm runs `x86_64` Windows binaries through emulation.

Building on one runner and running tests on a runner of the target is
covered in [CI](../integrations/ci.md#build-on-one-runner-run-on-another).

## In Your Build System

- [CMake](../integrations/cmake.md): pass the toolchain file with
  `-DXCLANG_TARGET=<target>`.
- [Bazel](../integrations/bazel.md): pass
  `--platforms=@xclang//platforms:<target>`.
- [Plain clang, Make and Meson](../integrations/clang.md): pass
  `--target=<target>` to the compiler, or in a Meson cross file.
- [Rust and Cargo](../integrations/cargo.md): run
  `xclang cargo build --target <rust-target>`.

## Build Tools' Minimum Versions

| tool | minimum version or target | why |
|---|---|---|
| CMake | 3.28 or later | the first version that builds C++20 modules without experimental switches; `find_package(xclang)` rejects older versions ([CMake](../integrations/cmake.md)) |
| Ninja | 1.11 or later | required by CMake for C++20 modules; only the Ninja generators build modules for these targets |
| Bazel | 9, with `rules_cc` 0.2.25 or later | the toolchains build on `rules_cc` 0.2.28's unix config ([the Bazel module](../design/bazel-module.md)); C++20 modules require `--experimental_cpp_modules` |
| Rust | `*-pc-windows-gnullvm` for MinGW (not `*-windows-gnu`); `*-pc-windows-msvc` with the Windows SDK | `*-windows-gnullvm`'s standard library links `libunwind` and UCRT, matching xclang's MinGW sysroots ([Rust and Cargo](../integrations/cargo.md)) |
