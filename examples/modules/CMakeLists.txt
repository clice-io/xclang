cmake_minimum_required(VERSION 3.28)
project(shapes LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(xclang REQUIRED CONFIG)

add_library(math STATIC)
target_sources(math PUBLIC FILE_SET CXX_MODULES FILES math.cppm math-ops.cppm)
target_link_libraries(math PUBLIC xclang::std)

add_executable(shapes main.cpp)
target_link_libraries(shapes PRIVATE math xclang::std)
