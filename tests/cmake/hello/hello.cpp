// C++ with headers: iostreams, and an exception thrown in a library.
#include <iostream>
#include <stdexcept>
#include <string>

std::string greet(const std::string& name);

int main() {
  try {
    std::cout << greet("xclang");
    greet("");
  } catch (const std::invalid_argument& e) {
    std::cout << ", caught " << e.what() << "\n";
    return 0;
  }
  return 1;
}
