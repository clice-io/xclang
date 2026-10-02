// C, compiled by clang as C and linked against the target's C runtime.
#include <stdio.h>
#include <string.h>

int main(void) {
  char buffer[32];
  snprintf(buffer, sizeof buffer, "C %ld", (long)__STDC_VERSION__);
  puts(buffer);
  return __STDC_VERSION__ >= 201112L && strlen(buffer) == 8 ? 0 : 1;
}
