# The C++ runtimes built from source (XCLANG_RUNTIMES=source,
# packages/cmake/runtimes.cmake), as tests/cmake/cmake.ts builds this
# project once per variant: its tests follow the variant's options.
cmake_minimum_required(VERSION 3.28)
project(xclang_runtimes_tests LANGUAGES CXX)
enable_testing()

find_package(xclang REQUIRED CONFIG)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

# What the program says of the variant: libc++'s inline namespace, the
# default hardening mode of its headers (_LIBCPP_HARDENING_MODE_* values),
# and whether it is compiled with exceptions.
set(namespace __1)
if(XCLANG_LIBCXX_ABI_NAMESPACE)
    set(namespace ${XCLANG_LIBCXX_ABI_NAMESPACE})
elseif(XCLANG_LIBCXX_ABI_VERSION)
    set(namespace __${XCLANG_LIBCXX_ABI_VERSION})
endif()
set(modes none 2 fast 4 extensive 16 debug 8)
set(hardening none)
if(XCLANG_LIBCXX_HARDENING)
    set(hardening ${XCLANG_LIBCXX_HARDENING})
endif()
list(FIND modes ${hardening} index)
math(EXPR index "${index} + 1")
list(GET modes ${index} mode)
set(exceptions 1)
if(CMAKE_CXX_FLAGS MATCHES "-fno-exceptions")
    set(exceptions 0)
endif()

add_executable(variant variant.cpp)
add_test(NAME variant COMMAND variant)
set_tests_properties(variant PROPERTIES
    PASS_REGULAR_EXPRESSION "namespace ${namespace} hardening ${mode} exceptions ${exceptions}\nstream: 42 3.5")

# import std of the variant: its modules, built against its headers, with
# its namespace, which a function of the program on their types is named
# with (with another, the program would not link either).
add_executable(variant_std std.cpp)
target_link_libraries(variant_std PRIVATE xclang::std)
add_test(NAME std COMMAND variant_std)
set_tests_properties(std PROPERTIES PASS_REGULAR_EXPRESSION "3 elements")
add_test(NAME std_namespace COMMAND "${CMAKE_NM}" -C "$<TARGET_FILE:variant_std>")
set_tests_properties(std_namespace PROPERTIES PASS_REGULAR_EXPRESSION "add\\(std::${namespace}::vector<std::${namespace}::basic_string")

# A read past the end of a vector: with a hardening mode, a trap.
if(NOT hardening STREQUAL "none")
    add_test(NAME oob COMMAND "${CMAKE_COMMAND}" "-DPROGRAM=$<TARGET_FILE:variant>" -DARGUMENT=oob
        -P "${CMAKE_CURRENT_SOURCE_DIR}/trap.cmake")
endif()

# MemorySanitizer: nothing to report of what libc++ itself writes (it is
# instrumented), and a use of uninitialized memory inside libc++, reported
# (in istream's sentry, which the library's code is).
if(memory IN_LIST XCLANG_SANITIZER)
    set(symbolizer "MSAN_SYMBOLIZER_PATH=${XCLANG_ROOT}/bin/llvm-symbolizer")
    add_test(NAME msan_clean COMMAND variant)
    set_tests_properties(msan_clean PROPERTIES ENVIRONMENT "${symbolizer}"
        PASS_REGULAR_EXPRESSION "stream: 42 3.5" FAIL_REGULAR_EXPRESSION "MemorySanitizer")
    add_test(NAME msan_report COMMAND variant uninitialized)
    set_tests_properties(msan_report PROPERTIES ENVIRONMENT "${symbolizer}"
        PASS_REGULAR_EXPRESSION "MemorySanitizer: use-of-uninitialized-value(.|\n)*::sentry::sentry")
endif()
