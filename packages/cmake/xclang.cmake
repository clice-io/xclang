# Before project(): xclang as the build's toolchain, the host's archive of
# a release, downloaded once into a cache shared by every build tree and
# checked against the digest the release's SHA256SUMS gives it.
#
#   include(FetchContent)
#   FetchContent_Declare(xclang
#       GIT_REPOSITORY https://github.com/clice-io/xclang
#       GIT_TAG latest)
#   FetchContent_MakeAvailable(xclang)
#   include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
#   project(...)
#
# `latest` is a branch at the newest release's tag; a release's tag, as
# GIT_TAG, keeps that release. A build directory keeps the toolchain of its
# first configure: another release, or another XCLANG_ROOT, takes a new
# one, or cmake --fresh.
#
#   XCLANG_VERSION    the release whose toolchain to download; by default
#                     the one tagging this checkout
#   XCLANG_TARGET     another target to build for (toolchain.cmake)
#   XCLANG_ROOT       an unpacked xclang to use instead of downloading one
#   XCLANG_CACHE_DIR  where toolchains are unpacked, <version>/<host> each;
#                     by default the user's cache, ~/.cache/xclang
#                     ($XDG_CACHE_HOME/xclang), ~/Library/Caches/xclang on
#                     macOS, %LOCALAPPDATA%/xclang on Windows
#   XCLANG_URL        where the release's SHA256SUMS and archives are; a
#                     mirror's digests are the mirror's

include_guard(GLOBAL)
if(CMAKE_VERSION VERSION_LESS 3.28)
    message(FATAL_ERROR "xclang needs CMake 3.28 or later, for C++20 modules")
endif()
cmake_policy(VERSION 3.28...4.3)

# The toolchain file CMake keeps from the first configure of a build
# directory (it caches it), when it is not <toolchain>: another xclang's,
# of another release or tree, which the directory cannot move to, or
# another toolchain's, such as vcpkg's (which chain-loads xclang's).
function(_xclang_given toolchain root)
    if(NOT CMAKE_TOOLCHAIN_FILE)
        return()
    endif()
    if(EXISTS "${CMAKE_TOOLCHAIN_FILE}" AND EXISTS "${toolchain}")
        file(REAL_PATH "${CMAKE_TOOLCHAIN_FILE}" given)
        file(REAL_PATH "${toolchain}" toolchain)
    else()
        get_filename_component(given "${CMAKE_TOOLCHAIN_FILE}" ABSOLUTE)
    endif()
    if(given STREQUAL toolchain)
        return()
    endif()
    get_filename_component(dir "${given}" DIRECTORY)
    if(EXISTS "${dir}/xclang-config.cmake" OR given MATCHES "/lib/cmake/xclang/toolchain\\.cmake$")
        message(FATAL_ERROR "xclang: this build directory is configured with another xclang, whose toolchain file "
            "${CMAKE_TOOLCHAIN_FILE} CMake keeps: for ${root}, configure a new build directory, or this one again "
            "with cmake --fresh")
    endif()
    message(FATAL_ERROR "xclang: the build has a toolchain file already, ${CMAKE_TOOLCHAIN_FILE}")
endfunction()

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

    if(XCLANG_ROOT)
        # Absolute, as the toolchain file makes it: a relative one is the
        # build directory's.
        file(TO_CMAKE_PATH "${XCLANG_ROOT}" root)
        get_filename_component(root "${root}" ABSOLUTE BASE_DIR "${CMAKE_BINARY_DIR}")
    else()
        set(version "${XCLANG_VERSION}")
        if(NOT version)
            # The release tagging this checkout, if one does: a rebuild of
            # the same commit is another release.
            find_package(Git QUIET)
            if(GIT_FOUND)
                execute_process(
                    COMMAND "${GIT_EXECUTABLE}" tag --points-at HEAD
                    WORKING_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
                    OUTPUT_VARIABLE tags OUTPUT_STRIP_TRAILING_WHITESPACE
                    ERROR_QUIET)
                string(REGEX MATCHALL "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+" version "${tags}")
            endif()
            list(LENGTH version releases)
            if(NOT releases EQUAL 1)
                message(FATAL_ERROR "xclang: ${CMAKE_CURRENT_LIST_DIR} is tagged by ${releases} releases; "
                    "set XCLANG_VERSION to the one to download")
            endif()
        endif()

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

        set(cache "${XCLANG_CACHE_DIR}")
        if(NOT cache)
            set(cache "$ENV{XCLANG_CACHE_DIR}")
        endif()
        if(NOT cache)
            if(CMAKE_HOST_WIN32)
                set(cache "$ENV{LOCALAPPDATA}/xclang")
            elseif(DEFINED ENV{XDG_CACHE_HOME})
                set(cache "$ENV{XDG_CACHE_HOME}/xclang")
            elseif(CMAKE_HOST_APPLE)
                set(cache "$ENV{HOME}/Library/Caches/xclang")
            else()
                set(cache "$ENV{HOME}/.cache/xclang")
            endif()
        endif()
        file(TO_CMAKE_PATH "${cache}" cache)
        get_filename_component(cache "${cache}" ABSOLUTE BASE_DIR "${CMAKE_BINARY_DIR}")
        set(root "${cache}/${version}/${host}")
    endif()

    # The toolchain file of the tree, also of one to download, or this
    # checkout's for a release without one (before 23.1.2.6): the build
    # directory's is checked against it before anything is downloaded.
    set(toolchain "${root}/lib/cmake/xclang/toolchain.cmake")
    set(fetch OFF)
    if(NOT XCLANG_ROOT AND NOT EXISTS "${root}/bin")
        set(fetch ON)
    elseif(NOT EXISTS "${toolchain}")
        set(toolchain "${CMAKE_CURRENT_LIST_DIR}/toolchain.cmake")
    endif()
    _xclang_given("${toolchain}" "${root}")

    if(fetch)
        set(url "${XCLANG_URL}")
        if(NOT url)
            set(url "https://github.com/clice-io/xclang/releases/download/${version}")
        endif()
        set(name "xclang-${version}-${host}.tar.xz")
        # Downloaded and unpacked aside, then moved in place: an
        # interrupted or concurrent configure leaves no half tree where
        # another one looks.
        string(RANDOM LENGTH 8 tag)
        set(stage "${cache}/${version}/.${host}.${tag}")
        file(MAKE_DIRECTORY "${stage}")
        foreach(file SHA256SUMS ${name})
            if(file STREQUAL name)
                message(STATUS "xclang: downloading ${url}/${name}")
            endif()
            # The server's certificate checked, which CMake before 3.31
            # skips unless told: SHA256SUMS, which the archive is checked
            # against, comes the same way.
            file(DOWNLOAD "${url}/${file}" "${stage}/${file}" STATUS status TLS_VERIFY ON)
            list(GET status 0 code)
            if(NOT code EQUAL 0)
                file(REMOVE_RECURSE "${stage}")
                message(FATAL_ERROR "xclang: downloading ${url}/${file} failed: ${status}")
            endif()
        endforeach()
        file(STRINGS "${stage}/SHA256SUMS" sums REGEX " [ *]?${name}$")
        file(SHA256 "${stage}/${name}" digest)
        if(NOT sums MATCHES "^${digest} ")
            file(REMOVE_RECURSE "${stage}")
            message(FATAL_ERROR "xclang: ${name} has the sha256 ${digest}, "
                "not the one ${url}/SHA256SUMS gives it: ${sums}")
        endif()
        file(ARCHIVE_EXTRACT INPUT "${stage}/${name}" DESTINATION "${stage}")
        file(RENAME "${stage}/xclang" "${root}" RESULT moved)
        file(REMOVE_RECURSE "${stage}")
        if(NOT EXISTS "${root}/bin")
            message(FATAL_ERROR "xclang: unpacking ${name} into ${root} failed: ${moved}")
        endif()
        if(NOT EXISTS "${toolchain}")
            set(toolchain "${CMAKE_CURRENT_LIST_DIR}/toolchain.cmake")
            _xclang_given("${toolchain}" "${root}")
        endif()
    endif()
    set(XCLANG_ROOT "${root}" PARENT_SCOPE)
    set(CMAKE_TOOLCHAIN_FILE "${toolchain}" PARENT_SCOPE)
endfunction()

_xclang_toolchain()
