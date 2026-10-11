#include <iostream>
#include <stdexcept>

int main() {
  try {
    throw std::runtime_error("thrown");
  } catch (const std::exception& e) {
#if defined(_LIBCPP_VERSION)
    std::cout << "libc++ " << _LIBCPP_VERSION << " " << e.what() << std::endl;
#elif defined(__GLIBCXX__)
    std::cout << "libstdc++ " << e.what() << std::endl;
#elif defined(_MSVC_STL_VERSION)
    std::cout << "msvc-stl " << e.what() << std::endl;
#endif
  }
}
