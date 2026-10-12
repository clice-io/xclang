# A project of CMake 3.2's policies, as tests/cmake/cmake.ts builds it
# through the toolchain file, which works under its own: a C program, run.
cmake_minimum_required(VERSION 3.2)
project(xclang_policies_tests LANGUAGES C)
enable_testing()

add_executable(policies ../hello/hello.c)
add_test(NAME policies COMMAND policies)
