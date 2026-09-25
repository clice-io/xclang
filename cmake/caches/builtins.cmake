# compiler-rt/lib/builtins: the builtins and, on ELF targets, the
# crtbegin/crtend objects. Built before any C library can be linked, so
# CMake only compiles its checks.
set(CMAKE_BUILD_TYPE Release CACHE STRING "")
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY CACHE STRING "")
set(COMPILER_RT_DEFAULT_TARGET_ONLY ON CACHE BOOL "")
set(COMPILER_RT_BUILD_BUILTINS ON CACHE BOOL "")
set(COMPILER_RT_INCLUDE_TESTS OFF CACHE BOOL "")
set(LLVM_ENABLE_PER_TARGET_RUNTIME_DIR ON CACHE BOOL "")
