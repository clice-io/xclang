# import std and import std.compat, from xclang::std.
add_executable(std_test std.cpp)
target_link_libraries(std_test PRIVATE xclang::std)
add_test(NAME std COMMAND std_test)
set_tests_properties(std PROPERTIES PASS_REGULAR_EXPRESSION "3 4 5: 3 sides, caught 7\nfrom std.compat")
