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
  - title: Fast Compiles
    details: clang and lld are built with PGO and ThinLTO on every host, Windows included.
    link: ./design/pgo#what-it-buys
  - title: C++20 Modules
    details: import std in CMake 3.28 or later and in Bazel, without experimental switches.
    link: ./features/modules
  - title: Every Build System
    details: CMake, Bazel, Meson, Make and cargo, with xclang from pixi, an archive, FetchContent or the Bazel registry.
    link: ./guide/install
  - title: Reproducible Builds
    details: Every release is pinned by sha256. Bazel builds carry no absolute paths, so one cache serves every checkout.
    link: ./design/bazel-module
---
