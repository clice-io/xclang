"""The C++ toolchain of an xclang host, on rules_cc's unix toolchain config
(xclang's patched copy, bazel/repositories.bzl).

It is instantiated in the host's repository, whose files are the inputs of
the actions: the programs, clang's resource headers and the target's headers
for compiling, its libraries and compiler-rt for linking. A new release's
files make new actions, and every path on a command line or in a dependency
file is relative to the execution root (the macOS SDK's aside). xclang's
config file of the target, with its paths made relative (cfg/<target>.cfg),
picks sysroot, libc++, compiler-rt and linker, so the other flags here are
only Bazel's.
"""

load("@rules_cc//cc:cc_library.bzl", "cc_library")
load("@rules_cc//cc/toolchains:cc_toolchain.bzl", "cc_toolchain")
load("@xclang_unix_config//cc/private/toolchain:unix_cc_toolchain_config.bzl", "cc_toolchain_config")
load(":hosts.bzl", "TARGETS")

def xclang_cc_toolchain(name, host, clang_version, root, absolute_root, macos_sdk = None, target = None):
    """A cc_toolchain running on host, compiling for target (the host itself if not given).

    Args:
        name: the cc_toolchain; its file groups and config are name + "_<what>".
        host: the triple of the toolchain archive in this package.
        clang_version: the directory of lib/clang.
        root: the package's path from the execution root, external/<repository>.
        absolute_root: the package's path on disk, for what must be absolute.
        macos_sdk: the SDK of a macOS host, from xcrun.
        target: the target triple.
    """
    if native.package_relative_label(name).workspace_root != root:
        fail("the toolchain is not at %s" % root)
    target = target or host
    t = TARGETS[target]
    windows = TARGETS[host].os == "windows"
    exe = ".exe" if windows else ""

    # macOS programs built on macOS, which the sanitizers' runtimes run in.
    macos_native = TARGETS[host].os == "macos" and t.os == "macos"

    def tool(n):
        return "bin/%s%s" % (n, exe)

    scanner = "scan_deps.bat" if windows else "scan_deps.sh"
    resource = "lib/clang/" + clang_version
    config = "cfg/%s.cfg" % target

    native.filegroup(
        name = name + "_bin",
        srcs = native.glob(["bin/**"]),
    )
    native.filegroup(
        name = name + "_compiler_files",
        srcs = [name + "_bin", config, scanner] + native.glob([resource + "/include/**"]) +
               native.glob([target + "/" + p for p in t.headers]),
    )
    native.filegroup(
        name = name + "_linker_files",
        srcs = [name + "_bin", config] +
               native.glob([resource + "/lib/" + t.runtime + "/**"]) +
               native.glob([target + "/" + p for p in t.libraries]),
    )
    native.filegroup(
        name = name + "_all_files",
        srcs = [name + "_compiler_files", name + "_linker_files"],
    )

    tool_paths = {
        "ar": tool("llvm-ar"),
        "cpp": tool("clang-cpp"),
        "dwp": tool("llvm-dwp"),
        "gcc": tool("clang"),
        "gcov": tool("llvm-cov"),
        "ld": tool("ld.lld"),
        "llvm-cov": tool("llvm-cov"),
        "llvm-profdata": tool("llvm-profdata"),
        "nm": tool("llvm-nm"),
        "objcopy": tool("llvm-objcopy"),
        "objdump": tool("llvm-objdump"),
        "strip": tool("llvm-strip"),
        "cpp-module-deps-scanner": scanner,
    }

    # The config file in place of bin/<target>.cfg.
    flags = ["--no-default-config", "--config=%s/%s" % (root, config), "--target=" + target]
    builtin_dirs = [resource + "/include"] + [target + "/" + p.removesuffix("/**") for p in t.headers]

    link_flags = flags + ["--driver-mode=g++", "-no-canonical-prefixes"]
    sanitizer_link_flags = []

    # lld's --gc-sections, on for Linux and off for Windows (bazel/BUILD.bazel).
    gc_sections = [Label("//bazel:gc_sections")]
    opt_link_flags = []
    if macos_native:
        # The sanitizers' runtimes are shared libraries on macOS, which the
        # programs find by an absolute path into the toolchain. (Only the
        # sanitizer features add it: it makes the link's key the checkout's.)
        sanitizer_link_flags = ["-Wl,-rpath,%s/%s/lib/darwin" % (absolute_root, resource)]
    if t.os == "macos":
        # The SDK is Xcode's. Its parent directory too: clang reports
        # SDKSettings.json under the versioned SDK name, not the symlink.
        builtin_dirs += [macos_sdk, macos_sdk.rpartition("/")[0]]
        flags += ["-isysroot", macos_sdk]
        opt_link_flags = ["-Wl,-dead_strip"]
        tool_paths["libtool"] = tool("llvm-libtool-darwin")

    cc_toolchain_config(
        name = name + "_config",
        abi_libc_version = "local",
        abi_version = "local",
        compiler = "clang",
        compile_flags = flags,
        coverage_compile_flags = ["-fprofile-instr-generate", "-fcoverage-mapping"],
        coverage_link_flags = ["-fprofile-instr-generate"],
        cpu = t.cpu,
        cxx_builtin_include_directories = builtin_dirs,
        dbg_compile_flags = ["-g"],
        extra_enabled_features = gc_sections if t.os == "linux" else [],
        extra_known_features = gc_sections if t.os == "windows" else [],
        host_system_name = host,
        link_flags = link_flags,
        opt_compile_flags = ["-O2", "-DNDEBUG", "-ffunction-sections", "-fdata-sections"],
        opt_link_flags = opt_link_flags,
        sanitizer_link_flags = sanitizer_link_flags,
        target_libc = t.libc,
        target_system_name = target,
        tool_paths = tool_paths,
        toolchain_identifier = "xclang-" + target,
        unfiltered_compile_flags = [
            # Paths relative to the execution root for clang's own files too.
            "-no-canonical-prefixes",
            # C++20 modules: the paths in a module file relative to the working
            # directory, the execution root, as the path of a module file's
            # module is not: the same module file wherever it is built.
            "-Xclang",
            "-fmodule-file-home-is-cwd",
            # Keep __DATE__ and friends out of the outputs, as rules_cc's
            # detection does.
            "-Wno-builtin-macro-redefined",
            "-D__DATE__=\"redacted\"",
            "-D__TIMESTAMP__=\"redacted\"",
            "-D__TIME__=\"redacted\"",
        ],
    )

    cc_toolchain(
        name = name,
        all_files = name + "_all_files",
        ar_files = name + "_bin",
        as_files = name + "_compiler_files",
        compiler_files = name + "_compiler_files",
        coverage_files = name + "_bin",
        dwp_files = name + "_bin",
        linker_files = name + "_linker_files",
        objcopy_files = name + "_bin",
        strip_files = name + "_bin",
        supports_param_files = 1,
        toolchain_config = name + "_config",
    )

def xclang_std_modules(name, target, root):
    """libc++'s std and std.compat modules of target, as a cc_library: a
    target importing them depends on it and has the cpp_modules feature.

    Args:
        name: the cc_library.
        target: the target triple.
        root: the package's path from the execution root.
    """
    share = "%s/%s/share/libc++/v1" % (target, "usr" if TARGETS[target].os == "linux" else "")
    share = share.replace("//", "/")
    cc_library(
        name = name,
        # libc++.modules.json: the module sources, with their directory as a
        # system include directory, and the warnings libc++'s own build
        # turns off for them.
        copts = [
            "-isystem",
            "%s/%s" % (root, share),
            "-Wno-reserved-module-identifier",
            "-Wno-reserved-user-defined-literal",
        ],
        features = ["cpp_modules"],
        module_interfaces = [share + "/std.cppm", share + "/std.compat.cppm"],
        textual_hdrs = native.glob([share + "/std/*.inc", share + "/std.compat/*.inc"]),
        visibility = ["//visibility:public"],
    )
