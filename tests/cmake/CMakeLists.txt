# The xclang CMake package as a consumer uses it (tests/cmake.ts): the
# compilers, find_package(xclang) and import std, for the host or another
# target (XCLANG_TARGET).
#
#   XCLANG_TEST_FETCH     a release: nothing installed, xclang's source of
#                         its tag fetched (FETCHCONTENT_SOURCE_DIR_XCLANG
#                         stands in for it), and its toolchain downloaded
#                         by xclang.cmake
#   XCLANG_TEST_LIBCLANG  with libclang's CMake packages in CMAKE_PREFIX_PATH:
#                         tests/libclang, a tool on find_package(Clang), too
cmake_minimum_required(VERSION 3.28)

if(XCLANG_TEST_FETCH)
    set(XCLANG_VERSION ${XCLANG_TEST_FETCH})
    include(FetchContent)
    FetchContent_Declare(xclang
        GIT_REPOSITORY https://github.com/clice-io/xclang
        GIT_TAG ${XCLANG_VERSION})
    FetchContent_MakeAvailable(xclang)
    include(${xclang_SOURCE_DIR}/packages/cmake/xclang.cmake)
endif()

project(xclang_tests LANGUAGES C CXX)
enable_testing()

find_package(xclang REQUIRED CONFIG)

# After find_package: xclang::std is built with what the directory ends
# with, here C++23 without GNU extensions, as its importers are (a module
# file of gnu++23 would not load into them).
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

add_subdirectory(hello)
add_subdirectory(std)
add_subdirectory(modules)
add_subdirectory(noexcept)
if(XCLANG_TEST_LIBCLANG)
    add_subdirectory(../libclang libclang)
    add_test(NAME libclang COMMAND consumer)
    set_tests_properties(libclang PROPERTIES PASS_REGULAR_EXPRESSION "clang version [0-9].*tokens 9 zlib 1 zstd 1")
endif()
