#include <cstdio>
#include <string>

import greeting;
import math;

int main() {
  std::string text = greeting(7);
  std::printf("%s, %d\n", text.c_str(), multiply(6, 7));
  return text == "square 49" && multiply(6, 7) == 42 ? 0 : 1;
}
