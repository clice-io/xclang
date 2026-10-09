"""The hosts and targets of a release: a toolchain archive per host, and in
every toolchain a directory per target (README.md, "Layout"), and the MSVC
targets, which build against the SDK a project fetches (bazel/sdk.bzl)."""

# Per target: the name of its config file in bin/ (clang's name of the
# triple, also that of its libc++/include/<cfg>/c++/v1), its platform constraints
# (the C library's, platforms/libc), the cpu and target_libc of rules_cc's unix
# toolchain config, compiler-rt's directory under lib/clang/<version>/lib,
# what of the target's directory compiling and linking read (with the
# headers targets share, bazel/toolchain.bzl), where in it the ASan build of
# libc++ is (none for Windows), and the vendor SDK it builds against: Apple's
# off macOS hosts (on them, Xcode's), Microsoft's always.
TARGETS = {
    "x86_64-unknown-linux-gnu": struct(
        cfg = "x86_64-unknown-linux-gnu",
        os = "linux",
        arch = "x86_64",
        cpu = "k8",
        libc = "glibc",
        runtime = "x86_64-unknown-linux-gnu",
        headers = ["usr/include/**"],
        libraries = ["lib64/**", "usr/lib/**", "usr/lib64/**"],
        asan_libcxx = "usr/lib/asan",
        sdk = None,
    ),
    "aarch64-unknown-linux-gnu": struct(
        cfg = "aarch64-unknown-linux-gnu",
        os = "linux",
        arch = "aarch64",
        cpu = "aarch64",
        libc = "glibc",
        runtime = "aarch64-unknown-linux-gnu",
        headers = ["usr/include/**"],
        libraries = ["lib64/**", "usr/lib/**", "usr/lib64/**"],
        asan_libcxx = "usr/lib/asan",
        sdk = None,
    ),
    "aarch64-apple-darwin": struct(
        cfg = "aarch64-apple-darwin",
        os = "macos",
        arch = "aarch64",
        cpu = "darwin_arm64",
        libc = "macosx",
        runtime = "darwin",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = "lib/asan",
        sdk = "macos",
    ),
    "x86_64-apple-darwin": struct(
        cfg = "x86_64-apple-darwin",
        os = "macos",
        arch = "x86_64",
        cpu = "darwin_x86_64",
        libc = "macosx",
        runtime = "darwin",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = "lib/asan",
        sdk = "macos",
    ),
    "x86_64-w64-mingw32": struct(
        cfg = "x86_64-w64-windows-gnu",
        os = "windows",
        arch = "x86_64",
        cpu = "x64_windows",
        libc = "mingw",
        runtime = "x86_64-w64-windows-gnu",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = None,
        sdk = None,
    ),
    "aarch64-w64-mingw32": struct(
        cfg = "aarch64-w64-windows-gnu",
        os = "windows",
        arch = "aarch64",
        cpu = "arm64_windows",
        libc = "mingw",
        runtime = "aarch64-w64-windows-gnu",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = None,
        sdk = None,
    ),
    # Static programs with musl, from 23.1.2.10 on.
    "x86_64-unknown-linux-musl": struct(
        cfg = "x86_64-unknown-linux-musl",
        os = "linux",
        arch = "x86_64",
        cpu = "k8",
        libc = "musl",
        runtime = "x86_64-unknown-linux-musl",
        headers = ["usr/include/**"],
        libraries = ["usr/lib/**"],
        asan_libcxx = None,
        sdk = None,
    ),
    "aarch64-unknown-linux-musl": struct(
        cfg = "aarch64-unknown-linux-musl",
        os = "linux",
        arch = "aarch64",
        cpu = "aarch64",
        libc = "musl",
        runtime = "aarch64-unknown-linux-musl",
        headers = ["usr/include/**"],
        libraries = ["usr/lib/**"],
        asan_libcxx = None,
        sdk = None,
    ),
    # No directory of their own before libc++ for them (23.1.2.10), and no
    # host: their compiler-rt is in lib/clang/<version>/lib/windows, where
    # lld-link looks, and Microsoft's CRT, STL and Windows SDK are the SDK's.
    "x86_64-pc-windows-msvc": struct(
        cfg = "x86_64-pc-windows-msvc",
        os = "windows",
        arch = "x86_64",
        cpu = "x64_windows",
        libc = "msvc",
        runtime = "windows",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = None,
        sdk = "windows",
    ),
    "aarch64-pc-windows-msvc": struct(
        cfg = "aarch64-pc-windows-msvc",
        os = "windows",
        arch = "aarch64",
        cpu = "arm64_windows",
        libc = "msvc",
        runtime = "windows",
        headers = ["include/**"],
        libraries = ["lib/**"],
        asan_libcxx = None,
        sdk = "windows",
    ),
}

# The C libraries that are not their os's own, which a platform names for
# their toolchains (platforms/libc/BUILD.bazel): a platform with only an os
# and a cpu gets glibc on Linux and MinGW on Windows.
OTHER_LIBCS = ["musl", "msvc"]

# The six targets every toolchain is built and tested with are its hosts,
# and libclang's targets: every target but those of the other C libraries.
HOSTS = [triple for triple, t in TARGETS.items() if t.libc not in OTHER_LIBCS]

# The vendors whose SDK a project fetches (bazel/sdk.bzl).
VENDORS = ["windows", "macos"]

# The oldest macOS the macOS targets' programs run on, as their config files
# have it (toolchain/common.ts, MACOS_MIN): the oldest deployment target.
MACOS_MIN = "13.0"

# Other spellings of the triples, as platforms (platforms/BUILD.bazel): clang's
# normalized names of the MinGW ones, Debian's of the Linux ones, Apple's arm64.
SPELLINGS = {
    "x86_64-linux-gnu": "x86_64-unknown-linux-gnu",
    "aarch64-linux-gnu": "aarch64-unknown-linux-gnu",
    "x86_64-linux-musl": "x86_64-unknown-linux-musl",
    "aarch64-linux-musl": "aarch64-unknown-linux-musl",
    "x86_64-w64-windows-gnu": "x86_64-w64-mingw32",
    "aarch64-w64-windows-gnu": "aarch64-w64-mingw32",
    "arm64-apple-darwin": "aarch64-apple-darwin",
}

def constraints(triple):
    """The constraints a toolchain asks of a platform: the target's os and
    cpu, and a C library other than the os's own (OTHER_LIBCS)."""
    t = TARGETS[triple]
    libc = [Label("//platforms/libc:" + t.libc)] if t.libc in OTHER_LIBCS else []
    return ["@platforms//os:" + t.os, "@platforms//cpu:" + t.arch] + libc

def sdk_of(host, target):
    """The vendor SDK host's toolchain builds target against, or None: on a
    macOS host, the macOS targets' is Xcode's."""
    sdk = TARGETS[target].sdk
    return None if sdk == "macos" and TARGETS[host].os == "macos" else sdk

def sdk_repository(host, target):
    """The repository of the vendor SDK host's toolchain builds target
    against (bazel/sdk.bzl), or None."""
    sdk = sdk_of(host, target)
    if sdk == "windows":
        return "xclang_windows_sdk_" + TARGETS[target].arch
    return "xclang_macos_sdk" if sdk else None

def builds(host, target, sdks):
    """Whether host's toolchain builds for target, given the vendor SDKs
    the root module fetches (bazel/sdk.bzl)."""
    sdk = sdk_of(host, target)
    return sdk == None or sdk in sdks

def host_of(host_constraints):
    """The host of @platforms//host:constraints.bzl's HOST_CONSTRAINTS, or None."""
    names = [str(c).rpartition(":")[2] for c in host_constraints]
    for triple in HOSTS:
        t = TARGETS[triple]
        if t.arch in names and (t.os in names or (t.os == "macos" and "osx" in names)):
            return triple
    return None

def host_triple(rctx):
    """The host a repository rule runs on, as a release names it."""
    os = rctx.os.name.lower()
    arm = rctx.os.arch in ("aarch64", "arm64")
    if os.startswith("linux"):
        return "aarch64-unknown-linux-gnu" if arm else "x86_64-unknown-linux-gnu"
    if os.startswith("mac"):
        return "aarch64-apple-darwin" if arm else "x86_64-apple-darwin"
    if os.startswith("windows"):
        return "aarch64-w64-mingw32" if arm else "x86_64-w64-mingw32"
    fail("xclang has no release for %s on %s" % (rctx.os.name, rctx.os.arch))
