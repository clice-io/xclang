# A tool built on libclang the way clice is: find_package(Clang) on the
# unpacked archive, compiled and linked by the xclang toolchain of the same
# host (tests/libclang/libclang.ts).
cmake_minimum_required(VERSION 3.20)
project(libclang-consumer CXX)

find_package(Clang REQUIRED CONFIG)

add_executable(consumer main.cpp)
set_target_properties(consumer PROPERTIES CXX_STANDARD 17)
target_compile_options(consumer PRIVATE -fno-rtti)
target_include_directories(consumer SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
target_link_libraries(consumer PRIVATE clangBasic clangLex LLVMSupport)

# Every target's MC layer, as CMake's components name it; in archives that
# have it (not before 23.1.2.6: tests/libclang/libclang.ts requires it).
if(TARGET LLVMAArch64AsmParser)
    llvm_map_components_to_libnames(targets_libraries
        AllTargetsInfos AllTargetsDescs AllTargetsAsmParsers AllTargetsDisassemblers)
    add_executable(targets targets.cpp)
    set_target_properties(targets PROPERTIES CXX_STANDARD 17)
    target_compile_options(targets PRIVATE -fno-rtti)
    target_include_directories(targets SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS})
    target_link_libraries(targets PRIVATE ${targets_libraries} LLVMMC LLVMSupport LLVMTargetParser)
endif()

# Under xclang's CMake package (tests/cmake), its debug symbols too.
if(COMMAND xclang_debug_symbols)
    target_compile_options(consumer PRIVATE -g)
    xclang_debug_symbols(consumer)
endif()
