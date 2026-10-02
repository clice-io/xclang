#include "names.h"

#include <stdexcept>

namespace {
// A static initializer of the library.
const std::vector<std::string> defaults = {"clang", "lld", "libc++"};
}  // namespace

std::unique_ptr<std::vector<std::string>> names() {
  return std::make_unique<std::vector<std::string>>(defaults);
}

const std::string& name_at(const std::vector<std::string>& names, std::size_t index) {
  if (index >= names.size()) throw std::out_of_range("no name " + std::to_string(index));
  return names[index];
}
