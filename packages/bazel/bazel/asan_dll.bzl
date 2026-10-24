"""ASan's runtime of the Windows targets, a DLL, beside the programs that
load it, where Windows finds it: in bazel-bin and in their runfiles, from
which bazel run and bazel test start them.

A toolchain of the C++ runtimes (@bazel_tools//tools/cpp:cc_runtimes_toolchain_type,
which rules_cc's cc_binary, cc_test and cc_library depend on), registered for
--features=asan (bazel/toolchains), gives every program the DLL as a
dependency, and the toolchains' copy_dynamic_libraries_to_binary feature
(bazel/toolchain.bzl) puts it next to the program, as Bazel does with a
program's DLLs on Windows. The link already has its import library, which
-fsanitize=address names."""

load("@rules_cc//cc:find_cc_toolchain.bzl", "find_cc_toolchain", "use_cc_toolchain")
load("@rules_cc//cc/common:cc_common.bzl", "cc_common")
load("@rules_cc//cc/common:cc_info.bzl", "CcInfo")

def _dll_impl(ctx):
    cc_toolchain = find_cc_toolchain(ctx)
    feature_configuration = cc_common.configure_features(
        ctx = ctx,
        cc_toolchain = cc_toolchain,
        requested_features = ctx.features,
        unsupported_features = ctx.disabled_features,
    )
    library = cc_common.create_library_to_link(
        actions = ctx.actions,
        cc_toolchain = cc_toolchain,
        feature_configuration = feature_configuration,
        dynamic_library = ctx.file.dll,
        interface_library = ctx.file.interface_library,
    )
    linker_input = cc_common.create_linker_input(owner = ctx.label, libraries = depset([library]))
    return [CcInfo(linking_context = cc_common.create_linking_context(linker_inputs = depset([linker_input])))]

# Not cc_import, which itself depends on the runtimes toolchain.
xclang_asan_dll = rule(
    implementation = _dll_impl,
    attrs = {
        "dll": attr.label(allow_single_file = [".dll"], mandatory = True),
        "interface_library": attr.label(allow_single_file = [".dll.a", ".lib"], mandatory = True),
    },
    fragments = ["cpp"],
    toolchains = use_cc_toolchain(),
    doc = "ASan's DLL as a dynamic library to link, with its import library.",
)

def _runtimes_impl(ctx):
    return [platform_common.ToolchainInfo(cc_runtimes_info = struct(runtimes = ctx.attr.runtimes, copts = []))]

xclang_cc_runtimes = rule(
    implementation = _runtimes_impl,
    attrs = {"runtimes": attr.label_list(providers = [CcInfo])},
    doc = "The C++ runtimes every C++ target depends on, as rules_cc reads them from their toolchain.",
)
