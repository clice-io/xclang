# On top of clang.cmake: the clang and lld that record the training
# profile. Frontend instrumentation (clang's AST-based counters), whose
# function hashes depend on the source only, so the Linux x64 profile
# applies to every host. Only the training's backends are built, and no
# ThinLTO: the counters, not the code, are what matters here.
set(LLVM_BUILD_INSTRUMENTED Frontend CACHE STRING "")
set(LLVM_ENABLE_PROJECTS "clang;lld" CACHE STRING "" FORCE)
set(LLVM_TARGETS_TO_BUILD "X86;AArch64;ARM" CACHE STRING "" FORCE)
set(LLVM_ENABLE_LTO OFF CACHE STRING "" FORCE)
set(LLVM_DISTRIBUTIONS "Toolchain" CACHE STRING "" FORCE)
set(LLVM_Toolchain_DISTRIBUTION_COMPONENTS
    clang clang-resource-headers lld
    CACHE STRING "" FORCE)
