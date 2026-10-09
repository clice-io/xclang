# libc++ of an MSVC target, built with clang-cl against the fetched SDK:
# static only, on Microsoft's C++ ABI library (vcruntime: exceptions, RTTI,
# operator new) and UCRT, as libc++'s own clang-cl-static configuration.
# There is no libc++abi or libunwind: vcruntime and the OS unwind.
#
# One build serves every C runtime a program picks (/MT, /MD, their debug
# variants, the hybrid CRT): toolchain/runtimes.ts compiles it /MT with /Zl,
# so it names no C runtime, and calls UCRT and vcruntime functions directly,
# which both their static libraries and their import libraries define.
set(CMAKE_BUILD_TYPE Release CACHE STRING "")
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded CACHE STRING "")
set(LLVM_ENABLE_RUNTIMES libcxx CACHE STRING "")
set(LLVM_INCLUDE_TESTS OFF CACHE BOOL "")
set(LLVM_ENABLE_PER_TARGET_RUNTIME_DIR OFF CACHE BOOL "")

set(LIBCXX_ENABLE_SHARED OFF CACHE BOOL "")
set(LIBCXX_ENABLE_STATIC ON CACHE BOOL "")
set(LIBCXX_CXX_ABI vcruntime CACHE STRING "")
set(LIBCXX_HARDENING_MODE none CACHE STRING "")
set(LIBCXX_INSTALL_MODULES ON CACHE BOOL "")
set(LIBCXX_INCLUDE_TESTS OFF CACHE BOOL "")
set(LIBCXX_INCLUDE_BENCHMARKS OFF CACHE BOOL "")
# On the library's compiles only, not on CMake's checks, which link
# programs and need the C runtime named:
#   /Zl             no C runtime named in its objects;
#   _CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS
#                   instead of libc++'s _CRT_STDIO_ISO_WIDE_SPECIFIERS (UCRT's
#                   own advice for static libraries): with the latter, every
#                   object of the library carries a /failifmismatch that the
#                   objects of a program compiled without it, as programs
#                   are by default, contradict, and the link fails. libc++
#                   formats no wide string with %s or %c, the only
#                   specifiers it affects.
set(LIBCXX_ADDITIONAL_COMPILE_FLAGS
    /Zl -U_CRT_STDIO_ISO_WIDE_SPECIFIERS -D_CRT_STDIO_ARBITRARY_WIDE_SPECIFIERS
    CACHE STRING "")
