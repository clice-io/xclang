#include <stdlib.h>

int main(int argc, char **argv) {
  (void)argv;
  char *p = malloc(8);
  p[8 + argc] = 1; // heap-buffer-overflow
  free(p);
  return 0;
}
