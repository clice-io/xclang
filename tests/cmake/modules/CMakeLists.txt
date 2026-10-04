# A module of partitions that imports std, in a library, and a program
# importing both; CMake scans each source (clang-scan-deps) for the order
# to build them in.
add_library(geometry STATIC)
target_sources(geometry PUBLIC FILE_SET CXX_MODULES FILES
    geometry.cppm
    geometry-shapes.cppm
    geometry-ops.cppm)
target_link_libraries(geometry PUBLIC xclang::std)

add_executable(modules_test main.cpp)
target_link_libraries(modules_test PRIVATE geometry xclang::std)
add_test(NAME modules COMMAND modules_test)
set_tests_properties(modules PROPERTIES PASS_REGULAR_EXPRESSION "triangle: 3 sides, perimeter 12")
