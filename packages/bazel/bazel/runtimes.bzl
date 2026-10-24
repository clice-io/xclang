"""The C++ runtimes built from source (--@xclang//runtimes:source,
runtimes/BUILD.bazel): libc++ with libc++abi, libc++experimental and
libunwind, compiled from the toolchain's libc++/src as LLVM's CMake build
compiles them (runtimes_sources.bzl), and MemorySanitizer's runtime, which
the toolchain has not.

They are libraries of the host's repository (xclang_runtimes), built for the
target platform in a configuration of their own, the build's with
//runtimes:building set: the same toolchain compiles them, without them
(bazel/toolchain.bzl), so the build's sanitizer features instrument them,
but for libunwind and MemorySanitizer's runtime, which stay uninstrumented;
none of them is compiled to ThinLTO's bitcode (thin_lto), whose backends
Bazel runs only for the libraries it links. Their __config_site is the
target's, with the options of //runtimes; the build against them takes it
before libc++'s other headers, and links their libraries in place of the
prebuilt ones.
"""

load("@bazel_skylib//rules:common_settings.bzl", "BuildSettingInfo")
load("@rules_cc//cc:cc_library.bzl", "cc_library")
load("@rules_cc//cc/common:cc_info.bzl", "CcInfo")
load(":hosts.bzl", "TARGETS")
load(":runtimes_sources.bzl", "FLAGS", "GROUPS", "RUNTIMES")

# The variants of LLVM's build (//runtimes:mode_*).
_MODES = ["default", "noexcept", "nortti"]

# What libunwind and MemorySanitizer's runtime are built without; none of
# the runtimes with ThinLTO, whose backends Bazel runs for the objects of
# the libraries it knows, which these are not to it (bazel/toolchain.bzl
# links them by their paths).
_UNINSTRUMENTED = ["-asan", "-msan", "-tsan", "-ubsan", "-lsan"]

def _copts(flags, src, cxx):
    """A group's flags for Bazel: its paths in the execution root, then
    what LLVM's build leaves to the compiler's defaults, exceptions and RTTI,
    which the build's --copt (before them) does not change, and no
    warnings."""
    copts = [f.replace("$(SRC)", src).replace("$(CXX)", cxx) for f in flags]
    if "-fno-exceptions" not in flags:
        copts.append("-fexceptions")
    if "-fno-rtti" not in flags:
        copts.append("-frtti")
    return copts + ["-w"]

def _building_impl(_settings, _attr):
    return {str(Label("//runtimes:building")): True}

_building = transition(
    implementation = _building_impl,
    inputs = [],
    outputs = [str(Label("//runtimes:building"))],
)

def _runtime_files_impl(ctx):
    files = []
    for dep in ctx.attr.srcs:
        if CcInfo in dep:
            for linker_input in dep[CcInfo].linking_context.linker_inputs.to_list():
                for library in linker_input.libraries:
                    archive = library.pic_static_library or library.static_library
                    if archive and archive not in files:
                        files.append(archive)
        else:
            files.extend(dep[DefaultInfo].files.to_list())
    return [DefaultInfo(files = depset(files))]

xclang_runtime_files = rule(
    implementation = _runtime_files_impl,
    attrs = {
        "srcs": attr.label_list(cfg = _building),
    },
    doc = "The files of srcs, built in the runtimes' configuration: a library's archives.",
)

def _config_site_impl(ctx):
    setting = lambda name: getattr(ctx.attr, "_" + name)[BuildSettingInfo].value
    version = setting("abi_version")
    namespace = setting("abi_namespace") or "__" + version
    if not namespace.startswith("__"):
        fail("--@xclang//runtimes:abi_namespace=%s: libc++'s inline namespace is a reserved identifier, __<name>" % namespace)
    defines = setting("abi_defines")
    for define in defines:
        if not define.startswith("_LIBCPP_ABI_"):
            fail("--@xclang//runtimes:abi_defines: %s is none of libc++'s ABI macros, _LIBCPP_ABI_*" % define)
    mode = {"none": "2", "fast": "4", "extensive": "16", "debug": "8"}[setting("hardening")]
    pop = "#ifdef __clang__\n#  pragma clang diagnostic pop"
    ctx.actions.expand_template(
        template = ctx.file.base,
        output = ctx.outputs.out,
        # As libc++'s CMake writes them (libcxx/include/__config_site.in).
        substitutions = {
            "#define _LIBCPP_ABI_VERSION 1\n": "#define _LIBCPP_ABI_VERSION %s\n" % version,
            "#define _LIBCPP_ABI_NAMESPACE __1\n": "#define _LIBCPP_ABI_NAMESPACE %s\n" % namespace,
            "#define _LIBCPP_HARDENING_MODE_DEFAULT 2\n": "#define _LIBCPP_HARDENING_MODE_DEFAULT %s\n" % mode,
            "#define _LIBCPP_INSTRUMENTED_WITH_ASAN 0\n": "#define _LIBCPP_INSTRUMENTED_WITH_ASAN %d\n" % (1 if ctx.attr.asan else 0),
            "#endif\n\n\n\n\n" + pop: "#endif\n\n" + "\n".join(["#define " + d for d in defines]) + "\n\n\n" + pop,
        },
    )

_xclang_config_site = rule(
    implementation = _config_site_impl,
    attrs = {
        "asan": attr.bool(doc = "libc++ instrumented with ASan: its containers' annotations."),
        "base": attr.label(allow_single_file = True, mandatory = True, doc = "The target's __config_site."),
        "out": attr.output(mandatory = True),
        "_abi_defines": attr.label(default = Label("//runtimes:abi_defines")),
        "_abi_namespace": attr.label(default = Label("//runtimes:abi_namespace")),
        "_abi_version": attr.label(default = Label("//runtimes:abi_version")),
        "_hardening": attr.label(default = Label("//runtimes:hardening")),
    },
    doc = "The variant's __config_site: the target's, with the options of //runtimes.",
)

def _unsupported_impl(ctx):
    fail(ctx.attr.message)

_unsupported = rule(
    implementation = _unsupported_impl,
    attrs = {"message": attr.string(mandatory = True)},
)

# The options of the runtimes from source but //runtimes:source, with their
# defaults: the prebuilt runtimes' (runtimes/BUILD.bazel).
_OPTIONS = {
    "abi_defines": [],
    "abi_namespace": "",
    "abi_version": "1",
    "exceptions": True,
    "hardening": "none",
    "rtti": True,
}

def _check_impl(ctx):
    setting = lambda name: getattr(ctx.attr, "_" + name)[BuildSettingInfo].value
    source = setting("source")
    options = [name for name, default in _OPTIONS.items() if setting(name) != default]
    if ctx.attr.msvc and source:
        fail(("xclang: --@xclang//runtimes:source is not available for the MSVC targets yet (%s): they build " +
              "against the prebuilt libc++") % ctx.attr.target)
    if options and not source:
        fail("xclang: --@xclang//runtimes:%s is for the runtimes built from source: --@xclang//runtimes:source%s" %
             (options[0], ", which the MSVC targets do not have yet" if ctx.attr.msvc else ""))
    if "msan" in ctx.features:
        if not ctx.attr.msan:
            fail("xclang: MemorySanitizer is for the Linux targets (glibc), x86_64 and aarch64, not %s" % ctx.attr.target)
        if not source:
            fail("xclang: --features=msan needs every library instrumented, libc++ too, and MemorySanitizer's " +
                 "runtime, which the toolchain has not: the runtimes built from source, --@xclang//runtimes:source")
    for feature, sanitizer in _SANITIZERS.items():
        if feature in ctx.features and feature not in ctx.attr.sanitizers:
            fail("xclang: this release of xclang has no %s for %s (--features=%s); its sanitizer features are %s" %
                 (sanitizer, ctx.attr.target, feature, ", ".join(ctx.attr.sanitizers)))
    return [DefaultInfo()]

# The sanitizer features of the prebuilt runtimes, by what they turn on.
_SANITIZERS = {
    "asan": "AddressSanitizer",
    "lsan": "LeakSanitizer",
    "tsan": "ThreadSanitizer",
    "ubsan": "UBSan",
}

xclang_runtimes_check = rule(
    implementation = _check_impl,
    attrs = dict(
        [("_" + name, attr.label(default = Label("//runtimes:" + name))) for name in ["source"] + list(_OPTIONS)],
        msan = attr.bool(doc = "The target has MemorySanitizer, with the runtimes from source."),
        msvc = attr.bool(doc = "An MSVC target, which has no runtimes from source yet."),
        sanitizers = attr.string_list(doc = "The sanitizer features the target's runtimes have, msan aside."),
        target = attr.string(mandatory = True),
    ),
    doc = """Fails the analysis of a toolchain (bazel/toolchain.bzl) for target with
what of //runtimes and the sanitizer features it cannot build: the runtimes
from source or their options on an MSVC target, their options without them,
MemorySanitizer without them or on a target that has none, and a sanitizer
whose runtime the target has not (as the CMake package refuses them).""",
)

def xclang_runtimes(root):
    """The runtimes from source in a host's repository: runtime_include (the
    variant's __config_site), runtime_libraries and runtime_msan_files, built in
    the runtimes' configuration for the target platform.

    Args:
        root: the package's path from the execution root, external/<repository>.
    """
    src = root + "/libc++/src"
    cxx = root + "/libc++/include/c++/v1"
    if not native.glob(["libc++/src/runtimes/CMakeLists.txt"], allow_empty = True):
        for name in ["runtime_include", "runtime_libraries", "runtime_msan_files"]:
            _unsupported(
                name = name,
                message = "this release of xclang has no runtimes' sources (libc++/src): 23.1.2.11 and later have them",
            )
        return

    # Every header of the sources; libc++'s own are the toolchain's
    # libc++/include/c++/v1 ($(CXX)), as its CMake build copies them.
    cc_library(
        name = "runtime_headers",
        textual_hdrs = native.glob(["libc++/src/**/*.%s" % e for e in ["h", "hpp", "inc", "def", "ipp"]]),
    )
    _xclang_config_site(
        name = "runtime_config_site_file",
        asan = select({
            Label("//runtimes:asan"): True,
            "//conditions:default": False,
        }),
        base = select(
            {
                Label("//bazel:" + target): "libc++/include/%s/c++/v1/__config_site" % t.cfg
                for target, t in TARGETS.items()
            },
            no_match_error = "xclang has no runtimes for the target platform",
        ),
        out = "runtime/include/__config_site",
    )
    cc_library(
        name = "runtime_config_site",
        hdrs = [":runtime_config_site_file"],
        includes = ["runtime/include"],
    )
    _unsupported(
        name = "runtime_unsupported",
        message = "xclang builds the runtimes from source for the Linux, musl, MinGW and macOS targets, not for the target platform",
    )
    _unsupported(
        name = "runtime_msan_unsupported",
        message = "MemorySanitizer is for the Linux targets (glibc), x86_64 and aarch64",
    )

    # A library per group of sources compiled alike, of each runtime.
    for library, variants in RUNTIMES.items():
        groups = {}
        for indices in variants.values():
            for i in indices:
                groups[i] = True
        for i in groups:
            flags, srcs = GROUPS[i]
            cc_library(
                name = "runtime_%s_%d" % (library, i),
                srcs = ["libc++/src/" + s for s in srcs],
                copts = _copts(FLAGS[flags], src, cxx),
                features = ["-thin_lto"] + (_UNINSTRUMENTED if library in ["unwind", "msan", "msan_cxx"] else []),
                linkstatic = True,
                deps = [
                    ":runtime_config_site",
                    ":runtime_headers",
                ],
            )

    # Each runtime of the target platform, per variant (macOS has no
    # libunwind of its own); MemorySanitizer's in one.
    for library in ["cxx", "cxx_experimental", "unwind"]:
        for mode in _MODES:
            choices = {}
            for target, t in TARGETS.items():
                key = "%s %s" % (target, mode)
                if key in RUNTIMES[library]:
                    choices[Label("//bazel:" + target)] = [":runtime_%s_%d" % (library, i) for i in RUNTIMES[library][key]]
                elif library == "unwind" and t.os == "macos":
                    choices[Label("//bazel:" + target)] = []
                else:
                    choices[Label("//bazel:" + target)] = [":runtime_unsupported"]
            cc_library(
                name = "runtime_%s_%s" % (library, mode),
                deps = select(choices, no_match_error = "xclang has no runtimes for the target platform"),
            )
        native.alias(
            name = "runtime_" + library,
            actual = select(
                {Label("//runtimes:mode_" + mode): ":runtime_%s_%s" % (library, mode) for mode in _MODES},
                no_match_error = "--@xclang//runtimes:rtti=false needs --@xclang//runtimes:exceptions=false, as libc++ does",
            ),
        )
    for library in ["msan", "msan_cxx"]:
        cc_library(
            name = "runtime_" + library,
            deps = select({
                Label("//bazel:" + target): [
                    ":runtime_%s_%d" % (library, i)
                    for i in RUNTIMES[library].get(target + " msan", [])
                ] or [":runtime_msan_unsupported"]
                for target in TARGETS
            }),
        )

    # What the toolchain takes (bazel/toolchain.bzl), built in the runtimes'
    # configuration.
    xclang_runtime_files(
        name = "runtime_include",
        srcs = [":runtime_config_site_file"],
    )
    xclang_runtime_files(
        name = "runtime_libraries",
        srcs = [":runtime_cxx", ":runtime_cxx_experimental", ":runtime_unwind"],
    )
    xclang_runtime_files(
        name = "runtime_msan_files",
        srcs = [":runtime_msan", ":runtime_msan_cxx"],
    )
