# Before project(): xclang as the build's toolchain, the host's archive of
# the release this file comes with (xclang-cmake-<version>.tar.gz),
# downloaded once and checked against the release's SHA256SUMS next to
# this file.
#
#   include(FetchContent)
#   FetchContent_Declare(xclang
#       URL https://github.com/clice-io/xclang/releases/download/<version>/xclang-cmake-<version>.tar.gz
#       URL_HASH SHA256=<its line in the release's SHA256SUMS>)
#   FetchContent_MakeAvailable(xclang)
#   include(${xclang_SOURCE_DIR}/xclang.cmake)
#   project(...)
#
#   XCLANG_TARGET     another target to build for (toolchain.cmake)
#   XCLANG_ROOT       an unpacked xclang to use instead of downloading
#   XCLANG_CACHE_DIR  where archives are unpacked, a directory per release
#                     and host; <build>/_deps by default, a directory of
#                     its own shares them between build trees
#   XCLANG_URL        where the archives are downloaded from: the release by
#                     default; a mirror serves the same bytes, as their
#                     digests are checked

include_guard(GLOBAL)
if(CMAKE_VERSION VERSION_LESS 3.28)
    message(FATAL_ERROR "xclang needs CMake 3.28 or later, for C++20 modules")
endif()
cmake_policy(VERSION 3.28...4.3)

function(_xclang_toolchain)
    # A project built inside another one has the other one's toolchain.
    get_property(languages GLOBAL PROPERTY ENABLED_LANGUAGES)
    list(REMOVE_ITEM languages NONE)
    if(languages)
        if(CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
            message(FATAL_ERROR "xclang.cmake is included before project(): the compilers are chosen there")
        endif()
        message(STATUS "xclang: the compilers are the including project's")
        return()
    endif()

    set(toolchain "${CMAKE_CURRENT_LIST_DIR}/toolchain.cmake")
    if(CMAKE_TOOLCHAIN_FILE)
        file(REAL_PATH "${CMAKE_TOOLCHAIN_FILE}" given)
        file(REAL_PATH "${toolchain}" ours)
        if(NOT given STREQUAL ours)
            message(FATAL_ERROR "xclang: the build has a toolchain file already, ${CMAKE_TOOLCHAIN_FILE}")
        endif()
    endif()
    set(CMAKE_TOOLCHAIN_FILE "${toolchain}" PARENT_SCOPE)

    if(NOT XCLANG_ROOT)
        cmake_host_system_information(RESULT arch QUERY OS_PLATFORM)
        if(arch MATCHES "^(arm64|aarch64|ARM64)$")
            set(arch aarch64)
        else()
            set(arch x86_64)
        endif()
        if(CMAKE_HOST_APPLE)
            set(host "${arch}-apple-darwin")
        elseif(CMAKE_HOST_WIN32)
            set(host "${arch}-w64-mingw32")
        else()
            set(host "${arch}-unknown-linux-gnu")
        endif()

        file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/SHA256SUMS" sums REGEX " [ *]?xclang-.*-${host}\\.tar\\.xz$")
        if(NOT sums MATCHES "^([0-9a-f]+) [ *]?(xclang-(.*)-${host})\\.tar\\.xz$")
            message(FATAL_ERROR "xclang: no toolchain for ${host} in ${CMAKE_CURRENT_LIST_DIR}/SHA256SUMS")
        endif()
        set(sha256 "${CMAKE_MATCH_1}")
        set(name "${CMAKE_MATCH_2}")
        set(version "${CMAKE_MATCH_3}")

        if(NOT XCLANG_CACHE_DIR)
            set(XCLANG_CACHE_DIR "${CMAKE_BINARY_DIR}/_deps")
        endif()
        if(NOT XCLANG_URL)
            set(XCLANG_URL "https://github.com/clice-io/xclang/releases/download/${version}")
        endif()
        set(root "${XCLANG_CACHE_DIR}/${name}")
        if(NOT EXISTS "${root}/bin")
            string(RANDOM LENGTH 8 tag)
            set(archive "${XCLANG_CACHE_DIR}/${name}.tar.xz.${tag}")
            message(STATUS "xclang: downloading ${XCLANG_URL}/${name}.tar.xz")
            file(DOWNLOAD "${XCLANG_URL}/${name}.tar.xz" "${archive}"
                EXPECTED_HASH SHA256=${sha256} STATUS status)
            list(GET status 0 code)
            if(NOT code EQUAL 0)
                file(REMOVE "${archive}")
                message(FATAL_ERROR "xclang: downloading ${XCLANG_URL}/${name}.tar.xz failed: ${status}")
            endif()
            # Unpacked aside and moved in place: an interrupted run leaves no
            # half tree where the next one looks.
            set(stage "${XCLANG_CACHE_DIR}/${name}.${tag}")
            file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${stage}")
            file(REMOVE "${archive}")
            file(RENAME "${stage}/xclang" "${root}" RESULT moved)
            file(REMOVE_RECURSE "${stage}")
            if(NOT moved EQUAL 0 AND NOT EXISTS "${root}/bin")
                message(FATAL_ERROR "xclang: unpacking ${name}.tar.xz into ${root} failed: ${moved}")
            endif()
        endif()
        set(XCLANG_ROOT "${root}" PARENT_SCOPE)
    endif()
endfunction()

_xclang_toolchain()
