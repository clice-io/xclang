#include <stdio.h>
#include <stdlib.h>

int main(void) {
  char *p = malloc(16);
  snprintf(p, 16, "%s", "hello, C");
  puts(p);
  free(p);
  return 0;
}
