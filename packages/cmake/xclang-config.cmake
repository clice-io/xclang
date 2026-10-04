# find_package(xclang): import std and import std.compat for a build that
# xclang's clang compiles, as a library to link.
#
#   xclang::std         libc++'s std and std.compat modules, built for the
#                       build's target with the settings of the directory
#                       that called find_package(xclang), as they stand at
#                       the end of its CMakeLists.txt
#   xclang_add_std(<name>)
#                       another such library, for importers compiled with
#                       other language options: they go on it as PUBLIC
#                       options, and reach its importers from there
#   XCLANG_ROOT         the toolchain's directory
#
# clang refuses a module built with other language options (-std, GNU
# extensions, -fno-exceptions, -fno-rtti, ...) than its importer's; macros,
# include paths and optimization may differ. xclang::std requires C++23 of
# its importers, or the CMAKE_CXX_STANDARD it was built with.

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

# libc++'s module manifest of the target, from the compiler: the sources of
# std and std.compat, and the directory they include from.
get_property(_xclang_manifest GLOBAL PROPERTY XCLANG_STD_MANIFEST)
if(NOT _xclang_manifest)
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

get_filename_component(XCLANG_ROOT "${CMAKE_CXX_COMPILER}" DIRECTORY)
get_filename_component(XCLANG_ROOT "${XCLANG_ROOT}/.." ABSOLUTE)

if(NOT COMMAND xclang_add_std)
    function(xclang_add_std name)
        get_property(_manifest GLOBAL PROPERTY XCLANG_STD_MANIFEST)
        get_filename_component(_dir "${_manifest}" DIRECTORY)
        file(READ "${_manifest}" _json)
        string(JSON _count LENGTH "${_json}" modules)
        math(EXPR _last "${_count} - 1")
        set(_sources "")
        set(_includes "")
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
        list(REMOVE_DUPLICATES _includes)
        list(GET _sources 0 _first)
        get_filename_component(_base "${_first}" DIRECTORY)

        add_library(${name} STATIC EXCLUDE_FROM_ALL)
        target_sources(${name} PUBLIC FILE_SET CXX_MODULES BASE_DIRS "${_base}" FILES ${_sources})
        target_include_directories(${name} SYSTEM PRIVATE ${_includes})
        # The warnings libc++'s own build turns off for them.
        target_compile_options(${name} PRIVATE -Wno-reserved-module-identifier -Wno-reserved-user-defined-literal)
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
endif()

get_property(_xclang_deferred GLOBAL PROPERTY _XCLANG_STD_DEFERRED)
if(NOT _xclang_deferred)
    set_property(GLOBAL PROPERTY _XCLANG_STD_DEFERRED ON)
    cmake_language(DEFER CALL _xclang_std)
endif()

set(xclang_FOUND TRUE)
