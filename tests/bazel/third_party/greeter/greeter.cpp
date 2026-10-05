#include "greeter.h"

#include <cstdio>

int greet(const char* name) {
  return std::printf("hello %s\n", name);  // the greeter's line
}
