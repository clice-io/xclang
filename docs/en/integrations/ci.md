# CI

xclang on GitHub Actions: getting the toolchain onto a runner, keeping what
is slow to rebuild between runs, and building for one target on another
target's runner. The snippets are from workflows that run them:
xclang's [examples.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/examples.yml)
and [bazel.yml](https://github.com/clice-io/xclang/blob/main/.github/workflows/bazel.yml),
and clice's [native-test.yml](https://github.com/clice-io/clice/blob/main/.github/workflows/native-test.yml).

## Getting the toolchain

**pixi.** With the workspace of the [quick start](../guide/quick-start.md):

```yaml
- uses: prefix-dev/setup-pixi@v0.10.2
  with:
    pixi-version: v0.71.1
    run-install: false
- run: pixi install
- run: pixi run clang++ -O2 --target=x86_64-w64-mingw32 hello.cpp -o hello.exe
```

**CMake with FetchContent.** The project downloads the toolchain itself
([CMake](cmake.md#without-xclang-installed)); keep the download between
runs by putting `XCLANG_CACHE_DIR` in a cache entry keyed on the release:

```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.temp }}/xclang
    key: xclang-${{ runner.os }}-${{ runner.arch }}-23.1.2.6
- name: Build
  env:
    XCLANG_CACHE_DIR: ${{ runner.temp }}/xclang
  run: |
    cmake -G Ninja -B build
    cmake --build build
```

**Bazel.** The module downloads the toolchain into Bazel's repository
cache; keep `--repository_cache` with the disk cache (below).

## Caches

A build's own caches are what makes CI fast, and with xclang they are
correct to share: in Bazel every toolchain file is an input of every
action that reads it, so a new release misses the cache and does not get
the old one's outputs.

**Bazel's disk and repository caches, and the ThinLTO cache.** clice's CI
restores them on every run and saves them only on `main`, once per merge,
so pull requests do not churn the repository's cache space:

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

The ThinLTO cache's directory is the project's `.bazelrc`'s
([Bazel](bazel.md#the-thinlto-cache)). On `main`, clice also prunes the
disk cache of every file the build did not read (Bazel refreshes an
entry's time when it uses it), so the entry holds what the current tree
needs.

**The ThinLTO cache alone** (CMake, or a project without the disk cache):
key it on the xclang version.

```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.6-${{ github.sha }}
    restore-keys: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-23.1.2.6-
```

Restoring sets every file's last access to the time of the restore, so the
linker's own pruning (entries unread for a week) never fires and the entry
only grows, by what new code adds (clice and its tests: 350 to 650 MB). A
new xclang release changes every link's input, so none of the old entries
can be used; with the version in the key its entry starts empty
([the ThinLTO cache](../features/thinlto-cache.md)).

**ccache** is safe for code without C++20 modules. With modules, check
what your ccache version does first
([C++20 modules](../features/modules.md#build-caches-and-modules)).

## Building for another target's runner

A Linux runner builds for every Linux and Windows target; the programs and
tests run on a runner of the target. xclang's own bazel.yml does this for
22 host-to-target pairs: one job builds with
`--platforms=@xclang//platforms:<target>` and uploads the test binaries,
another, on a runner of the target, downloads and runs them. Linux-built
Windows programs run on `windows-2025` and `windows-11-arm`, with nothing
installed there: the programs need nothing but the OS.

| target | runner |
|---|---|
| `x86_64-unknown-linux-gnu` | `ubuntu-24.04` |
| `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` |
| `x86_64-w64-mingw32` | `windows-2025` |
| `aarch64-w64-mingw32` | `windows-11-arm` |
| `aarch64-apple-darwin` | `macos-15` |
| `x86_64-apple-darwin` | `macos-15-intel` |

These are the runners xclang's own CI tests each host and target on.
