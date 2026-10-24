"""The C++ toolchains of an xclang host, on rules_cc's unix toolchain config
(xclang's patched copy, bazel/repositories.bzl): one for each target.

They are instantiated in the host's repository, whose files are the inputs of
the actions: the programs, clang's resource headers and the target's headers
for compiling, its libraries and compiler-rt for linking, and the vendor SDK
the target builds against (bazel/sdk.bzl). A new release's files make new
actions, and every path on a command line or in a dependency file is
relative to the execution root (Xcode's SDK's aside). xclang's config file
of the target, with its paths made relative (cfg/<target>.cfg), picks
sysroot, C++ library, compiler-rt and linker, so the other flags here are
only Bazel's and the SDK's.
"""

load("@rules_cc//cc:cc_library.bzl", "cc_library")
load("@rules_cc//cc/toolchains:cc_toolchain.bzl", "cc_toolchain")
load("@xclang_unix_config//cc/private/toolchain:unix_cc_toolchain_config.bzl", "cc_toolchain_config")
load(":asan_dll.bzl", "xclang_asan_dll", "xclang_cc_runtimes")
load(":hosts.bzl", "MACOS_MIN", "TARGETS", "sdk_repository")
load(":runtimes.bzl", "xclang_runtimes", "xclang_runtimes_check")
load(":unsupported.bzl", "xclang_unsupported_toolchain")

def xclang_host_toolchains(host, clang_version, root, absolute_root, xcode_sdk = None):
    """The BUILD file of a host's repository: cc_<target>, the cc_toolchain for
    each target (bazel/toolchains registers those it builds for), and
    cc_<target>_runtimes, its C++ runtimes for --features=asan (ASan's DLL
    of the Windows targets, bazel/asan_dll.bzl);
    std_<target>, the std modules of each target's C++ library
    (@xclang//bazel:std), and the runtimes built from source
    (bazel/runtimes.bzl); cc and std are the host's own.

    Args:
        host: the triple of the toolchain archive in this package.
        clang_version: the directory of lib/clang.
        root: the package's path from the execution root, external/<repository>.
        absolute_root: the package's path on disk, for what must be absolute.
        xcode_sdk: the SDK of a macOS host, from xcrun.
    """
    xclang_runtimes(root = root)
    for target in TARGETS:
        if not native.glob(["cfg/%s.cfg" % target], allow_empty = True):
            # A target of a later release than this one (bazel/repositories.bzl).
            xclang_unsupported_toolchain(
                name = "cc_" + target,
                message = "this release of xclang has no %s: the musl targets are in 23.1.2.10 and later, the MSVC targets in 23.1.2.7" % target,
            )
            xclang_cc_runtimes(name = "cc_%s_runtimes" % target)
            continue
        xclang_cc_toolchain(
            name = "cc_" + target,
            absolute_root = absolute_root,
            clang_version = clang_version,
            host = host,
            xcode_sdk = xcode_sdk,
            root = root,
            target = target,
        )
        xclang_std_modules(name = "std_" + target, root = root, target = target)
    native.alias(name = "cc", actual = "cc_" + host)
    native.alias(name = "std", actual = "std_" + host)

def xclang_cc_toolchain(name, host, clang_version, root, absolute_root, xcode_sdk = None, target = None):
    """A cc_toolchain running on host, compiling for target (the host itself if not given).

    Args:
        name: the cc_toolchain; its file groups and config are name + "_<what>".
        host: the triple of the toolchain archive in this package.
        clang_version: the directory of lib/clang.
        root: the package's path from the execution root, external/<repository>.
        absolute_root: the package's path on disk, for what must be absolute.
        xcode_sdk: the SDK of a macOS host, from xcrun.
        target: the target triple.
    """
    if native.package_relative_label(name).workspace_root != root:
        fail("the toolchain is not at %s" % root)
    target = target or host
    t = TARGETS[target]
    windows = TARGETS[host].os == "windows"
    exe = ".exe" if windows else ""
    msvc = t.libc == "msvc"

    # The vendor SDK's repository (bazel/sdk.bzl), which the config file
    # names (bazel/repositories.bzl): its files are the actions' inputs, and
    # it is a builtin include directory.
    sdk = sdk_repository(host, target)

    # macOS programs built on macOS, which the sanitizers' runtimes run in.
    macos_native = TARGETS[host].os == "macos" and t.os == "macos"

    def tool(n):
        return "bin/%s%s" % (n, exe)

    scanner = "scan_deps.bat" if windows else "scan_deps.sh"
    resource = "lib/clang/" + clang_version
    config = "cfg/%s.cfg" % target

    # The C++ runtimes built from source (bazel/runtimes.bzl), for the targets
    # but the MSVC ones: with them, the config file without the C++ library's
    # headers (bazel/repositories.bzl), in the configuration that builds them
    # too; the variant's __config_site and the other headers of libc++ in
    # their place, and their libraries in place of the prebuilt ones.
    runtimes = not msvc
    source_build = Label("//runtimes:source_build")
    runtime_compiler_files = []
    runtime_linker_files = []

    # The platform's C++ library (--@xclang//bazel:stdlib=platform): the
    # config file without xclang's libc++ (bin/<target>-system.cfg,
    # patches/0018), for the MSVC targets Microsoft's STL, for the macOS
    # ones the SDK's libc++. Only those: the others' is in a sysroot outside
    # the toolchain. Nor with the runtimes from source, which are libc++.
    system = msvc or t.os == "macos"
    system_config = "cfg/%s-system.cfg" % target
    config_flag = ["--config=%s/%s" % (root, config)]
    system_flag = ["--config=%s/%s" % (root, system_config)]
    if runtimes:
        configs = {
            Label("//bazel:stdlib_libcxx_source"): ["--config=%s/cfg/%s-runtimes.cfg" % (root, target)],
            Label("//bazel:stdlib_libcxx_prebuilt"): config_flag,
        }
        if system:
            configs[Label("//bazel:stdlib_platform_prebuilt")] = system_flag
    else:
        configs = {
            Label("//bazel:stdlib_libcxx"): config_flag,
            Label("//bazel:stdlib_platform"): system_flag,
        }
    libcxx_prebuilt = Label("//bazel:stdlib_libcxx_prebuilt" if runtimes else "//bazel:stdlib_libcxx")
    config_flag = select(configs, no_match_error = "xclang: --@xclang//bazel:stdlib=platform is for the MSVC " +
                                                   "and macOS targets, not %s, and not with " % target +
                                                   "--@xclang//runtimes:source, which builds libc++")
    if runtimes:
        runtime_compiler_files = ["cfg/%s-runtimes.cfg" % target] + select({
            source_build: [":runtime_include"],
            "//conditions:default": [],
        })
        runtime_linker_files = ["cfg/%s-runtimes.cfg" % target] + select({
            source_build: [":runtime_libraries"],
            "//conditions:default": [],
        }) + select({
            Label("//runtimes:msan_build"): [":runtime_msan_files"],
            "//conditions:default": [],
        })

    # The headers targets share (toolchain/common.ts, shareHeaders): libc++'s,
    # after the target's own __config_site, and the MinGW targets'
    # mingw-w64. Releases before 23.1.2.7 have them in the target's directory.
    shared_dirs = ["libc++/include/%s/c++/v1" % t.cfg, "libc++/include/c++/v1"] + (["mingw-w64/include"] if t.libc == "mingw" else [])
    shared_headers = [d + "/**" for d in shared_dirs]

    # macOS targets link through dsym_link, which makes the dSYM of a link
    # with the generate_dsym_file feature (bazel/dsym).
    dsym_link = [("dsym_link.bat" if windows else "dsym_link.sh")] if t.os == "macos" else []

    sdk_compiler_files = [Label("@%s//:compiler_files" % sdk)] if sdk else []
    sdk_linker_files = [Label("@%s//:linker_files" % sdk)] if sdk else []

    # ASan's DLL beside the programs (bazel/asan_dll.bzl), the runtimes of
    # the toolchain bazel/toolchains registers for --features=asan: none
    # before the release that has it for MinGW.
    dll = []
    if t.asan_dll:
        lib = "%s/lib/%s/%s" % (resource, t.runtime, t.asan_dll)
        dll = native.glob([lib + ".dll"], allow_empty = True)
        if dll:
            xclang_asan_dll(
                name = name + "_asan_dll",
                dll = lib + ".dll",
                interface_library = lib + (".lib" if msvc else ".dll.a"),
            )
    xclang_cc_runtimes(name = name + "_runtimes", runtimes = [":%s_asan_dll" % name] if dll else [])

    # What of //runtimes and the sanitizer features the target cannot build
    # fails the toolchain's analysis, saying why: the runtimes from source
    # on an MSVC target, their options without them, MemorySanitizer
    # without them or on another target than the glibc ones, and a
    # sanitizer the target's runtimes have not.
    xclang_runtimes_check(
        name = name + "_check",
        msan = t.libc == "glibc",
        msvc = msvc,
        sanitizers = [s for s in t.sanitizers if s != "asan" or not t.asan_dll or dll],
        target = target,
    )

    native.filegroup(
        name = name + "_bin",
        srcs = native.glob(["bin/**"]) + dsym_link,
    )
    native.filegroup(
        name = name + "_compiler_files",
        srcs = [name + "_bin", name + "_check", config, scanner] + native.glob([system_config], allow_empty = True) +
               native.glob([resource + "/include/**"]) +
               native.glob([target + "/" + p for p in t.headers] + shared_headers, allow_empty = True) +
               # libc++'s ASan build: none in releases before 23.1.2.5.
               (native.glob([target + "/" + t.asan_libcxx + "/include/**"], allow_empty = True) if t.asan_libcxx else []) +
               sdk_compiler_files + runtime_compiler_files,
    )
    native.filegroup(
        name = name + "_linker_files",
        srcs = [name + "_bin", name + "_check", config] + native.glob([system_config], allow_empty = True) +
               native.glob([resource + "/lib/" + t.runtime + "/**"]) +
               # The MSVC targets' directory: none before libc++ for them.
               native.glob([target + "/" + p for p in t.libraries], allow_empty = msvc) +
               sdk_linker_files + runtime_linker_files,
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

    # The config file in place of bin/<target>.cfg (config_flag).
    flags = ["--no-default-config", "--target=" + target]
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
    elif msvc:
        # lld-link: a hash of the output for the time, the PDB's too.
        link_flags.append("-Wl,/Brepro")
    elif t.os == "windows":
        link_flags.append("-Wl,--no-insert-timestamp")

    # The asan feature builds and links with libc++'s ASan build: its
    # __config_site turns on std::string's container checks, and its
    # libc++.a is instrumented like the code that calls it. For x64 MSVC,
    # the __config_site names that library in every object in place of
    # the normal one, libc++asan-x86_64.lib in compiler-rt's directory,
    # where lld-link finds it: the link needs nothing of its own.
    # With the runtimes from source, theirs are instrumented by the feature;
    # with the platform's C++ library, there is none.
    asan_compile_flags = []
    asan_link_flags = []
    if t.asan_libcxx:
        asan = "%s/%s/%s" % (root, target, t.asan_libcxx)
        asan_compile_flags = ["-isystem", asan + "/include"]
        if not msvc:
            asan_link_flags = ["-nostdlib++", asan + "/libc++.a"]
        builtin_dirs.append("%s/%s/include" % (target, t.asan_libcxx))
    asan_compile_flags = select({libcxx_prebuilt: asan_compile_flags, "//conditions:default": []})
    asan_link_flags = select({libcxx_prebuilt: asan_link_flags, "//conditions:default": []})

    # lld's --gc-sections, on for Linux and off for Windows (bazel/BUILD.bazel).
    gc_sections = [Label("//bazel:gc_sections_msvc" if msvc else "//bazel:gc_sections")]

    # The linker's ThinLTO cache, where XCLANG_THINLTO_CACHE names one, in
    # the spelling of the target's linker (bazel/thinlto_cache.bzl).
    thinlto_cache = [Label("@xclang_thinlto_cache//:" + ("mach_o" if t.os == "macos" else "coff" if msvc else "lld"))]

    # A release's strip by the target's object format (bazel/BUILD.bazel).
    strip = [Label("//bazel:strip_all" if t.os == "macos" else "//bazel:strip_unneeded")]
    opt_link_flags = []
    compile_flags = list(flags)
    if macos_native:
        # The sanitizers' runtimes are shared libraries on macOS, which the
        # programs find by an absolute path into the toolchain. (Only the
        # sanitizer features add it: it makes the link's key the checkout's.)
        # Built elsewhere, they find them beside themselves (@executable_path).
        sanitizer_link_flags = ["-Wl,-rpath,%s/%s/lib/darwin" % (absolute_root, resource)]
    if sdk:
        builtin_dirs.append("%%package(@@%s//)%%" % Label("@%s//:sdk.cfg" % sdk).repo_name)
    elif t.os == "macos":
        # The SDK is Xcode's. Its parent directory too: clang reports
        # SDKSettings.json under the versioned SDK name, not the symlink.
        # The links' too: clang would ask xcrun again, in the actions'
        # environment, without the DEVELOPER_DIR or SDKROOT that chose it.
        builtin_dirs += [xcode_sdk, xcode_sdk.rpartition("/")[0]]
        compile_flags += ["-isysroot", xcode_sdk]
        link_flags += ["-isysroot", xcode_sdk]
    if t.os == "macos":
        opt_link_flags = ["-Wl,-dead_strip"]
        tool_paths["libtool"] = tool("llvm-libtool-darwin")
    if msvc:
        # Objects without the time of their compile (/Brepro), and CodeView
        # without the compiler's path and command line, which on Windows
        # hosts is absolute (the launcher starts llvm.exe by its path); and
        # lld-link's /opt:ref, which it does by default without /debug, only
        # with the gc_sections feature, as for MinGW.
        compile_flags += ["-mno-incremental-linker-compatible", "-gno-codeview-command-line"]
        link_flags.append("-Wl,/opt:noref")

    cc_toolchain_config(
        name = name + "_config",
        abi_libc_version = "local",
        abi_version = "local",
        asan_compile_flags = asan_compile_flags,
        asan_link_flags = asan_link_flags,
        compiler = "clang",
        compile_flags = config_flag + compile_flags,
        coverage_compile_flags = ["-fprofile-instr-generate", "-fcoverage-mapping"],
        coverage_link_flags = ["-fprofile-instr-generate"],
        cpu = t.cpu,
        cxx_builtin_include_directories = builtin_dirs,
        # C++17 by default, as clang has it for the other targets: for the
        # MSVC targets its default is C++14, older than libc++ takes there.
        # --cxxopt and copts come after.
        cxx_flags = ["-std=c++17"] if msvc else [],
        dbg_compile_flags = ["-g"],
        extra_enabled_features = thinlto_cache + strip + (gc_sections if t.os == "linux" else []) +
                                 ([Label("//bazel:no_exported_symbols")] if t.os == "macos" else []) +
                                 ([Label("//bazel:copy_dynamic_libraries_to_binary")] if t.os == "windows" else []) +
                                 [Label("//bazel:modules_embed_all_files")],
        extra_known_features = (gc_sections if t.os == "windows" else []) +
                               ([Label("//bazel/dsym:generate_dsym_file")] if dsym_link else []),
        host_system_name = host,
        link_flags = config_flag + link_flags,
        link_tool = dsym_link[0] if dsym_link else "",
        # --macos_minimum_os, but not below what xclang's libc++ runs on
        # (Bazel's default is the SDK's version on macOS, 11.0 elsewhere).
        macos_minimum_os = MACOS_MIN if t.os == "macos" else "",
        opt_compile_flags = ["-O2", "-DNDEBUG", "-ffunction-sections", "-fdata-sections"],
        opt_link_flags = opt_link_flags,
        runtime_include = select({source_build: ":runtime_include", "//conditions:default": None}) if runtimes else None,
        # libc++'s headers, then the target's own for libc++abi's (from
        # 23.1.2.12), whose __config_site the variant's comes before.
        runtime_include_dirs = [root + "/libc++/include/c++/v1", "%s/libc++/include/%s/c++/v1" % (root, t.cfg)],
        runtime_libraries = select({source_build: [":runtime_libraries"], "//conditions:default": []}) if runtimes else [],
        # macOS unwinds with the system's libunwind.
        runtime_link_flags = ["-nostdlib++"] + ([] if t.os == "macos" else ["--unwindlib=none"]),
        msan_runtime = select({Label("//runtimes:msan_build"): [":runtime_msan_files"], "//conditions:default": []}) if runtimes else [],
        sanitizer_link_flags = sanitizer_link_flags,
        # A library's objects linked as they are, between --start-lib and
        # --end-lib, which lld's ELF and Mach-O drivers take (its MinGW and
        # COFF drivers do not): no archive for a link, and the debug map of
        # a macOS program names each object by its path. In an archive,
        # objects of one name (foo.cppm and foo.cpp, a/foo.cpp and
        # b/foo.cpp) are lib.a(foo.o) alike, which dsymutil tells apart by
        # name and time, all 0 in Bazel's: it reads the first for both, and
        # the dSYM lacks the other's debug information.
        supports_start_end_lib = t.os != "windows",
        # Bazel's name of MSVC's, which the patched config keys on.
        target_libc = "msvcrt" if msvc else t.libc,
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
    """The std and std.compat modules of target's C++ library, as a
    cc_library: a target importing them depends on it and has the
    cpp_modules feature. libc++'s. With the platform's C++ library
    (--@xclang//bazel:stdlib=platform), for an MSVC target Microsoft's STL's,
    from the Windows SDK's repository (bazel/sdk.bzl), as in releases
    without libc++ for them (before 23.1.2.10); for a macOS target none, as
    the SDK has no module sources.

    Args:
        name: the cc_library.
        target: the target triple.
        root: the package's path from the execution root.
    """
    share = "%s/%s/share/libc++/v1" % (target, "usr" if TARGETS[target].os == "linux" else "")
    share = share.replace("//", "/")
    libcxx = native.glob([share + "/std.cppm"], allow_empty = True)
    if TARGETS[target].libc == "msvc":
        stl = Label("@xclang_windows_sdk_%s//:std" % TARGETS[target].arch)
        native.alias(
            name = name,
            actual = select({
                Label("//bazel:stdlib_platform"): stl,
                "//conditions:default": ":%s_libcxx" % name if libcxx else stl,
            }),
            visibility = ["//visibility:public"],
        )
        if not libcxx:
            return
        name += "_libcxx"
    elif TARGETS[target].os == "macos":
        native.alias(
            name = name,
            actual = select({
                Label("//bazel:stdlib_platform"): Label("//bazel:none"),
                "//conditions:default": ":%s_libcxx" % name,
            }),
            visibility = ["//visibility:public"],
        )
        name += "_libcxx"
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
