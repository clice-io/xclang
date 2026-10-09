"""The C++ toolchains of an xclang host, on rules_cc's unix toolchain config
(xclang's patched copy, bazel/repositories.bzl): one for each target the host
builds for.

They are instantiated in the host's repository, whose files are the inputs of
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
load(":hosts.bzl", "TARGETS", "builds")
load(":unsupported.bzl", "xclang_unsupported_toolchain")

def xclang_host_toolchains(host, clang_version, root, absolute_root, macos_sdk = None):
    """The BUILD file of a host's repository: cc_<target>, the cc_toolchain for
    each target the host builds for (bazel/toolchains), and std_<target>,
    libc++'s std modules of each target (@xclang//bazel:std); cc and std are
    the host's own.

    Args:
        host: the triple of the toolchain archive in this package.
        clang_version: the directory of lib/clang.
        root: the package's path from the execution root, external/<repository>.
        absolute_root: the package's path on disk, for what must be absolute.
        macos_sdk: the SDK of a macOS host, from xcrun.
    """
    for target in TARGETS:
        if not native.glob(["cfg/%s.cfg" % target], allow_empty = True):
            # A target of a later release than this one (bazel/repositories.bzl).
            xclang_unsupported_toolchain(
                name = "cc_" + target,
                message = "this release of xclang has no %s: the musl targets are in 23.1.2.10 and later" % target,
            )
            continue
        if builds(host, target):
            xclang_cc_toolchain(
                name = "cc_" + target,
                absolute_root = absolute_root,
                clang_version = clang_version,
                host = host,
                macos_sdk = macos_sdk,
                root = root,
                target = target,
            )
        xclang_std_modules(name = "std_" + target, root = root, target = target)
    native.alias(name = "cc", actual = "cc_" + host)
    native.alias(name = "std", actual = "std_" + host)

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

    # The headers targets share (toolchain/common.ts, shareHeaders): libc++'s,
    # after the target's own __config_site, and the Windows targets'
    # mingw-w64. Releases before 23.1.2.7 have them in the target's directory.
    shared_dirs = ["libc++/include/%s/c++/v1" % t.cfg, "libc++/include/c++/v1"] + (["mingw-w64/include"] if t.os == "windows" else [])
    shared_headers = [d + "/**" for d in shared_dirs]

    # macOS targets link through dsym_link.sh, which makes the dSYM of a
    # link with the generate_dsym_file feature (bazel/dsym).
    dsym_link = ["dsym_link.sh"] if t.os == "macos" else []

    native.filegroup(
        name = name + "_bin",
        srcs = native.glob(["bin/**"]) + dsym_link,
    )
    native.filegroup(
        name = name + "_compiler_files",
        srcs = [name + "_bin", config, scanner] + native.glob([resource + "/include/**"]) +
               native.glob([target + "/" + p for p in t.headers] + shared_headers, allow_empty = True) +
               # libc++'s ASan build: none in releases before 23.1.2.5.
               (native.glob([target + "/" + t.asan_libcxx + "/include/**"], allow_empty = True) if t.asan_libcxx else []),
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
    builtin_dirs = [resource + "/include"] + [target + "/" + p.removesuffix("/**") for p in t.headers] + shared_dirs

    link_flags = flags + ["--driver-mode=g++", "-no-canonical-prefixes"]
    sanitizer_link_flags = []

    # Debug information that holds wherever the build ran, the same in every
    # sandbox and checkout: paths relative to the execution root in a Mach-O
    # program's debug map (its objects' N_OSO entries), as in the DWARF
    # (-ffile-compilation-dir below), and no link time in a PE program.
    # Debuggers map "." to the workspace's bazel-<name> (docs/en/integrations/bazel.md).
    if t.os == "macos":
        link_flags.append("-Wl,-oso_prefix,.")
    elif t.os == "windows":
        link_flags.append("-Wl,--no-insert-timestamp")

    # The asan feature builds and links with libc++'s ASan build: its
    # __config_site turns on std::string's container checks, and its
    # libc++.a is instrumented like the code that calls it.
    asan_compile_flags = []
    asan_link_flags = []
    if t.asan_libcxx:
        asan = "%s/%s/%s" % (root, target, t.asan_libcxx)
        asan_compile_flags = ["-isystem", asan + "/include"]
        asan_link_flags = ["-nostdlib++", asan + "/libc++.a"]
        builtin_dirs.append("%s/%s/include" % (target, t.asan_libcxx))

    # lld's --gc-sections, on for Linux and off for Windows (bazel/BUILD.bazel).
    gc_sections = [Label("//bazel:gc_sections")]

    # The linker's ThinLTO cache, where XCLANG_THINLTO_CACHE names one, in
    # the spelling of the target's linker (bazel/thinlto_cache.bzl).
    thinlto_cache = [Label("@xclang_thinlto_cache//:" + ("mach_o" if t.os == "macos" else "lld"))]

    # A release's strip by the target's object format (bazel/BUILD.bazel).
    strip = [Label("//bazel:strip_all" if t.os == "macos" else "//bazel:strip_unneeded")]
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
        asan_compile_flags = asan_compile_flags,
        asan_link_flags = asan_link_flags,
        compiler = "clang",
        compile_flags = flags,
        coverage_compile_flags = ["-fprofile-instr-generate", "-fcoverage-mapping"],
        coverage_link_flags = ["-fprofile-instr-generate"],
        cpu = t.cpu,
        cxx_builtin_include_directories = builtin_dirs,
        dbg_compile_flags = ["-g"],
        extra_enabled_features = thinlto_cache + strip + (gc_sections if t.os == "linux" else []),
        extra_known_features = (gc_sections if t.os == "windows" else []) +
                               ([Label("//bazel/dsym:generate_dsym_file")] if dsym_link else []),
        host_system_name = host,
        link_flags = link_flags,
        link_tool = dsym_link[0] if dsym_link else "",
        opt_compile_flags = ["-O2", "-DNDEBUG", "-ffunction-sections", "-fdata-sections"],
        opt_link_flags = opt_link_flags,
        sanitizer_link_flags = sanitizer_link_flags,
        # A library's objects linked as they are, between --start-lib and
        # --end-lib, which lld's ELF and Mach-O drivers take (its MinGW
        # driver does not): no archive for a link, and the debug map of a
        # macOS program names each object by its path. In an archive, objects
        # of one name (foo.cppm and foo.cpp, a/foo.cpp and b/foo.cpp) are
        # lib.a(foo.o) alike, which dsymutil tells apart by name and time,
        # all 0 in Bazel's: it reads the first for both, and the dSYM lacks
        # the other's debug information.
        supports_start_end_lib = t.os != "windows",
        target_libc = t.libc,
        target_system_name = target,
        tool_paths = tool_paths,
        toolchain_identifier = "xclang-" + target,
        unfiltered_compile_flags = [
            # Paths relative to the execution root for clang's own files too.
            "-no-canonical-prefixes",
            # The compilation directory in debug information and coverage
            # mappings: ".", the execution root, not the sandbox's path.
            "-ffile-compilation-dir=.",
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
