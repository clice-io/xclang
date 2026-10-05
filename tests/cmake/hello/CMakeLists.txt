# C and C++ without modules: the compilers, the target's runtimes, and a
# library linked into a program.
add_executable(hello_c hello.c)
add_test(NAME hello_c COMMAND hello_c)

add_library(names STATIC names.cpp)
add_executable(hello_cpp hello.cpp)
target_link_libraries(hello_cpp PRIVATE names)
add_test(NAME hello_cpp COMMAND hello_cpp)
set_tests_properties(hello_cpp PROPERTIES PASS_REGULAR_EXPRESSION "hello from xclang, caught 42")

# Its debug symbols after the link (xclang_debug_symbols): hello_cpp.gsym,
# from hello_cpp.dSYM on macOS, read back by the toolchain's llvm-gsymutil.
target_compile_options(hello_cpp PRIVATE -g)
xclang_debug_symbols(hello_cpp)
add_test(NAME hello_cpp_gsym COMMAND "${XCLANG_GSYMUTIL}" "$<TARGET_FILE_DIR:hello_cpp>/hello_cpp.gsym")
set_tests_properties(hello_cpp_gsym PROPERTIES PASS_REGULAR_EXPRESSION "hello\\.cpp:[0-9]")
