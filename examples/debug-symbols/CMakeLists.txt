cmake_minimum_required(VERSION 3.28)
project(tool LANGUAGES CXX)

find_package(xclang REQUIRED CONFIG)

add_executable(tool tool.cpp)
target_compile_options(tool PRIVATE -gline-tables-only)
xclang_debug_symbols(tool)
