"""The linker's ThinLTO cache: the thinlto_cache feature of every xclang
toolchain, with flags only where --repo_env=XCLANG_THINLTO_CACHE names an
absolute directory (bazel/toolchain.bzl picks the target's linker's)."""

def _thinlto_cache_impl(rctx):
    path = (rctx.getenv("XCLANG_THINLTO_CACHE") or "").replace("\\", "/").rstrip("/")
    flags = {"mach_o": [], "lld": []}
    if path:
        if not (path.startswith("/") or path[1:3] == ":/"):
            fail("XCLANG_THINLTO_CACHE is not an absolute path: " + path)

        # A sandbox makes a path writable only if it exists when the action
        # starts, which no action can see to: it is made here, and this
        # repository fetched again when it is gone.
        rctx.watch(path)
        if not rctx.path(path).exists:
            windows = rctx.os.name.lower().startswith("windows")
            res = rctx.execute(["cmd", "/c", "mkdir", path.replace("/", "\\")] if windows else ["mkdir", "-p", path])
            if res.return_code != 0:
                fail("cannot create %s: %s" % (path, res.stderr))
        flags = {
            # ld64.lld.
            "mach_o": ["-Wl,-cache_path_lto," + path],
            # lld for ELF and for COFF (MinGW).
            "lld": ["-Wl,--thinlto-cache-dir=" + path],
        }
    build = """\
load("@rules_cc//cc/toolchains:args.bzl", "cc_args")
load("@rules_cc//cc/toolchains:feature.bzl", "cc_feature")

# The thinlto_cache feature for Mach-O targets and for the others
# (bazel/thinlto_cache.bzl); no flags without XCLANG_THINLTO_CACHE.
"""
    for name, args in flags.items():
        build += """
cc_feature(
    name = "{name}",
    args = {feature_args},
    feature_name = "thinlto_cache",
    visibility = ["//visibility:public"],
)
""".format(name = name, feature_args = json.encode([":%s_args" % name] if args else []))
        if args:
            build += """
cc_args(
    name = "{name}_args",
    actions = ["@rules_cc//cc/toolchains/actions:link_actions"],
    args = {args},
)
""".format(name = name, args = json.encode(args))
    rctx.file("BUILD.bazel", build)

xclang_thinlto_cache = repository_rule(
    implementation = _thinlto_cache_impl,
    doc = """The thinlto_cache feature of every xclang toolchain: with
--repo_env=XCLANG_THINLTO_CACHE=<absolute directory>, links that do ThinLTO
(of libclang's bitcode, say) keep the code they generate per module there and
reuse it, so a link after the first takes seconds rather than minutes, with
the same output. The directory is made if missing, and is on the links'
command lines: one path for every checkout keeps their actions shared by a
disk or remote cache. Linux's sandbox needs it writable
(--sandbox_writable_path=<the same directory>); --features=-thinlto_cache
turns it off.""",
)
