# CI

在 GitHub Actions 上配置 xclang，在多次运行之间缓存已下载的工具链、Bazel 仓库与 ThinLTO 目标文件，并在一台 runner 上交叉编译后交由另一台 runner 运行测试。

要求：使用[交叉编译](../guide/cross-compiling.md#targets-and-hosts)中所列托管 runner 的 GitHub Actions 工作流。

## 获取工具链

**pixi。** 使用 `pixi.toml`（取自[快速开始](../guide/quick-start.md)）：

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

**CMake 配合 FetchContent。** 项目会在配置阶段自动下载主机工具链（[免预装 xclang 构建](cmake.md#without-xclang-installed)）。以 `XCLANG_CACHE_DIR` 为缓存目录，并用从 `SHA256SUMS` 解析出的版本号作为缓存键，即可在多次运行之间保留解压后的工具链：

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

**Bazel。** `xclang` 模块会将工具链压缩包下载到 Bazel 的仓库缓存中。请将 `--repository_cache` 与 `--disk_cache` 一起缓存（[见下文](#keep-caches-between-runs)）。

**厂商 SDK。** Bazel 会将厂商 SDK 安装包缓存在 `--repository_cache` 中，而 `xclang sdk fetch` 则将其缓存在 `--cache` 指定的目录中，可通过 `actions/cache` 步骤在多次运行之间持久化保存。保留已缓存的 macOS SDK 安装包还能防止后续因 Apple 从目录中下架对应安装包而导致构建失败（[Apple 下架的安装包](../design/macos.md#packages-apple-withdraws-and-content-digests)）。

## 在多次运行之间保留缓存

使用 xclang 时，构建缓存可以安全地跨运行共用。在 Bazel 中，每个工具链文件都是使用它的动作所声明的输入，因此升级到新的 xclang 版本时会干净地未命中缓存，不会误复用上一版本的产物。

**Bazel 的磁盘缓存、仓库缓存与 ThinLTO 缓存。** 在每次运行时恢复缓存，并仅在 `main` 分支每次合并时保存缓存（如 [clice 的 CI](https://github.com/clice-io/clice/blob/main/.github/workflows/native-test.yml) 的做法），避免 pull request 频繁挤占仓库的缓存配额。针对包含多个目标平台与构建类型的矩阵：

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

ThinLTO 缓存路径与项目的 `.bazelrc` 中配置的路径保持一致（[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)）。由于 Bazel 会更新其读取的每个缓存条目的修改时间，在 `main` 分支上还可以清理构建期间未访问过的磁盘缓存文件。

**单独缓存 ThinLTO 缓存**（适用于 CMake 或未启用 Bazel 磁盘缓存的项目）：将 xclang 版本号（取自上文的 `SHA256SUMS` 步骤）包含在缓存键中：

<!-- excerpt: .github/workflows/examples.yml -->
```yaml
- uses: actions/cache@v6
  with:
    path: ${{ runner.os == 'Windows' && 'C:/xclang-thinlto' || '/var/tmp/xclang-thinlto' }}
    key: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-${{ steps.xclang.outputs.version }}-${{ github.sha }}
    restore-keys: thinlto-${{ runner.os }}-${{ runner.arch }}-xclang-${{ steps.xclang.outputs.version }}-
```

从 `actions/cache` 恢复缓存会将所有文件的访问时间设为恢复当下的时间，导致链接器按时间清理的策略无法淘汰旧条目；同时，新的 xclang 版本会改变每次链接的 bitcode 哈希。将 xclang 版本号写入 `key` 与 `restore-keys`，即可在每次升级编译器时启用新的空缓存条目（[ThinLTO 缓存](../features/libclang.md#the-thinlto-cache)）。

**ccache** 可安全用于不使用 C++20 模块的代码。在包含 C++20 模块的构建中启用 `ccache` 之前，请先参阅[构建缓存与模块](../features/modules.md#build-caches-and-modules)。

## 在一台 runner 上构建，在另一台 runner 上运行

单台 runner（例如 `ubuntu-24.04`）即可构建所有 Linux 与 MinGW 目标平台，配合厂商 SDK 还能一并构建 MSVC 与 macOS 目标平台。将编译出的程序或测试二进制文件作为构建产物（artifact）上传，即可在无需安装编译器的目标平台 runner 上直接运行。在下面的示例中，`build` 任务在 Ubuntu 上将 `examples/quickstart` 交叉编译到 Arm64 Windows，并上传 `hello.exe`：

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

`run` 任务在 `windows-11-arm` 上下载并运行它：

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

在 Bazel 中，构建任务传入 `--platforms=@xclang//platforms:<target>`，并将测试二进制文件连同其 runfiles 一起上传。xclang 自身的 CI 正是这样测试本文档中的每个示例。各目标平台对应的 GitHub 托管 runner 如下：

| 目标平台 | runner |
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

只要通过 `xclang sdk fetch`（[MSVC 目标平台](../guide/cross-compiling.md#msvc-targets)、[macOS](../guide/cross-compiling.md#on-linux-and-windows-hosts)）或 Bazel 模块扩展（[Bazel](bazel.md#build-for-msvc-and-for-macos-anywhere)）获取了厂商 SDK，即可在任意 runner 上构建 MSVC 与 macOS 目标平台。此外，`x86_64-apple-darwin` 二进制文件也可在 `macos-15` 上通过 Rosetta 运行，`x86_64` Windows 二进制文件也可在 `windows-11-arm` 上运行。
