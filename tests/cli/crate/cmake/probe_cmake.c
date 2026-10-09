#ifndef __clang__
#error "the cmake crate's C code is compiled by xclang's clang"
#endif

int probe_cmake(void) { return 42; }
