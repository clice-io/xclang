"""The repositories of the xclang module (bazel/extensions.bzl): a host's
toolchain, libclang and the option tables from the release archives,
rules_cc's unix toolchain config with xclang's changes, and the macOS SDK."""

load(":hosts.bzl", "TARGETS", "host_triple")
load(":libclang.bzl", "libclang_build")

_URL = "https://github.com/clice-io/xclang/releases/download/{version}/{name}"

def _download(rctx, name, strip_prefix):
    sha256 = rctx.attr.sha256.get(name)
    if not sha256:
        fail("xclang %s has no %s" % (rctx.attr.version, name))
    rctx.download_and_extract(
        url = _URL.format(version = rctx.attr.version, name = name),
        sha256 = sha256,
        strip_prefix = strip_prefix,
    )

def _link(rctx, root):
    """The repository as a directory unpacked by hand (XCLANG_ROOT and the like)."""
    for entry in rctx.path(root).readdir():
        rctx.symlink(entry, entry.basename)

_ARCHIVE_ATTRS = {
    "version": attr.string(mandatory = True),
    "sha256": attr.string_dict(mandatory = True, doc = "Archive name to sha256, bazel/versions.bzl"),
}

# C++20 modules: rules_cc runs this in place of clang-scan-deps, which writes
# the P1689 dependencies to stdout. The tools are found next to the script, so
# no absolute path reaches the command line.
_SCAN_DEPS_SH = """\
#!/bin/sh
dir=$(dirname "$0")
exec "$dir/bin/clang-scan-deps" -format=p1689 -- "$dir/bin/clang++" "$@" > "$DEPS_SCANNER_OUTPUT_FILE"
"""

_SCAN_DEPS_BAT = """\
@echo off\r
"%~dp0bin\\clang-scan-deps.exe" -format=p1689 -- "%~dp0bin\\clang++.exe" %* > "%DEPS_SCANNER_OUTPUT_FILE%"\r
"""

# macOS: Apple's ld, found by clang through -B before the system's. ld loads
# the -lto_library clang names (xclang's libLTO.dylib, for libclang's ThinLTO
# bitcode) only by an absolute path, and clang gives it relative to the
# execution root; ld falls back to Xcode's own libLTO otherwise.
_LD = """\
#!/bin/sh
n=$#
prev=
while [ "$n" -gt 0 ]; do
  arg=$1
  shift
  n=$((n - 1))
  if [ "$prev" = -lto_library ]; then
    case $arg in /*) ;; *) arg=$PWD/$arg ;; esac
  fi
  set -- "$@" "$arg"
  prev=$arg
done
exec /usr/bin/ld "$@"
"""

def _toolchain_impl(rctx):
    host = rctx.attr.host
    local = rctx.getenv("XCLANG_ROOT")
    if local:
        _link(rctx, local)
    else:
        _download(rctx, "xclang-%s-%s.tar.xz" % (rctx.attr.version, host), "xclang")
    versions = rctx.path("lib/clang").readdir()
    if len(versions) != 1:
        fail("expected one directory in lib/clang, found %s" % versions)
    clang_version = versions[0].basename

    # Each target's config file with the paths relative to the execution root,
    # where the toolchain's actions run: clang makes a config file's
    # directory absolute, which would put the sandbox's path into the
    # dependency files.
    root = "external/" + rctx.name
    for target, t in TARGETS.items():
        text = rctx.read("bin/%s.cfg" % t.cfg).replace("<CFGDIR>/..", root)
        if "<CFGDIR>" in text:
            fail("bin/%s.cfg has paths other than <CFGDIR>/.." % t.cfg)
        rctx.file("cfg/%s.cfg" % target, "# bin/%s.cfg for Bazel (bazel/repositories.bzl).\n%s-resource-dir=%s/lib/clang/%s\n" % (
            t.cfg,
            text,
            root,
            clang_version,
        ))
    if TARGETS[host].os == "windows":
        rctx.file("scan_deps.bat", _SCAN_DEPS_BAT)
    else:
        rctx.file("scan_deps.sh", _SCAN_DEPS_SH, executable = True)
    macos = TARGETS[host].os == "macos"
    if macos:
        rctx.file("libexec/ld", _LD, executable = True)
    rctx.file("BUILD.bazel", """\
load({toolchain_bzl}, "xclang_cc_toolchain", "xclang_std_modules")
{sdk_load}
package(default_visibility = ["//visibility:public"])

exports_files(glob(["bin/**"]))

xclang_cc_toolchain(
    name = "cc",
    absolute_root = {absolute_root},
    clang_version = {clang_version},
    host = {host},
    macos_sdk = {sdk},
    root = {root},
)

xclang_std_modules(
    name = "std",
    root = {root},
    target = {host},
)
""".format(
        toolchain_bzl = json.encode(str(Label("//bazel:toolchain.bzl"))),
        sdk_load = 'load("@xclang_macos_sdk//:sdk.bzl", "SDK")\n' if macos else "",
        absolute_root = json.encode(str(rctx.path(".")).replace("\\", "/")),
        clang_version = json.encode(clang_version),
        host = json.encode(host),
        sdk = "SDK" if macos else "None",
        root = json.encode(root),
    ))

xclang_toolchain = repository_rule(
    implementation = _toolchain_impl,
    attrs = _ARCHIVE_ATTRS | {
        "host": attr.string(mandatory = True),
    },
    doc = "A host's toolchain archive, or the directory XCLANG_ROOT names, and its cc_toolchain.",
)

def _libclang_impl(rctx):
    host = host_triple(rctx)
    variant = "-asan" if rctx.attr.asan else ""
    local = rctx.getenv("XCLANG_LIBCLANG_ASAN_ROOT" if rctx.attr.asan else "XCLANG_LIBCLANG_ROOT")
    if local:
        _link(rctx, local)
    else:
        name = "libclang-%s-%s%s.tar.xz" % (rctx.attr.version, host, variant)
        if rctx.attr.asan and name not in rctx.attr.sha256:
            fail("xclang %s has no ASan libclang for %s, only for %s" % (
                rctx.attr.version,
                host,
                ", ".join([n[len("libclang-%s-" % rctx.attr.version):-len("-asan.tar.xz")] for n in rctx.attr.sha256 if n.endswith("-asan.tar.xz")]),
            ))
        _download(rctx, name, "libclang" + variant)
    rctx.file("BUILD.bazel", libclang_build(rctx))

xclang_libclang = repository_rule(
    implementation = _libclang_impl,
    attrs = _ARCHIVE_ATTRS | {
        "asan": attr.bool(),
    },
    doc = "The host's libclang archive (or XCLANG_LIBCLANG_ROOT), a cc_library per library of its CMake export files.",
)

def _option_inc_impl(rctx):
    _download(rctx, "llvm-option-inc-%s.tar.xz" % rctx.attr.version, "llvm-option-inc")
    rctx.file("BUILD.bazel", """\
load("@rules_cc//cc:cc_library.bzl", "cc_library")

# clang's, lld's, llvm-lib's and llvm-dlltool's option tables, included as
# <llvm-options-td/clang-Driver-Options.inc> and so on.
cc_library(
    name = "llvm_option_inc",
    hdrs = glob(["include/**"]),
    includes = ["include"],
    visibility = ["//visibility:public"],
)
""")

xclang_option_inc = repository_rule(
    implementation = _option_inc_impl,
    attrs = _ARCHIVE_ATTRS,
    doc = "The option tables (llvm-option-inc) as a header-only cc_library.",
)

_UNIX_CONFIG = "cc/private/toolchain/unix_cc_toolchain_config.bzl"

def _unix_config_impl(rctx):
    rctx.file(_UNIX_CONFIG, rctx.read(Label("@rules_cc//cc/private/toolchain:unix_cc_toolchain_config.bzl")))
    for patch in rctx.attr._patches:
        rctx.patch(patch, strip = 1)
    rctx.file("BUILD.bazel", "")
    rctx.file("cc/private/toolchain/BUILD.bazel", "")

xclang_unix_config = repository_rule(
    implementation = _unix_config_impl,
    attrs = {
        "_patches": attr.label_list(default = [
            Label("//bazel:rules_cc-mingw.patch"),
            Label("//bazel:rules_cc-xclang.patch"),
        ]),
    },
    doc = """rules_cc's unix toolchain config, from the rules_cc of the build, with
xclang's patches: Windows names for MinGW's executables and DLLs
(rules_cc-mingw.patch), and xclang's defaults (rules_cc-xclang.patch): static
linking unless a target asks for the supports_dynamic_linker feature, other
repositories' headers as system headers (external_include_paths), and the
sanitizer features' link flags (sanitizer_link_flags). Its loads are rules_cc's
public files, so a copy works from here; no consumer needs an override of
rules_cc.""",
)

def _macos_sdk_impl(rctx):
    sdk = ""
    if rctx.os.name.lower().startswith("mac"):
        # xcrun follows these.
        rctx.getenv("DEVELOPER_DIR")
        rctx.getenv("SDKROOT")
        res = rctx.execute(["xcrun", "--show-sdk-path"])
        if res.return_code != 0:
            fail("xcrun --show-sdk-path failed: " + res.stderr)
        sdk = res.stdout.strip()
    rctx.file("BUILD.bazel", "")
    rctx.file("sdk.bzl", "SDK = %s\n" % json.encode(sdk))

xclang_macos_sdk = repository_rule(
    implementation = _macos_sdk_impl,
    configure = True,
    doc = "The path of Xcode's macOS SDK, the one part of the toolchain not in the archive.",
)

def _thinlto_cache_impl(rctx):
    path = (rctx.getenv("XCLANG_THINLTO_CACHE") or "").replace("\\", "/").rstrip("/")
    args = []
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
        args = ["-Wl,-cache_path_lto," + path, "-Wl,--thinlto-cache-dir=" + path]
    rctx.file("BUILD.bazel", """\
load("@rules_cc//cc/toolchains:args.bzl", "cc_args")
load("@rules_cc//cc/toolchains:feature.bzl", "cc_feature")

# The linker's ThinLTO cache in XCLANG_THINLTO_CACHE (bazel/repositories.bzl);
# no flags without it.
cc_feature(
    name = "thinlto_cache",
    args = {args},
    feature_name = "thinlto_cache",
    visibility = ["//visibility:public"],
)
""".format(args = json.encode([":args"] if args else [])) + ("" if not args else """
cc_args(
    name = "args",
    actions = ["@rules_cc//cc/toolchains/actions:link_actions"],
    args = select({{
        # Apple's ld, with xclang's libLTO.
        "@platforms//os:macos": [{apple}],
        "//conditions:default": [{lld}],
    }}),
)
""".format(apple = json.encode(args[0]), lld = json.encode(args[1]))))

xclang_thinlto_cache = repository_rule(
    implementation = _thinlto_cache_impl,
    doc = """The thinlto_cache feature of every xclang toolchain: with
--repo_env=XCLANG_THINLTO_CACHE=<absolute directory>, links that do ThinLTO
(of libclang's bitcode) keep the code they generate per module there and reuse
it, so a link after the first takes seconds rather than minutes. The output is
the same with and without it. The directory is made if missing, and is on the
links' command lines: one path for every checkout keeps their actions shared
by a disk or remote cache. Sandboxed links (Linux, macOS) need it writable:
--sandbox_writable_path=<the same directory>.""",
)
