# C and C++ without modules: the compilers, the target's runtimes, and a
# library linked into a program.
add_executable(hello_c hello.c)
add_test(NAME hello_c COMMAND hello_c)
# A version resource, by the target's resource compiler (llvm-windres).
if(WIN32)
    target_sources(hello_c PRIVATE version.rc)
endif()

add_library(names STATIC names.cpp)
add_executable(hello_cpp hello.cpp)
target_link_libraries(hello_cpp PRIVATE names)
add_test(NAME hello_cpp COMMAND hello_cpp)
set_tests_properties(hello_cpp PROPERTIES PASS_REGULAR_EXPRESSION "hello from xclang, caught 42")
# A musl target's programs are static: no program interpreter, no dynamic
# section.
if(CMAKE_CXX_COMPILER_TARGET MATCHES "-musl$")
    add_test(NAME hello_cpp_static COMMAND "${XCLANG_READOBJ}" --program-headers "$<TARGET_FILE:hello_cpp>")
    set_tests_properties(hello_cpp_static PROPERTIES
        PASS_REGULAR_EXPRESSION "PT_LOAD" FAIL_REGULAR_EXPRESSION "PT_INTERP|PT_DYNAMIC")
endif()

# Its debug symbols after the link (xclang_debug_symbols): hello_cpp.gsym,
# from hello_cpp.dSYM on macOS, read back by the toolchain's llvm-gsymutil.
# An MSVC target's are in the PDB of its link, which -g asks for too.
target_compile_options(hello_cpp PRIVATE -g)
xclang_debug_symbols(hello_cpp)
if(CMAKE_CXX_SIMULATE_ID STREQUAL "MSVC")
    target_link_options(hello_cpp PRIVATE -g)
    add_test(NAME hello_cpp_pdb COMMAND "${XCLANG_READOBJ}" --coff-debug-directory "$<TARGET_FILE:hello_cpp>")
    set_tests_properties(hello_cpp_pdb PROPERTIES PASS_REGULAR_EXPRESSION "PDBFileName: .*hello_cpp\\.pdb")
else()
    add_test(NAME hello_cpp_gsym COMMAND "${XCLANG_GSYMUTIL}" "$<TARGET_FILE_DIR:hello_cpp>/hello_cpp.gsym")
    set_tests_properties(hello_cpp_gsym PROPERTIES PASS_REGULAR_EXPRESSION "hello\\.cpp:[0-9]")

    # Linked with identical code folding: twin_a and twin_b, merged, both in
    # the GSYM (--merged-functions), on macOS through the dSYM, whose debug
    # map keeps the folded one (--keep-icf-stabs). On macOS in DWARF 5,
    # whose line tables dsymutil's parallel linker writes so that atos
    # crashes (tests/cmake/cmake.ts reads it with atos).
    add_executable(hello_icf icf.cpp)
    target_compile_options(hello_icf PRIVATE -g -ffunction-sections $<$<PLATFORM_ID:Darwin>:-gdwarf-5>)
    target_link_options(hello_icf PRIVATE -Wl,--icf=all)
    xclang_debug_symbols(hello_icf GSYM_ARGS --merged-functions)
    foreach(twin twin_a twin_b)
        add_test(NAME hello_icf_${twin} COMMAND "${XCLANG_GSYMUTIL}" "$<TARGET_FILE_DIR:hello_icf>/hello_icf.gsym")
        set_tests_properties(hello_icf_${twin} PROPERTIES PASS_REGULAR_EXPRESSION "${twin}")
    endforeach()
endif()
