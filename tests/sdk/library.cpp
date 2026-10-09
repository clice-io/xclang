// The C++ library a program was built with.
#include <cstdio>
#include <version>

int main() {
#if defined(_LIBCPP_VERSION)
  std::printf("library: libc++ %d\n", _LIBCPP_VERSION);
#elif defined(_MSVC_STL_VERSION)
  std::printf("library: msvc-stl %d\n", _MSVC_STL_VERSION);
#else
  std::printf("library: unknown\n");
#endif
}
