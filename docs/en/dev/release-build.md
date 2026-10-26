# How a Release Is Built

A release is built on GitHub-hosted runners by `release.yml`, from LLVM's
release source with the [patches](../reference/patches.md) applied. The
steps for cutting one are in [releasing](releasing.md).

## The Stages

1. **Runtimes.** A bootstrap clang builds the sysroot, libc++, libc++abi,
   libunwind and compiler-rt of every target, and the ASan libc++. The
   musl targets' sysroot is built from source too: musl's release with the
   patches of `toolchain/musl`, and the UAPI headers of a kernel.org
   release. The
   libc++ (with x64's ASan libc++) and compiler-rt of the MSVC targets are
   built with clang-cl against a Windows SDK fetched in the job by
   `xclang`; only the libraries leave it.
2. **Instrumented compiler.** The bootstrap clang builds a clang and lld
   with frontend instrumentation, on Linux x64.
3. **Training.** The instrumented toolchain compiles a fixed training set
   and writes the profile: about 1700 compiler runs in 23 minutes
   ([PGO](../design/pgo.md#the-training)).
4. **Toolchains.** Every host's clang, lld and tools are built with that
   profile and ThinLTO, about two hours per host. The same build tree gives
   the libclang archive of that host. The ASan libclang of Linux x64 and
   macOS arm64 is built apart, without profile or ThinLTO.
5. **Package and test.** The archives of each host are made twice, on
   two machines, and must be the same bytes: they are reproducible (tar
   sorted, with the commit's time and no owner; xz in blocks of a fixed
   size, whatever its number of threads). So is the `xclang` command they
   carry, built twice too. They are tested on a machine of
   that host, and the Bazel module and the CMake package are tested with
   them ([testing](testing.md)). Each toolchain also gets the runtimes'
   sources, patched, in `libc++/src`.
6. **Release.** A draft release with every archive, the profile and
   `SHA256SUMS`. Publishing it, by hand, creates the tag.

Linux and Windows hosts are built on Linux x64, the macOS ones on macOS
arm64. Every host but those two is cross-compiled, with table generators
built for the machine first: no program of another architecture runs
during a build, Rosetta's x86_64 included (`toolchain/toolchain.ts` checks
the commands of each cross build).

## The Bootstrap Chain

The bootstrap clang is an earlier xclang release, pinned with its sha256 in
`toolchain/common.ts`. The first was built by LLVM's own release builds:

| release | built by |
|---|---|
| 23.1.2.1 | LLVM 23.1.2's release builds (Linux x64, macOS arm64) |
| 23.1.2.2 | 23.1.2.1 |
| 23.1.2.3 | 23.1.2.2 |
| 23.1.2.4 | 23.1.2.3 |
| 23.1.2.5 | 23.1.2.3 |
| 23.1.2.6 | 23.1.2.5 |
| 23.1.2.7 | 23.1.2.6 |
| 23.1.2.8 | 23.1.2.7's compiler, repacked |
| 23.1.2.9 | 23.1.2.7's compiler, repacked |
| 23.1.2.10 | 23.1.2.6 |
| 23.1.2.11 | 23.1.2.6 |
| 23.1.2.12 | 23.1.2.11's compiler, repacked |
| 23.1.3.1 | 23.1.2.12 |
| 23.1.3.2 | 23.1.3.1's compiler, repacked |
| 23.1.3.3 | 23.1.3.1's compiler, repacked |
| 23.1.3.4 | 23.1.2.12 |
| 23.1.3.5 | 23.1.3.4's compiler, repacked |

xclang builds itself with the same config files, runtimes and linker its
users get, so the release pipeline is its first user. The bootstrap moves
forward deliberately, because a release that lacks something the build
needs breaks it. 23.1.2.1 lacked the compiler-rt headers, which LLVM's ASan
build includes. 23.1.2.6 moved to 23.1.2.5, whose ld64.lld has
[patch 0007](../reference/patches.md), to link xclang's own macOS builds
with it. LLVM's release builds stay pinned as the reference of the
benchmark.

## The Workflows

`release.yml`, started by hand, runs the stages as reusable workflows.
`stages` picks which run. `reuse-run`, with `runtimes-run` and
`profile-run`, takes the artifacts of a stage from an earlier run instead
of building them again.

| stage | workflow | |
|---|---|---|
| `runtimes` | stage-runtimes.yml | the runtimes and sysroots of every target |
| `instrumented` | stage-toolchain.yml | the clang and lld that record the profile (Linux x64) |
| `train` | stage-train.yml | the training run, giving `profile` |
| `toolchain` | stage-toolchain.yml | every host's toolchain and libclang |
| `asan` | stage-toolchain.yml | the ASan libclang of Linux x64 and macOS arm64 |
| `package` | stage-package.yml | every host's release archives |
| `test` | test-archives.yml | every host's archives, checked on a machine of that host; what they build for other targets, run on those |
| `bazel` | test-bazel.yml | the Bazel module with every host's archives |
| `cmake` | test-cmake.yml | the CMake package with every host's archives |
| `sdk` | test-sdk.yml | the MSVC targets, and the macOS targets from the Linux and Windows hosts' archives; needs `cli` |
| `cli` | cli.yml | the archives' `xclang` command on every host |
| `release` | stage-draft.yml | a draft release of everything, with `SHA256SUMS` |

The test workflows are the ones every push runs against the latest
release ([testing](testing.md#when-tests-run)); here they get the run's
archives.

A **repack** runs `package`, the tests and `release` only, with
`reuse-run` and `profile-run` naming the run that built the previous
release: the same compiler, runtimes, libclang and profile, with the
packaging of the checkout ([releasing](releasing.md#full-rebuild-or-repack)).
Its input `repack-of` adds to the `test` stage the comparison of each
host's archives with that release's, file by file, both ways: only the
config files, the CMake package, the `xclang` command, the license
notices, the runtimes' sources (`libc++/src`) and where libc++abi's
headers are may differ, and no archive may be missing. `repack-of` can also name a
run of the same revision instead of a release: a rebuild with that run's
profile (`profile-run`) must then give its archives again, every file the
same, the packaging and the `xclang` command included
([reproducible builds](../design/roadmap.md#reproducible-builds)).

With the `cli` input, on by default, the `package` stage also builds the
[xclang command](../reference/xclang-command.md) (cli.yml) and puts it into
every toolchain archive. 23.1.2.7 was the first release built with it.

A draft creates no tag; publishing it does, and starts published.yml,
which tests the release as its users get it and publishes it everywhere
else:

- test-bazel.yml with the release's archives, then the module of the tag
  to [bazel.clice.io](https://bazel.clice.io);
- test-cmake.yml, with `tests/cmake` fetching the tag as a user's
  FetchContent does;
- conda.yml: the conda packages of the release, tested with pixi on every
  host and published to [conda.clice.io](https://conda.clice.io);
- the `latest` branch moved to the tag;
- examples.yml: the commands of the docs and `examples/` against the
  release on every host, once conda.clice.io serves it.

bench.yml, by hand, compares the compile speed of the release with LLVM's
own build of the same version, and with Apple's clang on macOS
([PGO](../design/pgo.md#what-it-buys)).

`pixi run <task>` runs each stage the way CI does (pixi.toml). The builds
themselves need CI-sized machines. Where each piece of the pipeline lives
is in [contributing](contributing.md#where-things-are).

## The xclang Command

`node xclang/build.ts` builds the
[xclang command](../reference/xclang-command.md) for the hosts of the
machine it runs on, with a released xclang
(23.1.2.5, pinned in `toolchain/common.ts`) as the C compiler and linker:
both Linux and both Windows hosts from Linux x64, both macOS hosts from
macOS. It checks what each binary loads at run time:

| host | size | loads at run time |
|---|---|---|
| x86_64-unknown-linux-gnu | 3.2 MB | libc, libdl, libpthread, librt; glibc 2.16 |
| aarch64-unknown-linux-gnu | 2.8 MB | libc, libdl, libpthread; glibc 2.17 |
| x86_64-w64-mingw32 | 3.0 MB | kernel32, ntdll, advapi32, ws2_32, bcrypt, bcryptprimitives, crypt32, `api-ms-win-core-synch-l1-2-0`, UCRT (`api-ms-win-crt-*`) |
| aarch64-w64-mingw32 | 2.5 MB | the same |
| aarch64-apple-darwin | 2.7 MB | libSystem, libiconv, Security, CoreFoundation; macOS 13.0 |
| x86_64-apple-darwin | 3.0 MB | the same |

cli.yml builds the binaries and tests each on a machine of its host
([testing](testing.md#the-xclang-command)). `release.yml` with `cli` builds the
program, and `toolchain/package.ts --cli` puts it into the toolchain
archives.

A build gives the same bytes in any directory, with any `CARGO_HOME`, at
any time, on a machine of the kind that builds that host: Linux for the
Linux and Windows hosts, macOS, with the same Xcode, whose SDK version the
binary records, for the macOS ones. Windows binaries built on macOS
(`--host`) differ from those built on Linux. cli.yml builds every
binary twice, on two machines, in two directories with two `CARGO_HOME`s,
and compares them. `xclang/build.ts` passes:

- `--remap-path-prefix=$CARGO_HOME=/cargo`: the crates' paths in panic
  messages are `/cargo/registry/src/...`, not the builder's home;
- `-Wl,--no-insert-timestamp` to the MinGW links, whose PE image would
  otherwise hold the time of the link;
- `-Wl,-S` to the macOS links, which then write no debug map. ld64.lld
  hashes the whole output into `LC_UUID`, and the debug map names
  rustc's temporary directory of an LTO link,
  `target/release/deps/rustcXXXXXX`, a new name each time. The strip
  after the link drops the debug map but keeps the UUID, and the code
  signature of arm64 hashes it.

Each dependency is there for a reason:

- ureq for HTTP, with rustls and ring. ring rather than aws-lc-rs, because
  it needs nothing but a C compiler to build, no CMake or NASM.
- rustls-platform-verifier for the trust store of the system, with
  webpki-roots as the fallback; on Linux, rustls-native-certs, to see
  whether the system has CA certificates at all.
- flate2 for the deflate of zip, the zlib of xar and the gzip of Apple's
  catalogs.
- liblzma for xz; cargo's C compiler builds its C sources.
- tar; serde and serde_json for the version table and the index; lexopt
  for the command line.

xar, pbzx, cpio and zip are read by xclang's own code, a few hundred
lines.

**The version table** is made by `xclang sdk update-table`, built with the
`maintainer` feature, which the shipped program does not have. It appends
what the vendors offer now, and reads the presets anew:

```sh
cd xclang && cargo run --release --features maintainer -- sdk update-table --table sdk-versions.json
```

It is part of the program rather than a script, because it shares the
readers of the program: it reads the SDK version out of each new Apple
package, through xar, pbzx and cpio. It also shares the downloads, and the
types of the table, which read and write the file alike.

## Before Target Archives Ship

Target archives for `xclang target add` are
[planned](../design/roadmap.md#target-archives). Before a release can carry
them, the pipeline needs:

1. A stage that packs each target that toolchains do not carry into
   `xclang-target-<version>-<target>.tar.xz`, laid out as
   [the xclang command](../reference/xclang-command.md#targets) expects:
   `xclang/<target>/` (sysroot, libc++, libunwind, its licenses),
   `xclang/libc++/include/<target>/c++/v1/__config_site` (libc++'s headers
   are the shared `libc++/include/c++/v1`), `xclang/lib/clang/<major>/lib/<target>/`
   (compiler-rt), and
   `xclang/bin/<spelling>.cfg` for every spelling of the triple. The config
   files come from `toolchain/config/`, as `toolchain/common.ts` writes
   them, case-unique and without links.
2. The index, `xclang-targets-<version>.json`, with the sha256, size,
   unpacked size, tier and SDK of each archive.
3. Both in the draft release with the toolchains, and in `SHA256SUMS`.
4. A test that adds each target to every host toolchain and builds a
   program for it, and runs it as its tier says.
