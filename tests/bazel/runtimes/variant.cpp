#include <cstdio>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
#ifdef __cpp_exceptions
  constexpr int exceptions = 1;
#else
  constexpr int exceptions = 0;
#endif
  std::printf("namespace %s hardening %d exceptions %d\n", _LIBCPP_TOSTRING(_LIBCPP_ABI_NAMESPACE), _LIBCPP_HARDENING_MODE,
              exceptions);
  // Written by libc++'s own code, in the library.
  std::ostringstream out;
  out << 42 << ' ' << 3.5;
  std::printf("stream: %s\n", out.str().c_str());
  std::fflush(stdout);
  if (argc > 1 && std::strcmp(argv[1], "oob") == 0) {
    std::vector<int> v(3);
    std::printf("read %d\n", v[argc + 5]);
  }
  if (argc > 1 && std::strcmp(argv[1], "uninitialized") == 0) {
    char* text = new char[8];
    std::istringstream in(std::string(text, 8));
    int value = 0;
    in >> value;
    std::printf("parsed %d\n", value);
  }
}
