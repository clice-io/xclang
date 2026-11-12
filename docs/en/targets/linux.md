# Linux

xclang ships two pairs of Linux targets in every host archive:
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` (glibc 2.17), and
`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` (musl 1.2.6,
linked statically). Both pairs link xclang's `libc++`, `libc++abi`, `libunwind`
and `compiler-rt` builtins into the binary with `ld.lld`
([cross-compiling](cross-compiling.md)).

## glibc Targets

Build for the glibc targets from any host (or natively on Linux without
`--target`):

<!-- excerpt: .github/workflows/examples.yml -->
```sh
clang++ -O2 --target=x86_64-unknown-linux-gnu hello.cpp -o hello-linux-x64
clang++ -O2 --target=aarch64-unknown-linux-gnu hello.cpp -o hello-linux-arm64
```

`x86_64-pc-linux-gnu`, `x86_64-linux-gnu`, `aarch64-pc-linux-gnu`,
`aarch64-linux-gnu`, `arm64-linux-gnu`, `arm64-unknown-linux-gnu` and
`arm64-pc-linux-gnu` use the same config files.

### glibc 2.17 Sysroot

Both native and cross builds compile and link against the bundled glibc 2.17
sysroot in `<toolchain>/<triple>/` (from conda-forge's `sysroot_linux-64` and
`sysroot_linux-aarch64` packages), not the host machine's `/usr/include` and
`/usr/lib`. Because glibc versions its symbols and the linker selects the
newest version present in the build sysroot, the glibc linked at build time is
the oldest version the binary can run on. Binaries built by xclang run on
CentOS 7, Debian 8, Ubuntu 14.04 and every later distribution with glibc,
loading only `libc`, `libm`, `libpthread`, `libdl`, `librt` and the dynamic
loader from the system ([hermeticity](../design/hermeticity.md)).

### GCC Library Names

Build scripts written for GCC link without changes. `-latomic`, `-lgcc`,
`-lgcc_s` and `-lgcc_eh` resolve to empty archives in the sysroot because wide
atomics (`__atomic_*`) are built into `compiler-rt` and the unwinder is
`libunwind`, while the `clang` driver translates `-lstdc++` to `libc++`
([hermeticity](../design/hermeticity.md)).

When linking with `-nodefaultlibs`, as `rustc` does for `*-unknown-linux-gnu`,
the empty `libgcc_s.a` provides no unwinder; build Rust projects with
`xclang cargo` or pass `-Clink-arg=-l:libunwind.a`
([Rust and Cargo](../integrations/cargo.md)).

### `-static-pie`, `-pg` and `quadmath.h`

- **No `-static-pie`**: glibc 2.17 has no `rcrt1.o`. Use `-static` for a static
  glibc binary, or build for a [musl target](#musl-targets), which supports
  `-static-pie`.
- **`-pg` requires `-no-pie`**: glibc 2.17's `gcrt1.o` is not compiled as
  position-independent code.
- **No `quadmath.h`**: `libquadmath` is a GCC library; `__float128` arithmetic
  itself works through `clang` and `compiler-rt`.

A target with a newer glibc for programs that need what 2.17 lacks is
[considered](../design/roadmap.md#glibc-newer).

## musl Targets

`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` (and their
`-pc-linux-musl`, `-linux-musl` and `arm64-*` spellings) link musl and every
runtime statically into the executable:

<!-- excerpt: .github/workflows/examples.yml -->
```sh
pixi run clang++ -O2 --target=x86_64-unknown-linux-musl hello.cpp -o hello-static-x64
pixi run clang++ -O2 --target=aarch64-unknown-linux-musl hello.cpp -o hello-static-arm64
pixi run llvm-readelf --program-headers hello-static-x64
```

The binary has no `INTERP` program header and no dynamic section, makes system
calls directly to the Linux kernel, and runs on any Linux distribution of its
architecture with or without glibc. On Linux x64, a C++ hello world using
`<iostream>` is 1.17 MB (51 KB larger than the glibc binary), or 826 KB
stripped (27 KB larger).

- **musl 1.2.6 with security patches**: xclang builds musl 1.2.6 from source
  with the four upstream patches for musl's security advisories against 1.2.6
  (`CVE-2026-6042` in `iconv`'s GB18030 decoder and `CVE-2026-40200` in
  `qsort`). musl is compiled with `-funwind-tables -fasynchronous-unwind-tables`
  so C++ exceptions unwind through `qsort` and `bsearch` callbacks and stack
  traces unwind through C library functions.
- **Linux 6.18 UAPI headers**: the sysroots include the kernel UAPI headers of
  Linux 6.18, the newest long-term kernel, with case-clashing netfilter headers
  removed as in the glibc sysroots ([archive layout](../reference/layout.md)).
- **`-static` by default, `-static-pie` on request**: the target config file
  passes `-static`, producing an `ET_EXEC` binary (putting `-static-pie` in the
  config file would make `-no-pie`, which CMake and `rustc` pass, an error).
  Because musl's `libc.a` is compiled as position-independent code and the
  sysroot includes `rcrt1.o`, passing `-static-pie` on the command line builds
  a position-independent static binary for ASLR. On Linux x64, `-static-pie`
  adds 5% to binary size and 2 to 5% to start-up time on a C and C++ hello
  world.
- **No shared libraries**: the sysroot is built with `--disable-shared` and has
  no `libc.so`. Dynamic linking against musl, `dlopen` of a shared library, and
  building `-shared` libraries for a musl distribution such as Alpine are not
  supported with the bundled sysroot (use
  [`-stdlib=platform`](#the-platform-s-c-library) with `--sysroot` for dynamic
  musl builds).

### How musl Behaves Apart from glibc

Where musl's runtime behavior differs from glibc's, measured on 4-core GitHub
Linux x64 runners:

- **`malloc` under threads**: musl's allocator uses a lock that threads contend
  for. Four million `malloc` and `free` calls of 16 to 528 bytes took 0.21 s on
  one thread (glibc: 0.07 s); four threads each doing four million allocations
  at once took 4.8 s (glibc: 0.12 s). Link an allocator of your own into
  programs that allocate heavily across threads.
- **Locales**: musl has no locale data. It accepts any locale name and formats
  as the `C` locale: `printf("%'.1f", 1234567.5)` prints `1234567.5` under
  `en_US.UTF-8` where glibc prints `1,234,567.5`, and `libc++`'s `std::locale`
  behaves the same way.
- **Name lookup**: musl reads `/etc/hosts` and `/etc/resolv.conf` and queries
  DNS directly. It has no NSS (`nsswitch.conf` modules), so mDNS `.local`
  names and LDAP or SSSD users and groups are not resolved through it.
  `getaddrinfo` of a DNS name and `getpwuid` of a local user work as with
  glibc.

## The Platform's C++ Library

Pass `-stdlib=platform` (or `-stdlib=libstdc++`) to every compile and link
command to select `<triple>-system.cfg`, which keeps `-fuse-ld=lld` and leaves
out xclang's `--sysroot` and `libc++`
([cross-compiling](cross-compiling.md#the-platform-s-c-library)):

- **On glibc targets**: `clang` uses GCC's shared `libstdc++` and the glibc of
  the host machine, a distribution's cross packages (such as
  `g++-aarch64-linux-gnu`), or the sysroot given with `--sysroot`. The program
  then requires `libstdc++.so.6`, `libgcc_s.so.1`, and the build sysroot's
  glibc version at run time.
- **On musl targets**: `clang` drops `-static` and the bundled sysroot and uses
  the headers, C library and `libstdc++` of the sysroot passed with `--sysroot`
  (such as an Alpine Linux root).

## Sanitizers

The glibc targets support AddressSanitizer (with the ASan `libc++`),
ThreadSanitizer, LeakSanitizer, UndefinedBehaviorSanitizer and libFuzzer, plus
MemorySanitizer with [runtimes from source](../features/runtimes-from-source.md);
the musl targets support UBSan ([sanitizers](../features/sanitizers.md)).

## Limitations

- **glibc 2.17 floor**: no `-static-pie` (use `-static` or a musl target),
  `-pg` requires `-no-pie`, and no `quadmath.h` ([above](#glibc-targets)). A
  newer glibc target is [considered](../design/roadmap.md#glibc-newer).
- **musl targets are static only**: no `libc.so`, `-shared` or `dlopen` with
  the bundled sysroot, only UBSan among the sanitizers
  ([ASan, TSan, LSan and libFuzzer for musl](../design/roadmap.md#musl-sanitizers)),
  and musl's threaded `malloc`, locale and DNS behavior ([above](#musl-targets)).
- **One `libc++` per shared object**: every shared library linked by xclang has
  its own private copy of `libc++`, and on Linux `libc++` compares `type_info`
  by address, so a standard exception thrown in one shared library is caught in
  another only by `catch (...)` ([hermeticity](../design/hermeticity.md)).
- **Other Linux architectures**: glibc targets for `x86`, `armv7`, `riscv64`,
  `ppc64le`, `s390x` and `loongarch64`
  ([roadmap](../design/roadmap.md#linux-architectures)) and musl targets for
  `riscv64` and `armv7` ([roadmap](../design/roadmap.md#musl-architectures))
  are considered.
