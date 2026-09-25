# On top of clang.cmake: the libclang for debugging tools built on clang,
# with AddressSanitizer and assertions, and no profile or ThinLTO. Only
# the Development distribution is installed from it.
set(CMAKE_BUILD_TYPE Debug CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS_DEBUG "-O1 -gline-tables-only" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O1 -gline-tables-only" CACHE STRING "" FORCE)
set(LLVM_USE_SANITIZER Address CACHE STRING "")
set(LLVM_ENABLE_ASSERTIONS ON CACHE BOOL "" FORCE)
set(LLVM_ENABLE_LTO OFF CACHE STRING "" FORCE)
set(LLVM_ENABLE_PROJECTS "clang;clang-tools-extra" CACHE STRING "" FORCE)
set(LLVM_TARGETS_TO_BUILD "X86;AArch64;ARM;RISCV" CACHE STRING "" FORCE)
set(LLVM_DISTRIBUTIONS "Development" CACHE STRING "" FORCE)
