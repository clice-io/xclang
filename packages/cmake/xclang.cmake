# Before project(): xclang as the build's toolchain, the host's archive of
# a release, downloaded once into a cache shared by every build tree and
# checked against the digest the release's SHA256SUMS gives it.
#
#   set(XCLANG_VERSION <version>)
#   include(FetchContent)
#   FetchContent_Declare(xclang
#       GIT_REPOSITORY https://github.com/clice-io/xclang
#       GIT_TAG ${XCLANG_VERSION})
#   FetchContent_MakeAvailable(xclang)
#   include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
#   project(...)
#
#   XCLANG_VERSION    the release whose toolchain to download, e.g. 23.1.2.6;
#                     by default the one tagging this checkout
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

    if(NOT XCLANG_ROOT)
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
        set(root "${cache}/${version}/${host}")

        if(NOT EXISTS "${root}/bin")
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
                file(DOWNLOAD "${url}/${file}" "${stage}/${file}" STATUS status)
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
        endif()
        set(XCLANG_ROOT "${root}")
        set(XCLANG_ROOT "${root}" PARENT_SCOPE)
    endif()

    # The toolchain file of the tree, or this checkout's for a release
    # without one (before 23.1.2.6).
    set(toolchain "${XCLANG_ROOT}/lib/cmake/xclang/toolchain.cmake")
    if(NOT EXISTS "${toolchain}")
        set(toolchain "${CMAKE_CURRENT_LIST_DIR}/toolchain.cmake")
    endif()
    if(CMAKE_TOOLCHAIN_FILE)
        file(REAL_PATH "${CMAKE_TOOLCHAIN_FILE}" given)
        file(REAL_PATH "${toolchain}" ours)
        if(NOT given STREQUAL ours)
            message(FATAL_ERROR "xclang: the build has a toolchain file already, ${CMAKE_TOOLCHAIN_FILE}")
        endif()
    endif()
    set(CMAKE_TOOLCHAIN_FILE "${toolchain}" PARENT_SCOPE)
endfunction()

_xclang_toolchain()
