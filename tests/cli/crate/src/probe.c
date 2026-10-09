#include "probe.h"

#ifndef __clang__
#error "crates' C code is compiled by xclang's clang"
#endif

size_t probe_size(void) { return sizeof(struct probe); }

int probe_c(char* buffer, int size) { return snprintf(buffer, (size_t)size, "C"); }
