# xclang as a build's toolchain, for the host or another target of the
# tree:
#
#   cmake -G Ninja --toolchain <xclang>/lib/cmake/xclang/toolchain.cmake
#         [-DXCLANG_TARGET=<triple>]
#
# The compilers and binary tools are the tree's; clang's config file of
# the target (bin/<triple>.cfg) picks sysroot, libc++, compiler-rt and
# linker, so nothing here repeats them. For another target, CMake also
# learns what it builds for, and finds libraries, headers and packages in
# that target's directory only. find_package(xclang) finds the package
# next to this file.
#
#   XCLANG_ROOT     the tree, when this file is not in one (xclang.cmake's
#                   download, tests/cmake)
#   XCLANG_TARGET   x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu,
#                   x86_64-unknown-linux-musl, aarch64-unknown-linux-musl,
#                   x86_64-w64-mingw32, aarch64-w64-mingw32,
#                   aarch64-apple-darwin, x86_64-apple-darwin,
#                   x86_64-pc-windows-msvc or aarch64-pc-windows-msvc; the
#                   host's by default. musl targets build static programs:
#                   on a Linux host of their architecture, which runs them,
#                   the build is no cross build (try_run, tests).
#                   macOS targets build with Xcode's SDK on macOS, and
#                   elsewhere with the one the toolchain's xclang fetched
#                   (xclang sdk fetch macos), or the
#                   CMAKE_OSX_SYSROOT given. MSVC targets build with the
#                   Windows SDK the toolchain's xclang fetched (xclang sdk
#                   fetch windows), with clang and clang++ (not clang-cl),
#                   the hybrid CRT (CMAKE_MSVC_RUNTIME_LIBRARY is
#                   MultiThreaded unless set) and libc++. A build directory
#                   keeps the target of its first configure.
#   XCLANG_STDLIB   libc++ (the default): the toolchain's libc++, and its
#                   sysroot; platform: the platform's C++ library, for C++
#                   interfaces to libraries built with it: -stdlib=platform
#                   on every compile and link, which selects the
#                   target's bin/<triple>-system.cfg (patches/0018). That is
#                   GCC's libstdc++ of this Linux, of a distribution's cross
#                   packages or of the CMAKE_SYSROOT given (which the musl and
#                   MinGW targets need), the SDK's libc++ for macOS and
#                   Microsoft's STL for MSVC; xclang::std is the STL's, and
#                   for the others the platform library's, where it has one.
#   XCLANG_RUNTIMES source: libc++, libc++abi and libunwind built from the
#                   toolchain's sources, with libc++'s hardening and ABI
#                   options, without exceptions, and so on; prebuilt by
#                   default (runtimes.cmake, which names the options)
#   XCLANG_SANITIZER
#                   the sanitizers of the whole build, address, memory,
#                   thread, undefined or leak, with C++ runtimes that suit
#                   them (runtimes.cmake)

# The policies this file is written for, not those of the project, which
# may set old ones or none (if() without IN_LIST): up to its end, with
# runtimes.cmake.
if(CMAKE_VERSION VERSION_LESS 3.28)
    message(FATAL_ERROR "xclang needs CMake 3.28 or later")
endif()
cmake_policy(PUSH)
cmake_policy(VERSION 3.28...4.3)

if(NOT XCLANG_ROOT)
    get_filename_component(XCLANG_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
endif()
# Absolute (a relative one is the build directory's) and without ../, once:
# try_compile projects get it as it is here, and the runtimes from source
# are named after it.
file(TO_CMAKE_PATH "${XCLANG_ROOT}" XCLANG_ROOT)
get_filename_component(XCLANG_ROOT "${XCLANG_ROOT}" ABSOLUTE BASE_DIR "${CMAKE_BINARY_DIR}")
if(NOT EXISTS "${XCLANG_ROOT}/bin/x86_64-unknown-linux-gnu.cfg")
    message(FATAL_ERROR "xclang: no toolchain at ${XCLANG_ROOT}; set XCLANG_ROOT to an unpacked xclang")
endif()
# try_compile projects read this file again, without the cache.
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES XCLANG_ROOT XCLANG_TARGET XCLANG_STDLIB)

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64|ARM64)$")
    set(_xclang_host_arch aarch64)
else()
    set(_xclang_host_arch x86_64)
endif()
if(CMAKE_HOST_APPLE)
    set(_xclang_host_os darwin)
elseif(CMAKE_HOST_WIN32)
    set(_xclang_host_os mingw)
else()
    set(_xclang_host_os linux)
endif()

if(NOT XCLANG_TARGET)
    set(XCLANG_TARGET "")
endif()
set(_xclang_target_os "${_xclang_host_os}")
set(_xclang_target_arch "${_xclang_host_arch}")
if(XCLANG_TARGET)
    if(NOT XCLANG_TARGET MATCHES "^(x86_64|aarch64)-(unknown-linux-gnu|unknown-linux-musl|w64-mingw32|apple-darwin|pc-windows-msvc)$")
        message(FATAL_ERROR "xclang: XCLANG_TARGET ${XCLANG_TARGET} is none of x86_64-unknown-linux-gnu, "
            "aarch64-unknown-linux-gnu, x86_64-unknown-linux-musl, aarch64-unknown-linux-musl, x86_64-w64-mingw32, "
            "aarch64-w64-mingw32, aarch64-apple-darwin, x86_64-apple-darwin, x86_64-pc-windows-msvc, "
            "aarch64-pc-windows-msvc")
    endif()
    set(_xclang_target_arch "${CMAKE_MATCH_1}")
    if(CMAKE_MATCH_2 STREQUAL "unknown-linux-musl")
        set(_xclang_target_os musl)
        if(NOT IS_DIRECTORY "${XCLANG_ROOT}/${XCLANG_TARGET}")
            message(FATAL_ERROR "xclang: the toolchain at ${XCLANG_ROOT} has no ${XCLANG_TARGET}: "
                "the musl targets are in 23.1.2.10 and later")
        endif()
    elseif(CMAKE_MATCH_2 STREQUAL "w64-mingw32")
        set(_xclang_target_os mingw)
    elseif(CMAKE_MATCH_2 STREQUAL "pc-windows-msvc")
        set(_xclang_target_os msvc)
    elseif(CMAKE_MATCH_2 STREQUAL "apple-darwin")
        set(_xclang_target_os darwin)
    else()
        set(_xclang_target_os linux)
    endif()
endif()

# The target's triple, as its directory in the tree is named.
if(XCLANG_TARGET)
    set(_xclang_triple "${XCLANG_TARGET}")
elseif(_xclang_host_os STREQUAL "darwin")
    set(_xclang_triple "${_xclang_host_arch}-apple-darwin")
elseif(_xclang_host_os STREQUAL "mingw")
    set(_xclang_triple "${_xclang_host_arch}-w64-mingw32")
else()
    set(_xclang_triple "${_xclang_host_arch}-unknown-linux-gnu")
endif()
# CMake keeps what it learns of the target at the first configure of a
# build directory (CMakeSystem.cmake, the CMAKE_OSX_ARCHITECTURES cache
# entry): another target later would be half applied. The end of this file
# records the target; try_compile projects, whose caches are their own,
# record theirs.
if(DEFINED CACHE{_XCLANG_TARGET} AND NOT "$CACHE{_XCLANG_TARGET}" STREQUAL _xclang_triple)
    message(FATAL_ERROR "xclang: this build directory is configured for $CACHE{_XCLANG_TARGET}, which CMake keeps: "
        "for ${_xclang_triple}, configure a new build directory, or this one again with cmake --fresh")
endif()

# Options of the directory, and of try_compile projects, which read this file
# again: added once each.
function(_xclang_add kind)
    get_directory_property(present ${kind}_OPTIONS)
    foreach(option IN LISTS ARGN)
        if(NOT option IN_LIST present)
            if(kind STREQUAL "COMPILE")
                add_compile_options("${option}")
            else()
                add_link_options("${option}")
            endif()
        endif()
    endforeach()
endfunction()

if(NOT XCLANG_STDLIB)
    set(XCLANG_STDLIB libc++)
endif()
if(NOT XCLANG_STDLIB MATCHES "^(libc\\+\\+|platform)$")
    message(FATAL_ERROR "xclang: XCLANG_STDLIB is ${XCLANG_STDLIB}, not libc++ or platform")
endif()
if(XCLANG_STDLIB STREQUAL "platform")
    # The platform's C++ library: -stdlib=platform on every compile and
    # link but resources', C's too, as it selects the sysroot of Linux,
    # musl and MinGW targets as well (patches/0018). Options, not flags:
    # those only initialize the cache, at the first configure, and not
    # when CMAKE_<LANG>_FLAGS is given.
    set(_xclang_languages C,CXX,ASM,OBJC,OBJCXX)
    _xclang_add(COMPILE "$<$<COMPILE_LANGUAGE:${_xclang_languages}>:-stdlib=platform>")
    _xclang_add(LINK "$<$<LINK_LANGUAGE:${_xclang_languages}>:-stdlib=platform>")
    if(_xclang_target_os MATCHES "^(musl|mingw)$" AND NOT CMAKE_SYSROOT)
        message(FATAL_ERROR "xclang: XCLANG_STDLIB=platform takes the C++ library of a ${_xclang_target_os} target "
            "from a sysroot that has one (an Alpine root, MSYS2's ucrt64), which the toolchain has not: set CMAKE_SYSROOT")
    endif()
endif()

set(_xclang_bin "${XCLANG_ROOT}/bin")
if(CMAKE_HOST_WIN32)
    set(_xclang_exe ".exe")
else()
    set(_xclang_exe "")
endif()
set(CMAKE_C_COMPILER "${_xclang_bin}/clang${_xclang_exe}")
set(CMAKE_CXX_COMPILER "${_xclang_bin}/clang++${_xclang_exe}")
set(CMAKE_ASM_COMPILER "${_xclang_bin}/clang${_xclang_exe}")
foreach(_xclang_tool AR RANLIB NM OBJCOPY OBJDUMP READELF STRIP ADDR2LINE DLLTOOL)
    string(TOLOWER "${_xclang_tool}" _xclang_name)
    set(CMAKE_${_xclang_tool} "${_xclang_bin}/llvm-${_xclang_name}${_xclang_exe}")
endforeach()
if(_xclang_target_os STREQUAL "darwin")
    # Objective-C too, by the same drivers.
    set(CMAKE_OBJC_COMPILER "${_xclang_bin}/clang${_xclang_exe}")
    set(CMAKE_OBJCXX_COMPILER "${_xclang_bin}/clang++${_xclang_exe}")
    # Apple's libtool cannot read the bitcode of a newer LLVM.
    set(CMAKE_LIBTOOL "${_xclang_bin}/llvm-libtool-darwin${_xclang_exe}")
    set(CMAKE_LIPO "${_xclang_bin}/llvm-lipo${_xclang_exe}")
    set(CMAKE_INSTALL_NAME_TOOL "${_xclang_bin}/llvm-install-name-tool${_xclang_exe}")
elseif(_xclang_target_os STREQUAL "mingw")
    set(CMAKE_RC_COMPILER "${_xclang_bin}/llvm-windres${_xclang_exe}")
elseif(_xclang_target_os STREQUAL "msvc")
    # Resources compiled to .res files, which lld-link merges with the
    # manifest's (a windres object would be a second resource object);
    # CMake preprocesses them with the C compiler, for the target.
    set(CMAKE_RC_COMPILER "${_xclang_bin}/llvm-rc${_xclang_exe}")
endif()

if(_xclang_target_os STREQUAL "msvc")
    # Microsoft's CRT (and STL) and Windows SDK, where the config files of
    # the MSVC targets read them: fetched into the tree. On Windows, without
    # one, clang finds Visual Studio.
    if(NOT CMAKE_HOST_WIN32 AND NOT EXISTS "${XCLANG_ROOT}/sdk/windows/${XCLANG_TARGET}.cfg")
        message(FATAL_ERROR "xclang: ${XCLANG_TARGET} needs the Windows SDK in ${XCLANG_ROOT}/sdk/windows, "
            "for ${_xclang_target_arch}: ${_xclang_bin}/xclang sdk fetch windows --accept-license")
    endif()
    # The hybrid CRT by default, the config files' (-MT with UCRT's DLL),
    # also for Debug: CMake's default, MultiThreaded$<$<CONFIG:Debug>:Debug>DLL,
    # would load the VC runtime's DLLs, and in Debug UCRT's debug DLL, which
    # no Windows has.
    if(NOT DEFINED CMAKE_MSVC_RUNTIME_LIBRARY)
        set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)
    endif()
    # With a debug CRT (MultiThreadedDebug, MultiThreadedDebugDLL), links
    # take no ucrt.lib, which the config files' hybrid CRT names in every
    # object: only an option of the link itself comes before the objects'.
    set(_xclang_crt "$<GENEX_EVAL:$<TARGET_PROPERTY:MSVC_RUNTIME_LIBRARY>>")
    _xclang_add(LINK "$<$<OR:$<STREQUAL:${_xclang_crt},MultiThreadedDebug>,$<STREQUAL:${_xclang_crt},MultiThreadedDebugDLL>>:-Wl,/nodefaultlib:ucrt.lib>")
endif()

if(_xclang_target_os STREQUAL "darwin")
    if(_xclang_target_arch STREQUAL "aarch64")
        set(_xclang_osx_arch arm64)
    else()
        set(_xclang_osx_arch x86_64)
    endif()
    if(CMAKE_HOST_APPLE)
        # Another architecture of macOS is not cross-compiling to CMake:
        # Rosetta runs x86_64 programs, and clang picks the config file of
        # -arch. The SDK is Xcode's, as CMake finds it.
        if(XCLANG_TARGET)
            set(CMAKE_OSX_ARCHITECTURES ${_xclang_osx_arch} CACHE STRING "")
        endif()
    else()
        # Apple's SDK, as CMake picks it on macOS, with the tree's in place
        # of xcrun's: CMAKE_OSX_SYSROOT, else SDKROOT, else the one the
        # config files of the macOS targets read, fetched into the tree.
        # CMake passes it as -isysroot, after theirs.
        if(NOT CMAKE_OSX_SYSROOT AND IS_DIRECTORY "$ENV{SDKROOT}")
            file(TO_CMAKE_PATH "$ENV{SDKROOT}" CMAKE_OSX_SYSROOT)
        elseif(NOT CMAKE_OSX_SYSROOT)
            if(NOT EXISTS "${XCLANG_ROOT}/sdk/macos/SDKSettings.json")
                message(FATAL_ERROR "xclang: ${XCLANG_TARGET} needs Apple's macOS SDK in ${XCLANG_ROOT}/sdk/macos: "
                    "${_xclang_bin}/xclang sdk fetch macos --accept-license")
            endif()
            set(CMAKE_OSX_SYSROOT "${XCLANG_ROOT}/sdk/macos")
        endif()
        set(CMAKE_SYSTEM_NAME Darwin)
        set(CMAKE_SYSTEM_PROCESSOR ${_xclang_osx_arch})
        set(CMAKE_OSX_ARCHITECTURES ${_xclang_osx_arch} CACHE STRING "")
        foreach(_xclang_lang C CXX ASM OBJC OBJCXX)
            set(CMAKE_${_xclang_lang}_COMPILER_TARGET "${XCLANG_TARGET}")
        endforeach()
        # What the build links is looked for in the SDK (and the roots
        # given), not on this machine.
        if(NOT CMAKE_OSX_SYSROOT IN_LIST CMAKE_FIND_ROOT_PATH)
            list(APPEND CMAKE_FIND_ROOT_PATH "${CMAKE_OSX_SYSROOT}")
        endif()
        set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
        set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
        set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
        set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
    endif()
elseif(_xclang_target_os STREQUAL "msvc" AND CMAKE_HOST_WIN32 AND _xclang_target_arch STREQUAL _xclang_host_arch)
    # Windows on Windows is no cross build, whatever its C library.
    foreach(_xclang_lang C CXX ASM)
        set(CMAKE_${_xclang_lang}_COMPILER_TARGET "${XCLANG_TARGET}")
    endforeach()
elseif(_xclang_target_os STREQUAL "musl" AND _xclang_host_os STREQUAL "linux" AND _xclang_target_arch STREQUAL _xclang_host_arch)
    # Nor is musl on Linux of its architecture, where its static programs
    # run; but what the build links is looked for in its sysroot only.
    foreach(_xclang_lang C CXX ASM)
        set(CMAKE_${_xclang_lang}_COMPILER_TARGET "${XCLANG_TARGET}")
    endforeach()
    if(XCLANG_STDLIB STREQUAL "libc++")
        set(CMAKE_SYSROOT "${XCLANG_ROOT}/${XCLANG_TARGET}")
    endif()
    set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
    set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
elseif(NOT _xclang_target_os STREQUAL _xclang_host_os OR NOT _xclang_target_arch STREQUAL _xclang_host_arch)
    if(_xclang_target_os MATCHES "^(mingw|msvc)$")
        set(CMAKE_SYSTEM_NAME Windows)
        if(_xclang_target_arch STREQUAL "aarch64")
            set(CMAKE_SYSTEM_PROCESSOR ARM64)
        else()
            set(CMAKE_SYSTEM_PROCESSOR AMD64)
        endif()
    else()
        set(CMAKE_SYSTEM_NAME Linux)
        set(CMAKE_SYSTEM_PROCESSOR "${_xclang_target_arch}")
    endif()
    foreach(_xclang_lang C CXX ASM)
        set(CMAKE_${_xclang_lang}_COMPILER_TARGET "${XCLANG_TARGET}")
    endforeach()
    if(_xclang_target_os STREQUAL "mingw")
        set(CMAKE_RC_FLAGS_INIT "--target=${XCLANG_TARGET}")
    endif()
    # The sysroot the config file names (for MSVC targets, the SDK, beside
    # the roots given): what the build links is looked for there, not on
    # this machine. With the platform's C++ library, a Linux or MinGW
    # target's is the CMAKE_SYSROOT given, or none.
    if(_xclang_target_os STREQUAL "msvc")
        if(EXISTS "${XCLANG_ROOT}/sdk/windows" AND NOT "${XCLANG_ROOT}/sdk/windows" IN_LIST CMAKE_FIND_ROOT_PATH)
            list(APPEND CMAKE_FIND_ROOT_PATH "${XCLANG_ROOT}/sdk/windows")
        endif()
    elseif(XCLANG_STDLIB STREQUAL "libc++")
        set(CMAKE_SYSROOT "${XCLANG_ROOT}/${XCLANG_TARGET}")
    endif()
    set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
    set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
endif()

include("${CMAKE_CURRENT_LIST_DIR}/runtimes.cmake")

# find_package(xclang): this file's package, also where packages are looked
# for in the sysroot only.
set(xclang_DIR "${CMAKE_CURRENT_LIST_DIR}")

# The target of the build directory, once this file has gone through
# (CMakeSystem.cmake is written after it).
set(_XCLANG_TARGET "${_xclang_triple}" CACHE INTERNAL "")
cmake_policy(POP)
