---
layout: home

hero:
  name: xclang
  text: 用 Clang 交叉编译
  tagline: "每个压缩包都带八个目标平台：Linux（glibc 和 musl）、Windows 和 macOS，各有 x64 和 arm64。编译出的程序只依赖操作系统本身。"
  actions:
    - theme: brand
      text: 什么是 xclang？
      link: ./guide/what-is-xclang
    - theme: alt
      text: 快速开始
      link: ./guide/quick-start
    - theme: alt
      text: 交叉编译
      link: ./guide/cross-compiling

features:
  - title: 交叉编译
    details: 只需一个 --target 参数。八个目标平台的 sysroot、libc++ 和 lld 都随工具链附带。
    link: ./guide/cross-compiling
  - title: 自包含的程序
    details: "程序只加载操作系统自带的东西：glibc 2.17 及以上、Windows 的 DLL 或 libSystem，其余全部静态链接进去。"
    link: ./design/hermeticity
  - title: musl 目标平台
    details: 每个压缩包都带 x64 和 arm64 的完全静态 Linux 程序支持，运行时不依赖目标系统的任何东西。
    link: ./guide/cross-compiling#musl-targets
  - title: 编译快
    details: 每个主机上的 clang 和 lld 都用 PGO 和 ThinLTO 构建，Windows 也不例外。
    link: ./design/pgo
  - title: C++20 模块
    details: 在 CMake 3.28 及以上无需实验性开关即可 import std，Bazel 中同样可用。
    link: ./features/modules
  - title: 各种构建系统
    details: CMake、Bazel、Meson、Make 和 cargo 都能用，xclang 可以来自 pixi、压缩包、FetchContent 或 Bazel registry。
    link: ./guide/quick-start
  - title: 可复现构建
    details: 每个版本都按 sha256 锁定。Bazel 构建里没有绝对路径，同一份缓存可供所有检出目录共用。
    link: ./design/bazel-module
  - title: MSVC ABI 目标平台
    details: 使用微软 CRT 和 libc++（或 STL）的 Windows x64 与 arm64，可在任意主机上构建，也支持 sanitizer。SDK 由 xclang 命令从微软下载。
    link: ./guide/cross-compiling#msvc-targets
  - title: 任意主机构建 macOS
    details: 在 Linux 和 Windows 上也能构建 arm64 和 x64 的 macOS 程序，Apple 的 SDK 由 xclang 命令从 Apple 下载。
    link: ./guide/cross-compiling#on-linux-and-windows-hosts
  - title: xclang 命令
    details: 按锁定的版本和摘要从厂商处下载 Apple 和微软的 SDK，并且无需 cargo 配置即可为 xclang 的目标平台运行 cargo。
    link: ./reference/xclang-command
---
