# compiler-rt beyond the builtins: the profile runtime (-fprofile-*
# instrumentation, and xclang's own training), and where scripts/runtimes.ts
# turns them on (Linux, macOS), AddressSanitizer, ThreadSanitizer,
# UndefinedBehaviorSanitizer and libFuzzer on top of libc++.
set(CMAKE_BUILD_TYPE Release CACHE STRING "")
set(LLVM_ENABLE_RUNTIMES compiler-rt CACHE STRING "")
set(LLVM_INCLUDE_TESTS OFF CACHE BOOL "")
set(LLVM_ENABLE_PER_TARGET_RUNTIME_DIR ON CACHE BOOL "")
set(COMPILER_RT_DEFAULT_TARGET_ONLY ON CACHE BOOL "")
set(COMPILER_RT_INCLUDE_TESTS OFF CACHE BOOL "")
set(COMPILER_RT_BUILD_BUILTINS OFF CACHE BOOL "")
set(COMPILER_RT_BUILD_CRT OFF CACHE BOOL "")
set(COMPILER_RT_BUILD_PROFILE ON CACHE BOOL "")
foreach(part SANITIZERS XRAY LIBFUZZER MEMPROF ORC CTX_PROFILE GWP_ASAN)
    set(COMPILER_RT_BUILD_${part} OFF CACHE BOOL "")
endforeach()
# UBSan's runtime comes with any sanitizer; naming it again breaks the build.
set(COMPILER_RT_SANITIZERS_TO_BUILD "asan;tsan" CACHE STRING "")
# libFuzzer against the libc++ of the sysroot, the one every program links,
# rather than a private copy built from source.
set(COMPILER_RT_USE_LIBCXX OFF CACHE BOOL "")
