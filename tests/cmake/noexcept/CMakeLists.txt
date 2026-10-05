# Importers compiled without exceptions: a std of their own, whose PUBLIC
# options are theirs too. (xclang::std, built with exceptions, would not
# load into them.)
xclang_add_std(std_noexcept)
target_compile_options(std_noexcept PUBLIC -fno-exceptions)
# Microsoft's STL throws unless told not to.
if(CMAKE_CXX_SIMULATE_ID STREQUAL "MSVC")
    target_compile_definitions(std_noexcept PUBLIC _HAS_EXCEPTIONS=0)
endif()

add_executable(noexcept_test main.cpp)
target_link_libraries(noexcept_test PRIVATE std_noexcept)
add_test(NAME noexcept COMMAND noexcept_test)
set_tests_properties(noexcept PROPERTIES PASS_REGULAR_EXPRESSION "no exceptions: 6")
