# CI

xclang on GitHub Actions. This page gets the toolchain onto a runner, and
keeps what is slow to rebuild between runs. It also builds for a target on
one runner, and runs the result on a runner of that target.

Requires: a GitHub Actions workflow, with the hosted runners of
[targets](../reference/targets.md#hosts).

## Get the Toolchain

**pixi.** With the workspace of the [quick start](../guide/quick-start.md):

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
- uses: prefix-dev/setup-pixi@v0.10.2
  with:
    pixi-version: v0.71.1
    run-install: false
- name: Install
  run: |
    pixi install
    pixi run clang++ --version
```

**CMake with FetchContent.** The project downloads the toolchain itself
([CMake](cmake.md#without-xclang-installed)). Keep the download between
runs by putting `XCLANG_CACHE_DIR` in a cache entry keyed on the release:

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.temp }}/xclang
    key: xclang-${{ runner.os }}-${{ runner.arch }}-23.1.2.8
- name: Build
  env:
    XCLANG_CACHE_DIR: ${{ runner.temp }}/xclang
  run: |
    cmake -G Ninja -B build
    cmake --build build
```

**Bazel.** The module downloads the toolchain into the repository cache of
Bazel. Keep `--repository_cache` with the disk cache (below).

## Keep Caches between Runs

With xclang, the caches of a build are correct to share. In Bazel, every
toolchain file is an input of every action that reads it. So a new release
misses the cache, and does not get the outputs of the old one.

**Bazel's disk and repository caches, and the ThinLTO cache.** clice's CI
([native-test.yml](https://github.com/clice-io/clice/blob/main/.github/workflows/native-test.yml))
restores them on every run, and saves them only on `main`, once per merge.
Pull requests then do not churn the cache space of the repository:

<!-- not run: clice's CI, linked above, runs it -->
```yaml
- uses: actions/cache/restore@v6
  with:
    path: |
      ${{ runner.temp }}/bazel-disk
      ${{ runner.temp }}/bazel-repo
      ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: bazel-${{ matrix.target }}-${{ matrix.build_type }}-${{ github.sha }}
    restore-keys: |
      bazel-${{ matrix.target }}-${{ matrix.build_type }}-
# ... the build, with in user.bazelrc:
#   common --disk_cache=<temp>/bazel-disk
#   common --repository_cache=<temp>/bazel-repo
- uses: actions/cache/save@v6
  if: github.ref == 'refs/heads/main'
  with:
    path: |
      ${{ runner.temp }}/bazel-disk
      ${{ runner.temp }}/bazel-repo
      ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: bazel-${{ matrix.target }}-${{ matrix.build_type }}-${{ github.sha }}
```

The ThinLTO cache directory is the one the `.bazelrc` of the project names
([Bazel](bazel.md#speed-up-libclang-links)). On `main`, clice also prunes
from the disk cache every file the build did not read. Bazel refreshes the
time of an entry when it uses it, so the cache holds what the current tree
needs.

**The ThinLTO cache alone**, for CMake, or for a project without the disk
cache: key it on the xclang release.

<!-- not run: xclang's examples keep no ThinLTO cache between runs -->
```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.8-${{ github.sha }}
    restore-keys: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.8-
```

Restoring a cache sets the last access of every file to the time of the
restore. So the linker never prunes, and the entry only grows, by what new
code adds: 350 to 650 MB for clice and its tests. A new xclang release
changes the input of every link, so none of the old entries can be used.
With the version in the key, its entry starts empty
([the ThinLTO cache](../features/thinlto-cache.md)).

**ccache** is safe for code without C++20 modules. With modules, check what
your ccache version does first
([build caches and modules](../features/modules.md#build-caches-and-modules)).

## Build on One Runner, Run on Another

A Linux runner builds for every Linux and Windows target. The programs and
tests then run on a runner of their target, with nothing installed there:
they need nothing but the OS. One job builds the program of the
[quick start](../guide/quick-start.md), in `examples/quickstart`, for
Windows on Arm, and uploads it:

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
build:
  runs-on: ubuntu-24.04
  defaults:
    run:
      working-directory: examples/quickstart
  steps:
    - uses: actions/checkout@v7
      with:
        persist-credentials: false
    - uses: prefix-dev/setup-pixi@v0.10.2
      with:
        pixi-version: v0.71.1
        manifest-path: examples/quickstart/pixi.toml
    - run: pixi run clang++ -O2 --target=aarch64-w64-mingw32 hello.cpp -o hello.exe
    - uses: actions/upload-artifact@v7
      with:
        name: windows-arm64
        path: examples/quickstart/hello.exe
```

Another job, on a runner of the target, downloads and runs it:

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
run:
  needs: build
  runs-on: windows-11-arm
  steps:
    - uses: actions/download-artifact@v8
      with:
        name: windows-arm64
    - run: ./hello.exe
      shell: bash
```

In Bazel, the build job uses `--platforms=@xclang//platforms:<target>`
and uploads the test binaries with their runfiles. xclang's own CI runs
every example of these docs this way: what each host built for another
target runs on a runner of that target
([testing](../dev/testing.md#cross-compiling)). The runners for each
target:

| target | runner |
|---|---|
| `x86_64-unknown-linux-gnu` | `ubuntu-24.04` |
| `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` |
| `x86_64-w64-mingw32` | `windows-2025` |
| `aarch64-w64-mingw32` | `windows-11-arm` |
| `aarch64-apple-darwin` | `macos-15` |
| `x86_64-apple-darwin` | `macos-15-intel` |

macOS targets build on Linux and Windows runners too, with the SDK the
`xclang` command fetches
([macOS](../design/macos.md#the-sdk-on-linux-and-windows-hosts)); in
Bazel, on macOS runners only
([roadmap](../design/roadmap.md#macos-any-host-bazel)). x86_64 macOS
programs also run on arm64 runners through Rosetta, and x86_64 Windows
programs on `windows-11-arm`.

## See Also

- [CMake](cmake.md) and [Bazel](bazel.md): the builds these jobs run.
- [Testing](../dev/testing.md): how xclang's own CI tests every host and
  target.
