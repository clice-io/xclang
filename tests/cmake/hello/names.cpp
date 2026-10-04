#include <stdexcept>
#include <string>

std::string greet(const std::string& name) {
  if (name.empty()) throw std::invalid_argument("42");
  return "hello from " + name;
}
