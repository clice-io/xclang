"""The hosts and targets of a release: a toolchain archive per host, and in
every toolchain a directory per target (README.md, "Layout")."""

# Per target: the name of its config file in bin/ (clang's name of the
# triple), its platform constraints, the cpu and target_libc of rules_cc's unix
# toolchain config, compiler-rt's directory under lib/clang/<version>/lib,
# what of the target's directory compiling and linking read, and where in it
# the ASan build of libc++ is (none for Windows).
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
    ),
}

# Every target is a host too.
HOSTS = list(TARGETS.keys())

# Other spellings of the triples, as platforms (platforms/BUILD.bazel): clang's
# normalized names of the MinGW ones, Debian's of the Linux ones, Apple's arm64.
SPELLINGS = {
    "x86_64-linux-gnu": "x86_64-unknown-linux-gnu",
    "aarch64-linux-gnu": "aarch64-unknown-linux-gnu",
    "x86_64-w64-windows-gnu": "x86_64-w64-mingw32",
    "aarch64-w64-windows-gnu": "aarch64-w64-mingw32",
    "arm64-apple-darwin": "aarch64-apple-darwin",
}

def constraints(triple):
    """The @platforms constraints of a target: its os and cpu, all a toolchain asks of a platform."""
    t = TARGETS[triple]
    return ["@platforms//os:" + t.os, "@platforms//cpu:" + t.arch]

def builds(host, target):
    """Whether host's toolchain builds for target: the macOS targets need
    Xcode's SDK, which only a macOS host has."""
    return TARGETS[target].os != "macos" or TARGETS[host].os == "macos"

def host_of(host_constraints):
    """The host of @platforms//host:constraints.bzl's HOST_CONSTRAINTS, or None."""
    names = [str(c).rpartition(":")[2] for c in host_constraints]
    for triple, t in TARGETS.items():
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
