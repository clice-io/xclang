"""The repositories of the xclang module (bazel/extensions.bzl): a host's
toolchain, a target's libclang and the option tables from the release
archives, rules_cc's unix toolchain config with xclang's changes, and the
macOS SDK."""

load(":hosts.bzl", "TARGETS", "host_triple")
load(":libclang.bzl", "libclang_aliases", "libclang_build")

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

# The linker of macOS targets (link_tool): clang, and for a link with the
# generate_dsym_file feature (bazel/dsym), which names the dSYM and the
# program in XCLANG_DSYM and XCLANG_DSYM_BINARY, the program's dSYM by
# dsymutil. The debug map points into the link's objects, so dsymutil runs
# in the same action, where they are; ThinLTO's are kept for it beside the
# dSYM, as clang keeps them when it compiles and links in one command, and
# the functions identical code folding merged keep their entries in the
# debug map (--keep-icf-stabs), so the dSYM has their names too.
_DSYM_LINK_SH = """\
#!/bin/sh
dir=$(dirname "$0")
[ -n "$XCLANG_DSYM" ] || exec "$dir/bin/clang" "$@"
lto="$XCLANG_DSYM.lto"
rm -rf "$lto" && mkdir -p "$lto" &&
    "$dir/bin/clang" "$@" "-Wl,-object_path_lto,$lto" -Wl,--keep-icf-stabs &&
    "$dir/bin/dsymutil" "$XCLANG_DSYM_BINARY" -o "$XCLANG_DSYM"
status=$?
rm -rf "$lto"
exit $status
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
    if TARGETS[host].os == "macos":
        rctx.file("dsym_link.sh", _DSYM_LINK_SH, executable = True)
    if TARGETS[host].os == "windows":
        rctx.file("scan_deps.bat", _SCAN_DEPS_BAT)
    else:
        rctx.file("scan_deps.sh", _SCAN_DEPS_SH, executable = True)
    macos = TARGETS[host].os == "macos"
    rctx.file("BUILD.bazel", """\
load({toolchain_bzl}, "xclang_host_toolchains")
{sdk_load}
package(default_visibility = ["//visibility:public"])

exports_files(glob(["bin/**"]))

xclang_host_toolchains(
    absolute_root = {absolute_root},
    clang_version = {clang_version},
    host = {host},
    macos_sdk = {sdk},
    root = {root},
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
    doc = "A host's toolchain archive, or the directory XCLANG_ROOT names, and its cc_toolchain for each target.",
)

def _libclang_impl(rctx):
    target = rctx.attr.target
    variant = "-asan" if rctx.attr.asan else ""

    # A build of the host's own, unpacked by hand.
    local = None
    if target == host_triple(rctx):
        local = rctx.getenv("XCLANG_LIBCLANG_ASAN_ROOT" if rctx.attr.asan else "XCLANG_LIBCLANG_ROOT")
    if local:
        _link(rctx, local)
    else:
        name = "libclang-%s-%s%s.tar.xz" % (rctx.attr.version, target, variant)
        if rctx.attr.asan and name not in rctx.attr.sha256:
            fail("xclang %s has no ASan libclang for %s, only for %s" % (
                rctx.attr.version,
                target,
                ", ".join([n[len("libclang-%s-" % rctx.attr.version):-len("-asan.tar.xz")] for n in rctx.attr.sha256 if n.endswith("-asan.tar.xz")]),
            ))
        _download(rctx, name, "libclang" + variant)
    rctx.file("BUILD.bazel", libclang_build(rctx))

xclang_libclang = repository_rule(
    implementation = _libclang_impl,
    attrs = _ARCHIVE_ATTRS | {
        "asan": attr.bool(),
        "target": attr.string(mandatory = True),
    },
    doc = """A target's libclang archive (or, the host's, XCLANG_LIBCLANG_ROOT), a
cc_library per library of its CMake export files.""",
)

def _libclang_aliases_impl(rctx):
    rctx.file("BUILD.bazel", libclang_aliases(rctx.attr.prefix, rctx.attr.asan_prefix))

xclang_libclang_aliases = repository_rule(
    implementation = _libclang_aliases_impl,
    attrs = {
        "prefix": attr.string(mandatory = True),
        "asan_prefix": attr.string(doc = "With --features=asan, the repositories of the ASan build instead."),
    },
    doc = """@libclang (@libclang_asan): every target of a libclang repository, of the
target platform's (prefix + triple), which is fetched only when built for;
@libclang's is the ASan build's (asan_prefix + triple) with --features=asan.""",
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
repositories' headers as system headers (external_include_paths), the
sanitizer features' link flags (sanitizer_link_flags), a program of the
links' own (link_tool), and on macOS the libraries' defines in C++20 module
compiles and scans (preprocessor_defines). Its loads are rules_cc's
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
