# A tool built on libclang the way clice is: find_package(Clang) on the
# unpacked archive, compiled and linked by the xclang toolchain of the same
# host (tests/libclang.ts).
cmake_minimum_required(VERSION 3.20)
project(libclang-consumer CXX)

find_package(Clang REQUIRED CONFIG)

add_executable(consumer main.cpp)
set_target_properties(consumer PROPERTIES CXX_STANDARD 17)
target_compile_options(consumer PRIVATE -fno-rtti)
target_include_directories(consumer SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(consumer PRIVATE clangBasic clangLex LLVMSupport)
