"""The xclang module extension: every repository of the release the module
stands for (bazel/versions.bzl). They are fetched only when used: a build
downloads its host's toolchain, and libclang if it links it.

    xclang = use_extension("@xclang//bazel:extensions.bzl", "xclang")
    use_repo(xclang, "libclang", "llvm_option_inc")

  libclang         the host's libclang: @libclang//:clangBasic, :LLVMSupport,
                   ..., each with its link interface; :headers, :resource_dir
  libclang_asan    the ASan build of it (Linux x64 and macOS arm64 only)
  llvm_option_inc  the option tables: @llvm_option_inc

The toolchain and libclang are of one release, as libclang's ThinLTO bitcode
needs the lld of the same LLVM. Environment variables (--repo_env) point at
directories unpacked by hand instead: XCLANG_ROOT for the toolchain,
XCLANG_LIBCLANG_ROOT and XCLANG_LIBCLANG_ASAN_ROOT.
"""

load(":hosts.bzl", "HOSTS")
load(":repositories.bzl", "xclang_libclang", "xclang_macos_sdk", "xclang_option_inc", "xclang_toolchain", "xclang_unix_config")
load(":versions.bzl", "SHA256", "VERSION")

def _xclang_impl(mctx):
    xclang_unix_config(name = "xclang_unix_config")
    xclang_macos_sdk(name = "xclang_macos_sdk")
    for host in HOSTS:
        xclang_toolchain(name = "xclang_" + host, host = host, version = VERSION, sha256 = SHA256)
    xclang_libclang(name = "libclang", version = VERSION, sha256 = SHA256)
    xclang_libclang(name = "libclang_asan", asan = True, version = VERSION, sha256 = SHA256)
    xclang_option_inc(name = "llvm_option_inc", version = VERSION, sha256 = SHA256)
    return mctx.extension_metadata(reproducible = True)

xclang = module_extension(implementation = _xclang_impl)
