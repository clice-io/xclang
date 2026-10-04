# Cross-compile for Windows (MSVC ABI) from another host with clang-cl, an
# xclang tree and the CRT + Windows SDK unpacked by vendor-sdk.py (/winsysroot):
#   -DCMAKE_TOOLCHAIN_FILE=sdk/msvc.cmake -DXCLANG_ROOT=<xclang>
#   -DWINSYSROOT=<dir> -DWINDOWS_ARCH=x86_64|aarch64
foreach(var XCLANG_ROOT WINSYSROOT WINDOWS_ARCH)
    if(NOT ${var})
        message(FATAL_ERROR "sdk/msvc.cmake needs ${var}")
    endif()
endforeach()
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES XCLANG_ROOT WINSYSROOT WINDOWS_ARCH)

set(CMAKE_SYSTEM_NAME Windows)
if(WINDOWS_ARCH STREQUAL "aarch64")
    set(CMAKE_SYSTEM_PROCESSOR ARM64)
else()
    set(CMAKE_SYSTEM_PROCESSOR AMD64)
endif()

if(CMAKE_HOST_WIN32)
    set(_exe ".exe")
endif()
set(_bin "${XCLANG_ROOT}/bin")
set(CMAKE_C_COMPILER "${_bin}/clang-cl${_exe}")
set(CMAKE_CXX_COMPILER "${_bin}/clang-cl${_exe}")
foreach(lang C CXX)
    set(CMAKE_${lang}_COMPILER_TARGET ${WINDOWS_ARCH}-pc-windows-msvc)
    set(CMAKE_${lang}_FLAGS_INIT "/winsysroot \"${WINSYSROOT}\"")
endforeach()
set(CMAKE_LINKER "${_bin}/lld-link${_exe}")
set(CMAKE_AR "${_bin}/llvm-lib${_exe}")
set(CMAKE_RC_COMPILER "${_bin}/llvm-rc${_exe}")
# CMake links with lld-link itself, which finds the libraries through
# /winsysroot too. Without an mt tool (xclang has no llvm-mt), no manifest.
foreach(kind EXE SHARED MODULE)
    set(CMAKE_${kind}_LINKER_FLAGS_INIT "/winsysroot:\"${WINSYSROOT}\" /MANIFEST:NO")
endforeach()

set(CMAKE_FIND_ROOT_PATH ${WINSYSROOT})
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
