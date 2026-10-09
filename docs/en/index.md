---
layout: home

hero:
  name: xclang
  text: Cross-Compiling with Clang
  tagline: "Six targets in every archive: Linux, Windows and macOS, each on x64 and arm64. Programs that need nothing but the OS."
  actions:
    - theme: brand
      text: What is xclang?
      link: ./guide/what-is-xclang
    - theme: alt
      text: Quick Start
      link: ./guide/quick-start
    - theme: alt
      text: Why xclang?
      link: ./guide/why-xclang

features:
  - title: Cross-Compiling
    details: A --target flag is all it takes. The sysroots, libc++ and lld for all six targets come with the toolchain.
    link: ./guide/cross-compiling
  - title: Self-Contained Programs
    details: "A program loads only what its OS has: glibc 2.17 or later, the Windows DLLs, or libSystem. Everything else is linked in."
    link: ./design/hermeticity
  - title: musl Targets
    details: Fully static Linux programs for x64 and arm64, which need nothing from the system they run on, in every archive.
    link: ./reference/targets#musl-targets
  - title: Fast Compiles
    details: clang and lld are built with PGO and ThinLTO on every host, Windows included.
    link: ./design/pgo#what-it-buys
  - title: C++20 Modules
    details: import std in CMake 3.28 or later, without experimental switches, and in Bazel.
    link: ./features/modules
  - title: Every Build System
    details: CMake, Bazel, Meson, Make and cargo, with xclang from pixi, an archive, FetchContent or the Bazel registry.
    link: ./guide/install
  - title: Reproducible Builds
    details: Every release is pinned by sha256. Bazel builds carry no absolute paths, so one cache serves every checkout.
    link: ./design/bazel-module
  - title: MSVC-ABI Targets
    details: Windows x64 and arm64 with Microsoft's CRT and libc++ (or the STL), from every host, with their sanitizers. The xclang command fetches the SDK from Microsoft.
    link: ./integrations/clang#msvc-targets
  - title: macOS from Any Host
    details: arm64 and x64 macOS programs from Linux and Windows too, with Apple's SDK fetched from Apple by the xclang command.
    link: ./guide/cross-compiling#macos-from-linux-or-windows
  - title: The xclang Command
    details: Fetches Apple's and Microsoft's SDKs from the vendor, by a pinned version and digest.
    link: ./reference/xclang-command
---

## Beyond the Release

The cards above are what a release has today. xclang's vision goes
further, the way rustup goes for Rust: every target, fetched when a build
needs it. None of the items below is in a release. The
[roadmap](./design/roadmap.md) has one row for each, with its status.

<!-- BEGIN CAPABILITY: planned -->

**Target archives**

Targets beyond the six, each an archive that `xclang target add` fetches
([roadmap](./design/roadmap.md#target-archives)).

<!-- END CAPABILITY -->

<!-- BEGIN CAPABILITY: considered -->

**WebAssembly, Android, more Linux architectures**

WASI targets, Android with the NDK of the user, and Linux beyond x64 and
arm64 ([roadmap](./design/roadmap.md#targets)).

<!-- END CAPABILITY -->
