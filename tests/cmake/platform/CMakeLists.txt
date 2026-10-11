# The platform's C++ library (XCLANG_STDLIB=platform of the toolchain file),
# as tests/cmake/cmake.ts builds this project: a C++ program that throws,
# and says which library caught it, matched against XCLANG_TEST_EXPECT.
cmake_minimum_required(VERSION 3.28)
project(xclang_platform_tests LANGUAGES C CXX)
enable_testing()

add_executable(platform platform.cpp)
add_test(NAME platform COMMAND platform)
set_tests_properties(platform PROPERTIES PASS_REGULAR_EXPRESSION "${XCLANG_TEST_EXPECT}")
