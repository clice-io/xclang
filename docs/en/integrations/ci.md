# CI

Set up xclang on GitHub Actions, cache downloaded toolchains, Bazel repositories and ThinLTO objects between runs, and cross-compile on one runner to run tests on another.

Requires: a GitHub Actions workflow using the hosted runners listed in [Cross-Compiling](../targets/cross-compiling.md#targets-and-hosts).

## Get the Toolchain

**pixi.** With the `pixi.toml` from the [quick start](../guide/quick-start.md):

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

**CMake with FetchContent.** The project downloads the host toolchain at configure time ([Without xclang Installed](cmake.md#without-xclang-installed)). Cache `XCLANG_CACHE_DIR` keyed on the release version from `SHA256SUMS` to keep the unpacked toolchain between runs:

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
- name: The latest release
  id: xclang
  shell: bash
  run: |
    curl -sSfLO https://github.com/clice-io/xclang/releases/latest/download/SHA256SUMS
    echo "version=$(sed -n 's/^[0-9a-f]*  llvm-option-inc-\(.*\)\.tar\.xz$/\1/p' SHA256SUMS)" >> "$GITHUB_OUTPUT"
- uses: actions/cache@v6
  with:
    path: ${{ runner.temp }}/xclang
    key: xclang-${{ runner.os }}-${{ runner.arch }}-${{ steps.xclang.outputs.version }}
- name: Build
  env:
    XCLANG_CACHE_DIR: ${{ runner.temp }}/xclang
  run: |
    cmake -G Ninja -B build
    cmake --build build
```

**Bazel.** The `xclang` module downloads the toolchain archive into Bazel's repository cache. Cache `--repository_cache` alongside `--disk_cache` ([below](#keep-caches-between-runs)).

**Vendor SDKs.** Bazel caches vendor SDK archives in `--repository_cache`, and `xclang sdk fetch` caches them in the directory given as its `--cache`, which an `actions/cache` step can persist across runs. Keeping a cached macOS SDK package also protects builds if Apple later withdraws that package from its catalog ([packages Apple withdraws](../targets/macos.md#packages-apple-withdraws-and-content-digests)).

## Keep Caches between Runs

With xclang, build caches are safe to share across runs. In Bazel, every toolchain file is a declared input of the actions that use it, so moving to a new xclang release misses the cache cleanly instead of reusing outputs from the previous release.

**Bazel's disk and repository caches, and the ThinLTO cache.** Restore the caches on every run and save them only on `main`, once per merge (as [clice's CI](https://github.com/clice-io/clice/blob/main/.github/workflows/native-test.yml) does), so pull requests do not churn the repository's cache quota. For a matrix of targets and build types:

<!-- excerpt: .github/workflows/examples.yml -->
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
- name: Build
  run: >-
    bazel build -c ${{ matrix.build_type }} --platforms=@xclang//platforms:${{ matrix.target }}
    "--disk_cache=${{ runner.temp }}/bazel-disk" "--repository_cache=${{ runner.temp }}/bazel-repo" //...
- uses: actions/cache/save@v6
  if: github.ref == 'refs/heads/main'
  with:
    path: |
      ${{ runner.temp }}/bazel-disk
      ${{ runner.temp }}/bazel-repo
      ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: bazel-${{ matrix.target }}-${{ matrix.build_type }}-${{ github.sha }}
```

The ThinLTO cache path matches the one configured in the project's `.bazelrc` ([the ThinLTO cache](../features/libclang.md#the-thinlto-cache)). On `main`, you can also prune disk cache files that were not accessed during the build, since Bazel updates the modification time of each cache entry it reads.

**The ThinLTO cache alone**, for CMake or for projects without a Bazel disk cache: include the xclang release version (from the `SHA256SUMS` step above) in the cache key:

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-${{ steps.xclang.outputs.version }}-${{ github.sha }}
    restore-keys: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-${{ steps.xclang.outputs.version }}-
```

Restoring from `actions/cache` sets every file's access time to the restore time, so age-based linker pruning does not remove old entries, and a new xclang release changes the bitcode hash of every link. Including the xclang version in `key` and `restore-keys` starts an empty cache entry on each compiler upgrade ([the ThinLTO cache](../features/libclang.md#the-thinlto-cache)).

**ccache** is safe for code that does not use C++20 modules. Before enabling `ccache` on a build with C++20 modules, see [build caches and modules](../features/modules.md#build-caches-and-modules).

## Build on One Runner, Run on Another

A single runner (such as `ubuntu-24.04`) can build for every Linux and MinGW target, and with the vendor SDKs for the MSVC and macOS targets as well. Upload the compiled programs or test binaries as artifacts and run them on a runner of the target platform, with no compiler installed there. Here, the `build` job cross-compiles `examples/quickstart` for Windows on Arm64 on Ubuntu and uploads `hello.exe`:

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

The `run` job downloads and runs it on `windows-11-arm`:

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

In Bazel, the build job passes `--platforms=@xclang//platforms:<target>` and uploads the test binaries together with their runfiles. xclang's own CI tests every example in these docs this way. The GitHub-hosted runner for each target:

| target | runner |
|---|---|
| `x86_64-unknown-linux-gnu` | `ubuntu-24.04` |
| `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` |
| `x86_64-unknown-linux-musl` | `ubuntu-24.04` |
| `aarch64-unknown-linux-musl` | `ubuntu-24.04-arm` |
| `x86_64-w64-mingw32` | `windows-2025` |
| `aarch64-w64-mingw32` | `windows-11-arm` |
| `x86_64-pc-windows-msvc` | `windows-2025` |
| `aarch64-pc-windows-msvc` | `windows-11-arm` |
| `aarch64-apple-darwin` | `macos-15` |
| `x86_64-apple-darwin` | `macos-15-intel` |

MSVC targets and macOS targets build on any runner once the vendor SDK is fetched with `xclang sdk fetch` ([MSVC targets](../targets/windows.md#msvc-targets), [macOS](../targets/macos.md#on-linux-and-windows-hosts)) or via the Bazel module extension ([Bazel](bazel.md#build-for-msvc-and-for-macos-anywhere)). `x86_64-apple-darwin` binaries also run on `macos-15` under Rosetta, and `x86_64` Windows binaries run on `windows-11-arm`.

## See Also

- [CMake](cmake.md) and [Bazel](bazel.md): setting up the builds run in these workflows.
