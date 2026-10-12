#include <chrono>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cxxabi.h>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

int shared;
void* volatile sink;

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
  // libc++abi's demangler, by its header.
  int status = 0;
  char* name = abi::__cxa_demangle("_Z1fv", nullptr, nullptr, &status);
  std::printf("demangled: %s\n", status == 0 ? name : "?");
  std::free(name);
  std::fflush(stdout);
  const char* mode = argc > 1 ? argv[1] : "";
  if (std::strcmp(mode, "oob") == 0) {
    std::vector<int> v(3);
    std::printf("read %d\n", v[argc + 5]);
  }
  if (std::strcmp(mode, "uninitialized") == 0) {
    char* text = new char[8];
    std::istringstream in(std::string(text, 8));
    int value = 0;
    in >> value;
    std::printf("parsed %d\n", value);
  }
  // Past size(), within capacity(): a container-overflow that only an
  // instrumented libc++ annotates (AddressSanitizer).
  if (std::strcmp(mode, "overflow") == 0) {
    std::string s(40, 'x');
    s.reserve(100);
    volatile char c = s.data()[40 + argc];
    (void)c;
  }
  // UBSan.
  if (std::strcmp(mode, "signed") == 0) {
    int n = INT_MAX;
    n += argc;
    std::printf("sum %d\n", n);
  }
  // ThreadSanitizer: the thread's write first, which the main thread's
  // then races with (the other way round, TSan misses it now and then on
  // arm64 Linux).
  if (std::strcmp(mode, "race") == 0) {
    std::thread t([] { shared++; });
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    shared++;
    t.join();
  }
  // LeakSanitizer.
  if (std::strcmp(mode, "leak") == 0) {
    sink = std::malloc(64);
    sink = nullptr;
  }
}
