#include <stdio.h>

#ifndef __clang__
#error "crates' C code is compiled by xclang's clang"
#endif

int hello(char* buffer, int size) {
    return snprintf(buffer, (size_t)size, "hello from C");
}
