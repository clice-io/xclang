# Build for XCLANG_TARGET with the toolchain tree at XCLANG_ROOT (the
# bootstrap one, or an xclang built here). The config file bin/<triple>.cfg
# of that tree supplies the sysroot, the runtimes and the linker; this file
# only names the programs and tells CMake what it is building for.
#
#   -DXCLANG_ROOT=<tree> -DXCLANG_TARGET=<triple>
#   -DXCLANG_TARGET_OS=linux|mingw|darwin -DXCLANG_TARGET_ARCH=x86_64|aarch64
#   -DXCLANG_MACOS_MIN=<version>
#   -DXCLANG_COMPILER_TARGET=<spelling of the triple for --target>, when it
#     should differ from the directory name (compiler-rt names its output
#     directory after it)

foreach(var XCLANG_ROOT XCLANG_TARGET XCLANG_TARGET_OS XCLANG_TARGET_ARCH)
    if(NOT ${var})
        message(FATAL_ERROR "cmake/toolchain.cmake needs ${var}")
    endif()
endforeach()
# try_compile projects see the toolchain file again, not the cache.
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES
    XCLANG_ROOT XCLANG_TARGET XCLANG_TARGET_OS XCLANG_TARGET_ARCH XCLANG_MACOS_MIN
    XCLANG_COMPILER_TARGET)

set(_bin "${XCLANG_ROOT}/bin")
if(CMAKE_HOST_WIN32)
    set(_exe ".exe")
endif()

set(CMAKE_C_COMPILER "${_bin}/clang${_exe}")
set(CMAKE_CXX_COMPILER "${_bin}/clang++${_exe}")
set(CMAKE_ASM_COMPILER "${_bin}/clang${_exe}")
if(NOT XCLANG_COMPILER_TARGET)
    set(XCLANG_COMPILER_TARGET "${XCLANG_TARGET}")
endif()
foreach(lang C CXX ASM)
    set(CMAKE_${lang}_COMPILER_TARGET "${XCLANG_COMPILER_TARGET}")
endforeach()

set(CMAKE_AR "${_bin}/llvm-ar${_exe}")
set(CMAKE_RANLIB "${_bin}/llvm-ranlib${_exe}")
set(CMAKE_NM "${_bin}/llvm-nm${_exe}")
set(CMAKE_OBJCOPY "${_bin}/llvm-objcopy${_exe}")
set(CMAKE_OBJDUMP "${_bin}/llvm-objdump${_exe}")
set(CMAKE_READELF "${_bin}/llvm-readelf${_exe}")
set(CMAKE_STRIP "${_bin}/llvm-strip${_exe}")
set(CMAKE_ADDR2LINE "${_bin}/llvm-addr2line${_exe}")
set(CMAKE_DLLTOOL "${_bin}/llvm-dlltool${_exe}")
# lld, except for macOS: the system's ld there, with the tree's libLTO.dylib
# (config/darwin.cfg).
if(NOT XCLANG_TARGET_OS STREQUAL "darwin")
    set(CMAKE_LINKER_TYPE LLD)
endif()

# Cross-compiling means another OS or another architecture than this machine.
if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64|ARM64)$")
    set(_host_arch aarch64)
else()
    set(_host_arch x86_64)
endif()
if(CMAKE_HOST_APPLE)
    set(_host_os darwin)
elseif(CMAKE_HOST_WIN32)
    set(_host_os mingw)
else()
    set(_host_os linux)
endif()

if(XCLANG_TARGET_OS STREQUAL "darwin")
    # Apple builds switch architectures with CMAKE_OSX_ARCHITECTURES, not
    # with a cross-compiling system name; Rosetta runs x86_64 build tools.
    if(XCLANG_TARGET_ARCH STREQUAL "aarch64")
        set(CMAKE_OSX_ARCHITECTURES arm64 CACHE STRING "")
    else()
        set(CMAKE_OSX_ARCHITECTURES x86_64 CACHE STRING "")
    endif()
    set(CMAKE_OSX_DEPLOYMENT_TARGET "${XCLANG_MACOS_MIN}" CACHE STRING "")
    # Apple's libtool cannot read the bitcode of a newer LLVM.
    set(CMAKE_LIBTOOL "${_bin}/llvm-libtool-darwin${_exe}")
    set(CMAKE_LIPO "${_bin}/llvm-lipo${_exe}")
    set(CMAKE_INSTALL_NAME_TOOL "${_bin}/llvm-install-name-tool${_exe}")
elseif(NOT XCLANG_TARGET_OS STREQUAL _host_os OR NOT XCLANG_TARGET_ARCH STREQUAL _host_arch)
    if(XCLANG_TARGET_OS STREQUAL "mingw")
        set(CMAKE_SYSTEM_NAME Windows)
        if(XCLANG_TARGET_ARCH STREQUAL "aarch64")
            set(CMAKE_SYSTEM_PROCESSOR ARM64)
        else()
            set(CMAKE_SYSTEM_PROCESSOR AMD64)
        endif()
    else()
        set(CMAKE_SYSTEM_NAME Linux)
        set(CMAKE_SYSTEM_PROCESSOR "${XCLANG_TARGET_ARCH}")
    endif()
endif()

if(XCLANG_TARGET_OS STREQUAL "mingw")
    set(CMAKE_RC_COMPILER "${_bin}/llvm-windres${_exe}")
    set(CMAKE_RC_FLAGS "--target=${XCLANG_TARGET}")
endif()

if(NOT XCLANG_TARGET_OS STREQUAL "darwin")
    # The sysroot the config file names. Libraries, headers and packages
    # are looked for in it only, even natively: the pixi environment on
    # this machine is not part of what is being built.
    set(CMAKE_SYSROOT "${XCLANG_ROOT}/${XCLANG_TARGET}")
    set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
    set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
endif()
