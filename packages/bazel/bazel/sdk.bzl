"""The vendor SDKs, which a project fetches when its root module accepts the
vendor's license (docs/en/design/vendor-sdks.md):

    xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
    xclang.windows_sdk(accept_license = True)
    xclang.macos_sdk(accept_license = True)

Microsoft's CRT, STL and Windows SDK for the MSVC targets, a repository per
architecture, and Apple's macOS SDK for the macOS targets off macOS hosts
(on them, Xcode's). Each is fetched when a build first uses it: the host
toolchain's xclang command lists the packages its version table pins
(xclang sdk packages), Bazel downloads them by sha256 into its repository
cache, and the command unpacks them from there (xclang sdk fetch --cache),
with links for the spellings Windows code uses on a case-sensitive file
system. The SDK stays in the output base, an input of the actions and none
of their outputs."""

load(":hosts.bzl", "TARGETS", "VENDORS", "host_triple")

_DOCS = "https://docs.clice.io/xclang/integrations/bazel#vendor-sdks"

def _sdks_impl(rctx):
    rctx.file("BUILD.bazel", "")
    rctx.file("sdks.bzl", "# The vendor SDKs the root module fetches (bazel/sdk.bzl).\nSDKS = %s\n" % json.encode(rctx.attr.sdks))

xclang_sdks = repository_rule(
    implementation = _sdks_impl,
    attrs = {"sdks": attr.string_list()},
    doc = "sdks.bzl: SDKS, the vendors whose SDK the root module fetches, for the toolchains' registration (bazel/toolchains).",
)

# The STL's std and std.compat modules (VC/Tools/MSVC/<toolset>/modules), as
# libc++'s are for the other targets (bazel/toolchain.bzl): copies named
# .cppm, which clang compiles as module units, that include <malloc.h>
# before the module as the other C headers: for arm64, clang 23 otherwise
# takes the _alloca of <malloc.h>, which the STL includes in the module's
# purview, for a second declaration (packages/cmake does the same).
_STL_BUILD = """\
load("@rules_cc//cc:cc_library.bzl", "cc_library")

cc_library(
    name = "std",
    copts = [
        "-Wno-include-angled-in-module-purview",
        "-Wno-reserved-module-identifier",
    ],
    features = ["cpp_modules"],
    module_interfaces = ["modules/std.cppm", "modules/std.compat.cppm"],
    visibility = ["//visibility:public"],
)
"""

# An MSVC toolset older than the std modules (Visual Studio 2022 17.5).
_NO_STL_MODULES = """\
load("@xclang//bazel:unsupported.bzl", "xclang_unsupported_toolchain")

xclang_unsupported_toolchain(
    name = "std",
    message = "MSVC {toolset} has no std module (VC/Tools/MSVC/{toolset}/modules/std.ixx): a newer one has",
    visibility = ["//visibility:public"],
)
"""

def _vendor_sdk_impl(rctx):
    vendor = rctx.attr.vendor
    tag = "xclang.%s_sdk(accept_license = True)" % vendor
    if not rctx.attr.enabled:
        fail("the %s SDK is fetched once the root module accepts its license: %s in its MODULE.bazel (%s)" % (vendor, tag, _DOCS))
    host = host_triple(rctx)
    xclang = str(rctx.path(Label("@xclang_%s//:bin/xclang%s" % (host, ".exe" if TARGETS[host].os == "windows" else ""))))
    if not rctx.attr.accept_license:
        # The command prints the terms and stops.
        terms = rctx.execute([xclang, "sdk", "fetch", vendor])
        fail("%s\n\nThe root module accepts them with %s." % (terms.stderr.strip(), tag))

    selection = []
    for option, value in [
        ("--preset", rctx.attr.preset),
        ("--version", rctx.attr.version),
        ("--msvc-version", rctx.attr.msvc_version),
        ("--sdk-version", rctx.attr.sdk_version),
        ("--arch", rctx.attr.arch),
    ]:
        if value:
            selection += [option, value]

    res = rctx.execute([xclang, "sdk", "packages", vendor, "--json"] + selection)
    if res.return_code != 0:
        fail("xclang sdk packages %s failed (the xclang command of 23.1.2.10 or later lists them): %s" % (vendor, res.stderr))
    listed = json.decode(res.stdout)
    size = 0
    for p in listed["packages"]:
        size += p["size"]
    rctx.report_progress("Downloading the %s SDK, %d MB" % (vendor, size // 1000000))
    pending = [
        rctx.download(url = p["url"], output = "downloads/" + p["file"], sha256 = p["sha256"], block = False)
        for p in listed["packages"]
    ]
    for download in pending:
        download.wait()

    # Into sdk/<name>. (sdk/<vendor>, the SDK in use, is a link to it; on
    # Windows a junction, absolute: the SDK stays where the command unpacks
    # it.)
    rctx.report_progress("Unpacking the %s SDK" % vendor)
    res = rctx.execute(
        [xclang, "sdk", "fetch", vendor, "--accept-license", "--cache", str(rctx.path("downloads")), "--sdk-dir", str(rctx.path("sdk"))] + selection,
        timeout = 3600,
    )
    if res.return_code != 0:
        fail("xclang sdk fetch %s failed: %s" % (vendor, res.stderr))
    rctx.delete("downloads")

    # The toolchains' config files include sdk.cfg (bazel/repositories.bzl),
    # which names the SDK by its path from the execution root: for an MSVC
    # target, the config file the command writes into the SDK, with the
    # toolset and SDK versions, which clang does not look for in a link,
    # where the headers are not.
    sdk = "sdk/" + listed["name"]
    path = "external/%s/%s" % (rctx.name, sdk)
    if vendor == "macos":
        _unlink_cycles(rctx, rctx.path(sdk))
        rctx.file("sdk.cfg", "# Apple's macOS SDK (bazel/sdk.bzl).\n-isysroot %s\n" % path)

        # Compiles read headers and module maps, by the paths of the
        # frameworks' links (Foo.framework/Headers); links the libraries'
        # stubs, also by the install names of those another re-exports
        # (Foo.framework/Versions/A/Foo.tbd), and the SDK's version.
        build = """\
# Apple's macOS SDK (bazel/sdk.bzl).
filegroup(
    name = "compiler_files",
    srcs = ["sdk.cfg"] + glob(
        ["{sdk}/**"],
        exclude = ["{sdk}/**/Versions/**", "{sdk}/**/*.tbd"],
    ),
    visibility = ["//visibility:public"],
)

filegroup(
    name = "linker_files",
    srcs = ["sdk.cfg"] + glob(["{sdk}/**/*.tbd", "{sdk}/SDKSettings.*"]),
    visibility = ["//visibility:public"],
)
""".format(sdk = sdk)
    else:
        triple = rctx.attr.arch + "-pc-windows-msvc"
        rctx.file("sdk.cfg", rctx.read("%s/%s.cfg" % (sdk, triple)).replace("<CFGDIR>", path))
        tools = rctx.path(sdk + "/VC/Tools/MSVC").readdir()
        if len(tools) != 1:
            fail("expected one toolset in VC/Tools/MSVC, found %s" % tools)
        modules = "%s/VC/Tools/MSVC/%s/modules" % (sdk, tools[0].basename)
        stl = _STL_BUILD
        if not rctx.path(modules + "/std.ixx").exists:
            stl = _NO_STL_MODULES.format(toolset = tools[0].basename)
        for name in ["std", "std.compat"] if stl == _STL_BUILD else []:
            text = rctx.read("%s/%s.ixx" % (modules, name))
            for eol in ["\r\n", "\n"]:
                text = text.replace("\n#include <intrin.h>" + eol, "\n#include <intrin.h>%s#include <malloc.h>%s" % (eol, eol))
            rctx.file("modules/%s.cppm" % name, text)
        build = """\
# Microsoft's CRT, STL and Windows SDK for {triple}, laid out as a
# /winsysroot (bazel/sdk.bzl).
filegroup(
    name = "compiler_files",
    srcs = ["sdk.cfg"] + glob([
        "{sdk}/VC/Tools/MSVC/*/include/**",
        "{sdk}/Windows Kits/10/Include/**",
    ]),
    visibility = ["//visibility:public"],
)

filegroup(
    name = "linker_files",
    srcs = ["sdk.cfg"] + glob([
        "{sdk}/VC/Tools/MSVC/*/lib/**",
        "{sdk}/Windows Kits/10/Lib/**",
    ]),
    visibility = ["//visibility:public"],
)
""".format(triple = triple, sdk = sdk) + stl
    rctx.file("BUILD.bazel", build)

def _real(path, windows):
    """The real path of path, compared as the file system does: on Windows in any case."""
    text = str(path.realpath).replace("\\", "/")
    return text.lower() if windows else text

def _unlink_cycles(rctx, root):
    """Removes the links under root that point to a directory they are in,
    such as Ruby.framework's Headers/ruby/ruby to ".", which glob() would
    follow without end."""
    dirs = [root]

    windows = rctx.os.name.lower().startswith("windows")

    # Starlark has neither recursion nor while: a directory at a time, as
    # many as an SDK can have.
    for _ in range(1000000):
        if not dirs:
            return
        dir = dirs.pop()
        here = _real(dir, windows)
        for entry in dir.readdir():
            if not entry.is_dir:
                continue
            target = _real(entry, windows)
            if target == here or here.startswith(target + "/"):
                rctx.delete(entry)
            elif target == here + "/" + (entry.basename.lower() if windows else entry.basename):
                dirs.append(entry)
    fail("%s has too many directories" % root)

xclang_vendor_sdk = repository_rule(
    implementation = _vendor_sdk_impl,
    attrs = {
        "vendor": attr.string(mandatory = True, values = VENDORS),
        "enabled": attr.bool(doc = "Whether the root module has the vendor's tag; a build that needs the SDK fails without."),
        "accept_license": attr.bool(),
        "preset": attr.string(),
        "version": attr.string(doc = "macOS: the SDK's version."),
        "msvc_version": attr.string(),
        "sdk_version": attr.string(doc = "Windows: the Windows SDK's version."),
        "arch": attr.string(doc = "Windows: the architecture, x86_64 or aarch64."),
    },
    doc = "A vendor's SDK, from the vendor, by the host toolchain's xclang command and Bazel's downloader.",
)

_COMMON = {
    "accept_license": attr.bool(doc = "That the root module has read and accepts the vendor's license terms, which a build without prints."),
    "preset": attr.string(doc = "The SDK of a GitHub runner image or label (windows-2022, macos-15); by default windows-latest's and macos-latest's."),
}

windows_sdk = tag_class(
    attrs = _COMMON | {
        "msvc_version": attr.string(doc = "MSVC's version, whole or in part (14.44), in place of the preset's."),
        "sdk_version": attr.string(doc = "The Windows SDK's version, whole or in part (10.0.26100), in place of the preset's."),
    },
    doc = "Microsoft's CRT, STL and Windows SDK, which the MSVC targets build against: from Microsoft, under the Visual Studio Build Tools and Windows SDK licenses.",
)

macos_sdk = tag_class(
    attrs = _COMMON | {
        "version": attr.string(doc = "The SDK's version, whole or in part (15, 26.5), in place of the preset's."),
    },
    doc = "Apple's macOS SDK, which the macOS targets build against off macOS hosts: from Apple, under the Xcode and Apple SDKs Agreement.",
)

def vendor_sdks(mctx):
    """The repositories of the vendor SDKs, from the root module's tags:
    xclang_sdks, and xclang_windows_sdk_<arch> and xclang_macos_sdk,
    which a build that needs them without the tag fails to fetch. Another
    module's tags count for nothing: the license is accepted by the
    project that builds."""
    tags = {}
    for mod in mctx.modules:
        if not mod.is_root:
            continue
        for vendor, given in [("windows", mod.tags.windows_sdk), ("macos", mod.tags.macos_sdk)]:
            if len(given) > 1:
                fail("xclang.%s_sdk: one tag at most" % vendor)
            if given:
                tags[vendor] = given[0]
    xclang_sdks(name = "xclang_sdks", sdks = sorted(tags.keys()))
    windows = tags.get("windows")
    for arch in ["x86_64", "aarch64"]:
        xclang_vendor_sdk(
            name = "xclang_windows_sdk_" + arch,
            vendor = "windows",
            arch = arch,
            enabled = windows != None,
            accept_license = windows.accept_license if windows else False,
            preset = windows.preset if windows else "",
            msvc_version = windows.msvc_version if windows else "",
            sdk_version = windows.sdk_version if windows else "",
        )
    macos = tags.get("macos")
    xclang_vendor_sdk(
        name = "xclang_macos_sdk",
        vendor = "macos",
        enabled = macos != None,
        accept_license = macos.accept_license if macos else False,
        preset = macos.preset if macos else "",
        version = macos.version if macos else "",
    )
