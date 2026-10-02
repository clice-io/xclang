"""The hosts and targets of a release: a toolchain archive per host, and in
every toolchain a directory per target (README.md, "Layout")."""

# Per target: the name of its config file in bin/ (clang's name of the
# triple), its platform constraints, the cpu and target_libc of rules_cc's unix
# toolchain config, compiler-rt's directory under lib/clang/<version>/lib, and
# what of the target's directory compiling and linking read.
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
    ),
}

# Every target is a host too.
HOSTS = list(TARGETS.keys())

def constraints(triple):
    t = TARGETS[triple]
    return ["@platforms//os:" + t.os, "@platforms//cpu:" + t.arch]

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
