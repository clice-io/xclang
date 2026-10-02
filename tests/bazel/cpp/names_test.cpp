#include <cstdio>
#include <stdexcept>

#include "names.h"

int main() {
  auto list = names();
  list->push_back("bazel");
  if (list->size() != 4 || name_at(*list, 1) != "lld") return 1;
  try {
    name_at(*list, 9);
    return 2;
  } catch (const std::out_of_range& e) {
    std::printf("caught: %s\n", e.what());
  }
  return 0;
}
