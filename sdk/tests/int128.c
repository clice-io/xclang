// 128-bit division is a call to compiler-rt's __udivti3 / __divti3.
#include <stdio.h>

int main(int argc, char **argv) {
  (void)argv;
  unsigned __int128 a = ((unsigned __int128)1 << 100) + argc;
  unsigned __int128 b = 12345 + argc;
  unsigned long long q = (unsigned long long)(a / b);
  printf("%llu\n", q);
  return 0;
}
