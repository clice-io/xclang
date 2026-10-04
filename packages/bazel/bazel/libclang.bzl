"""libclang's BUILD file, from its own CMake export files: a cc_library per
imported library (LLVMSupport, clangBasic, ...) with the link interface LLVM's
and clang's CMake packages give it, so that a consumer names the libraries it
uses and nothing else."""

def _unquote(value):
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return value.replace("${_IMPORT_PREFIX}/", "")

def _parse(text, targets):
    """Adds the imported targets of an export file and its properties to targets."""
    current = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("add_library(") and line.endswith(" IMPORTED)"):
            name, kind = line[len("add_library("):-len(" IMPORTED)")].split(" ")
            targets.setdefault(name, {})["TYPE"] = kind
        elif line.startswith("set_target_properties(") and line.endswith(" PROPERTIES"):
            current = targets.setdefault(line[len("set_target_properties("):-len(" PROPERTIES")], {})
        elif line == ")":
            current = None
        elif current != None and line:
            key, _, value = line.partition(" ")
            current[key] = _unquote(value)

def _name(target):
    # zstd::libzstd_static -> libzstd_static
    return target.rpartition("::")[2]

def libclang_build(rctx):
    """The BUILD file of an unpacked libclang archive in the repository root."""
    targets = {}

    # LLVMExports.cmake, ClangTargets.cmake, zstdTargets.cmake and their
    # per-configuration files with the libraries' locations; the Find*.cmake
    # modules next to them define targets too, of what is not in the archive.
    for package in rctx.path("lib/cmake").readdir():
        for file in package.readdir():
            if file.basename.endswith(".cmake") and ("Exports" in file.basename or "Targets" in file.basename):
                _parse(rctx.read(file), targets)
    if "LLVMSupport" not in targets or "clangBasic" not in targets:
        fail("no LLVM and clang export files under %s" % rctx.path("lib/cmake"))

    # zlib is in the archive, or the system's (macOS).
    zlib = rctx.path("lib/libz.a").exists
    rules = []
    for target, props in sorted(targets.items()):
        if props.get("TYPE") not in ("STATIC", "INTERFACE"):
            fail("%s is a %s library" % (target, props.get("TYPE")))
        locations = [v for k, v in props.items() if k.startswith("IMPORTED_LOCATION")]
        if props["TYPE"] == "STATIC" and len(locations) != 1:
            fail("%s has the locations %s" % (target, locations))
        deps = [":headers"]
        linkopts = []
        for item in props.get("INTERFACE_LINK_LIBRARIES", "").split(";"):
            # A link-only dependency, escaped in the quoted list.
            item = item.removeprefix("\\")
            if item.startswith("$<LINK_ONLY:") and item.endswith(">"):
                item = item[len("$<LINK_ONLY:"):-1]
            if not item:
                continue
            elif item in targets:
                deps.append(":" + _name(item))
            elif item == "ZLIB::ZLIB":
                if zlib:
                    deps.append(":zlib")
                else:
                    linkopts.append("-lz")
            elif item.startswith("-"):
                linkopts.append(item)
            elif "$<" in item or "::" in item or "/" in item or "." in item:
                fail("%s links %s, which is not in the archive" % (target, item))
            else:
                linkopts.append("-l" + item)
        for include in props.get("INTERFACE_INCLUDE_DIRECTORIES", "include").split(";"):
            if include != "include":
                fail("%s has the include directory %s" % (target, include))
        rules.append("""\
cc_library(
    name = {name},
    srcs = {srcs},
    linkopts = {linkopts},
    deps = {deps},
)
""".format(
            name = json.encode(_name(target)),
            srcs = json.encode(locations),
            linkopts = json.encode(linkopts),
            deps = json.encode(deps),
        ))
    if zlib:
        rules.append("""\
cc_library(
    name = "zlib",
    srcs = ["lib/libz.a"],
    deps = [":headers"],
)
""")

    return """\
load("@rules_cc//cc:cc_library.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

# The headers of every library, LLVM's .def and .inc files among them.
cc_library(
    name = "headers",
    hdrs = glob(["include/**/*.h"]),
    includes = ["include"],
    textual_hdrs = glob(
        ["include/**"],
        exclude = ["include/**/*.h"],
    ),
)

# The resource directory clang's headers and compiler-rt's are in, for a tool
# that stands in for a compiler.
filegroup(
    name = "resource_dir",
    srcs = glob(["lib/clang/**"]),
)

# How the libraries were built (xclang's manifest: LLVM version, LTO, ASan,
# assertions, RTTI, patches).
exports_files(["lib/cmake/xclang/libclang.cmake"])

""" + "\n".join(rules)
