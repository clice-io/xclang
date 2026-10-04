# C and C++ without modules: the compilers, the target's runtimes, and a
# library linked into a program.
add_executable(hello_c hello.c)
add_test(NAME hello_c COMMAND hello_c)

add_library(names STATIC names.cpp)
add_executable(hello_cpp hello.cpp)
target_link_libraries(hello_cpp PRIVATE names)
add_test(NAME hello_cpp COMMAND hello_cpp)
set_tests_properties(hello_cpp PROPERTIES PASS_REGULAR_EXPRESSION "hello from xclang, caught 42")
