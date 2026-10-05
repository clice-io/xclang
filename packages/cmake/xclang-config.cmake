# find_package(xclang): import std and import std.compat for a build that
# xclang's clang compiles, as a library to link.
#
#   xclang::std         libc++'s std and std.compat modules (for an MSVC
#                       target, those of Microsoft's STL), built for the
#                       build's target with the settings of the directory
#                       that called find_package(xclang), as they stand at
#                       the end of its CMakeLists.txt
#   xclang_add_std(<name>)
#                       another such library, for importers compiled with
#                       other language options: they go on it as PUBLIC
#                       options, and reach its importers from there
#   xclang_debug_symbols(<target> [GSYM_ARGS <option>...])
#                       after each link of <target>, its GSYM next to it,
#                       and for a macOS target its dSYM, by the toolchain's
#                       llvm-gsymutil and dsymutil; nothing for an MSVC
#                       target, whose link writes the PDB
#   XCLANG_ROOT         the toolchain's directory
#   XCLANG_THINLTO_CACHE
#                       set: the directory of the linker's ThinLTO cache
#                       for the links of the directory and below (further
#                       down)
#
# clang refuses a module built with other language options (-std, GNU
# extensions, -fno-exceptions, -fno-rtti, ...) than its importer's; macros,
# include paths and optimization may differ. xclang::std requires C++23 of
# its importers, or the CMAKE_CXX_STANDARD it was built with.

# xclang_debug_symbols' step after a link, cmake -P on this file:
# llvm-gsymutil, whose warnings (one per DIE it cannot convert, gigabytes
# for a large program with folded functions) go to <output>.log.
if(CMAKE_SCRIPT_MODE_FILE STREQUAL CMAKE_CURRENT_LIST_FILE)
    string(REPLACE "|" ";" _xclang_args "${XCLANG_GSYM_ARGS}")
    execute_process(
        COMMAND "${XCLANG_GSYMUTIL}" --convert "${XCLANG_GSYM_INPUT}" --out-file "${XCLANG_GSYM_OUTPUT}" --quiet ${_xclang_args}
        OUTPUT_FILE "${XCLANG_GSYM_OUTPUT}.log"
        ERROR_FILE "${XCLANG_GSYM_OUTPUT}.log"
        RESULT_VARIABLE _xclang_result)
    if(NOT _xclang_result EQUAL 0)
        message(FATAL_ERROR "llvm-gsymutil failed (${_xclang_result}), see ${XCLANG_GSYM_OUTPUT}.log")
    endif()
    return()
endif()

if(CMAKE_VERSION VERSION_LESS 3.28)
    set(xclang_FOUND FALSE)
    set(xclang_NOT_FOUND_MESSAGE "xclang needs CMake 3.28 or later, for C++20 modules")
    return()
endif()
cmake_policy(VERSION 3.28...4.3)

get_property(_xclang_languages GLOBAL PROPERTY ENABLED_LANGUAGES)
if(NOT CXX IN_LIST _xclang_languages)
    set(xclang_FOUND FALSE)
    set(xclang_NOT_FOUND_MESSAGE "find_package(xclang) comes after project() or enable_language(CXX)")
    return()
endif()

get_filename_component(XCLANG_ROOT "${CMAKE_CXX_COMPILER}" DIRECTORY)
get_filename_component(XCLANG_ROOT "${XCLANG_ROOT}/.." ABSOLUTE)

# libc++'s module manifest of the target, from the compiler: the sources of
# std and std.compat, and the directory they include from. For an MSVC
# target, the STL's (modules.json, std.ixx), in the toolset of the SDK the
# config files read, which clang does not report.
get_property(_xclang_manifest GLOBAL PROPERTY XCLANG_STD_MANIFEST)
if(NOT _xclang_manifest AND CMAKE_CXX_SIMULATE_ID STREQUAL "MSVC")
    file(GLOB _xclang_manifest "${XCLANG_ROOT}/sdk/windows/VC/Tools/MSVC/*/modules/modules.json")
    if(NOT _xclang_manifest)
        set(xclang_FOUND FALSE)
        set(xclang_NOT_FOUND_MESSAGE
            "no modules.json of Microsoft's STL in ${XCLANG_ROOT}/sdk/windows: fetch the SDK again with this xclang")
        return()
    endif()
    set_property(GLOBAL PROPERTY XCLANG_STD_MANIFEST "${_xclang_manifest}")
elseif(NOT _xclang_manifest)
    set(_xclang_args "")
    if(CMAKE_CXX_COMPILER_TARGET)
        list(APPEND _xclang_args "--target=${CMAKE_CXX_COMPILER_TARGET}")
    endif()
    if(APPLE)
        foreach(_xclang_arch IN LISTS CMAKE_OSX_ARCHITECTURES)
            list(APPEND _xclang_args -arch "${_xclang_arch}")
        endforeach()
    endif()
    execute_process(
        COMMAND "${CMAKE_CXX_COMPILER}" ${_xclang_args} -print-library-module-manifest-path
        OUTPUT_VARIABLE _xclang_manifest
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE _xclang_result)
    if(NOT _xclang_result EQUAL 0 OR NOT EXISTS "${_xclang_manifest}")
        set(xclang_FOUND FALSE)
        set(xclang_NOT_FOUND_MESSAGE
            "${CMAKE_CXX_COMPILER} has no libc++ module manifest (${_xclang_manifest}): is it xclang's clang++?")
        return()
    endif()
    file(TO_CMAKE_PATH "${_xclang_manifest}" _xclang_manifest)
    set_property(GLOBAL PROPERTY XCLANG_STD_MANIFEST "${_xclang_manifest}")
endif()

if(NOT COMMAND xclang_add_std)
    function(xclang_add_std name)
        get_property(_manifest GLOBAL PROPERTY XCLANG_STD_MANIFEST)
        get_filename_component(_dir "${_manifest}" DIRECTORY)
        file(READ "${_manifest}" _json)
        set(_sources "")
        set(_includes "")
        # The warnings libc++'s own build turns off for them.
        set(_options -Wno-reserved-module-identifier -Wno-reserved-user-defined-literal)
        string(JSON _library ERROR_VARIABLE _none GET "${_json}" library)
        if(_library STREQUAL "microsoft/STL")
            # Microsoft's, {"module-sources": ["std.ixx", ...]}: sources
            # clang takes for C++ by their name only, so copied as .cppm,
            # which include the STL's headers in the module's purview. The
            # copies include <malloc.h> before the module too, with the C
            # headers: for arm64, clang 23 otherwise takes the _alloca of
            # <malloc.h>, included in the purview, for a second declaration.
            string(JSON _count LENGTH "${_json}" module-sources)
            math(EXPR _last "${_count} - 1")
            foreach(_i RANGE ${_last})
                string(JSON _source GET "${_json}" module-sources ${_i})
                get_filename_component(_stem "${_source}" NAME_WLE)
                set(_copy "${CMAKE_CURRENT_BINARY_DIR}/${name}/${_stem}.cppm")
                file(READ "${_dir}/${_source}" _text)
                string(REPLACE "\n#include <intrin.h>\n" "\n#include <intrin.h>\n#include <malloc.h>\n" _text "${_text}")
                set(_old "")
                if(EXISTS "${_copy}")
                    file(READ "${_copy}" _old)
                endif()
                if(NOT _old STREQUAL _text)
                    file(WRITE "${_copy}" "${_text}")
                endif()
                set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${_dir}/${_source}")
                list(APPEND _sources "${_copy}")
            endforeach()
            list(APPEND _options -Wno-include-angled-in-module-purview)
        else()
            string(JSON _count LENGTH "${_json}" modules)
            math(EXPR _last "${_count} - 1")
            foreach(_i RANGE ${_last})
                string(JSON _source GET "${_json}" modules ${_i} source-path)
                get_filename_component(_source "${_dir}/${_source}" ABSOLUTE)
                list(APPEND _sources "${_source}")
                string(JSON _n ERROR_VARIABLE _none LENGTH "${_json}" modules ${_i} local-arguments system-include-directories)
                if(_n)
                    math(EXPR _n "${_n} - 1")
                    foreach(_j RANGE ${_n})
                        string(JSON _include GET "${_json}" modules ${_i} local-arguments system-include-directories ${_j})
                        get_filename_component(_include "${_dir}/${_include}" ABSOLUTE)
                        list(APPEND _includes "${_include}")
                    endforeach()
                endif()
            endforeach()
        endif()
        list(REMOVE_DUPLICATES _includes)
        list(GET _sources 0 _first)
        get_filename_component(_base "${_first}" DIRECTORY)

        add_library(${name} STATIC EXCLUDE_FROM_ALL)
        target_sources(${name} PUBLIC FILE_SET CXX_MODULES BASE_DIRS "${_base}" FILES ${_sources})
        target_include_directories(${name} SYSTEM PRIVATE ${_includes})
        target_compile_options(${name} PRIVATE ${_options})
        # Importers start from the standard it is built with.
        get_target_property(_standard ${name} CXX_STANDARD)
        if(NOT _standard OR _standard STREQUAL "98" OR _standard LESS 20)
            set(_standard 23)
        endif()
        if(cxx_std_${_standard} IN_LIST CMAKE_CXX_COMPILE_FEATURES)
            target_compile_features(${name} PUBLIC cxx_std_${_standard})
        endif()
        set_target_properties(${name} PROPERTIES CXX_SCAN_FOR_MODULES ON)
    endfunction()

    # xclang::std is made at the end of the directory that first asked for
    # it, from the settings that directory ends with.
    function(_xclang_std)
        if(NOT TARGET xclang_std)
            xclang_add_std(xclang_std)
            add_library(xclang::std ALIAS xclang_std)
        endif()
    endfunction()

    # <file>.gsym, from the program's DWARF; for a macOS target, from its
    # <file>.dSYM, made first by dsymutil from the objects the debug map
    # points into: the link keeps ThinLTO's in <target>.lto for it, as
    # clang keeps them when it compiles and links in one command.
    function(xclang_debug_symbols target)
        # MSVC targets have CodeView, in the PDB the link writes.
        if(CMAKE_CXX_SIMULATE_ID STREQUAL "MSVC")
            return()
        endif()
        cmake_parse_arguments(PARSE_ARGV 1 _arg "" "" "GSYM_ARGS")
        get_filename_component(_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
        if(CMAKE_HOST_WIN32)
            set(_exe ".exe")
        endif()
        set(_input "$<TARGET_FILE:${target}>")
        if(APPLE)
            set(_lto "${CMAKE_CURRENT_BINARY_DIR}/${target}.lto")
            file(MAKE_DIRECTORY "${_lto}")
            target_link_options(${target} PRIVATE "LINKER:-object_path_lto,${_lto}")
            add_custom_command(TARGET ${target} POST_BUILD
                COMMAND "${_bin}/dsymutil${_exe}" "$<TARGET_FILE:${target}>" -o "$<TARGET_FILE:${target}>.dSYM"
                VERBATIM)
            set(_input "$<TARGET_FILE:${target}>.dSYM/Contents/Resources/DWARF/$<TARGET_FILE_NAME:${target}>")
        endif()
        string(REPLACE ";" "|" _args "${_arg_GSYM_ARGS}")
        add_custom_command(TARGET ${target} POST_BUILD
            COMMAND "${CMAKE_COMMAND}" "-DXCLANG_GSYMUTIL=${_bin}/llvm-gsymutil${_exe}" "-DXCLANG_GSYM_INPUT=${_input}"
                "-DXCLANG_GSYM_OUTPUT=$<TARGET_FILE_DIR:${target}>/$<TARGET_FILE_BASE_NAME:${target}>.gsym"
                "-DXCLANG_GSYM_ARGS=${_args}" -P "${CMAKE_CURRENT_FUNCTION_LIST_FILE}"
            VERBATIM)
    endfunction()
endif()

# The linker's ThinLTO cache: with XCLANG_THINLTO_CACHE, an absolute
# directory (or the environment variable of that name at the first
# configure), the links of the directory that called find_package(xclang)
# and of its subdirectories keep the code ThinLTO generates per module there
# and reuse it, so a link of libclang's bitcode after the first takes seconds.
# The directory is made here; the flag is the target's linker's.
if(NOT DEFINED XCLANG_THINLTO_CACHE AND DEFINED ENV{XCLANG_THINLTO_CACHE})
    set(XCLANG_THINLTO_CACHE "$ENV{XCLANG_THINLTO_CACHE}" CACHE PATH "The linker's ThinLTO cache")
endif()
if(XCLANG_THINLTO_CACHE)
    file(TO_CMAKE_PATH "${XCLANG_THINLTO_CACHE}" _xclang_cache)
    if(NOT IS_ABSOLUTE "${_xclang_cache}")
        set(xclang_FOUND FALSE)
        set(xclang_NOT_FOUND_MESSAGE "XCLANG_THINLTO_CACHE is not an absolute path: ${XCLANG_THINLTO_CACHE}")
        return()
    endif()
    file(MAKE_DIRECTORY "${_xclang_cache}")
    if(APPLE)
        # ld64.lld (and Apple's ld, with libLTO).
        set(_xclang_cache "LINKER:-cache_path_lto,${_xclang_cache}")
    elseif(CMAKE_CXX_SIMULATE_ID STREQUAL "MSVC")
        # lld-link.
        set(_xclang_cache "LINKER:/lldltocache:${_xclang_cache}")
    else()
        # lld for ELF and for COFF (MinGW).
        set(_xclang_cache "LINKER:--thinlto-cache-dir=${_xclang_cache}")
    endif()
    get_directory_property(_xclang_options LINK_OPTIONS)
    if(NOT _xclang_cache IN_LIST _xclang_options)
        add_link_options("${_xclang_cache}")
    endif()
endif()

get_property(_xclang_deferred GLOBAL PROPERTY _XCLANG_STD_DEFERRED)
if(NOT _xclang_deferred)
    set_property(GLOBAL PROPERTY _XCLANG_STD_DEFERRED ON)
    cmake_language(DEFER CALL _xclang_std)
endif()

set(xclang_FOUND TRUE)
