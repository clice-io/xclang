#include <stddef.h>
#include <stdio.h>
#include <time.h>

/* Its layout differs by target: long is 32 bits on Windows, wchar_t 16,
   time_t is a libc's. */
struct probe {
    char c;
    long l;
    wchar_t w;
    time_t t;
    FILE* f;
};

size_t probe_size(void);
int probe_c(char* buffer, int size);
