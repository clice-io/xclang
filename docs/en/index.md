---
layout: home

hero:
  name: xclang
  text: Cross-compiling with clang
  tagline: One compiler for every target. Stock clang built with PGO and ThinLTO, six targets' sysroots and runtimes in every archive, programs that depend only on the OS.
  actions:
    - theme: brand
      text: What is xclang?
      link: ./guide/what-is-xclang
    - theme: alt
      text: Quick start
      link: ./guide/quick-start
    - theme: alt
      text: Why xclang
      link: ./guide/why-xclang

features:
  - title: Cross-compiling is a flag
    details: "clang++ --target=aarch64-w64-mingw32 and nothing else: a config file per target names its sysroot, libc++, libunwind, compiler-rt and lld, all in the toolchain."
    link: ./guide/cross-compiling
  - title: Programs that run where they are copied
    details: A program loads glibc 2.17+, libSystem, or the OS's DLLs and UCRT, and nothing else. libc++ and the rest are linked in.
    link: ./design/hermeticity
  - title: Reproducible and cacheable
    details: Pinned by version and sha256. In Bazel, every toolchain file is a declared input and no action has an absolute path, so a cache serves every checkout.
    link: ./guide/why-xclang
  - title: C++20 modules today
    details: import std built for your build's options, in CMake 3.28+ without experimental switches, and in Bazel.
    link: ./features/modules
  - title: One toolchain for every build
    details: Plain clang, CMake, Bazel, Meson, Make and cargo, from pixi, an archive, FetchContent or the Bazel registry.
    link: ./guide/install
  - title: For tools on clang
    details: libclang as PGO-optimized ThinLTO bitcode, with a link cache that makes relinks take seconds, and the option tables.
    link: ./features/libclang
---
