#include <cstdio>
#include <format>
#include <stdexcept>
#include <string>

#ifndef _LIBCPP_VERSION
#error "crates' C++ code is compiled with xclang's libc++"
#endif

// An exception thrown and caught, and std::format: libc++ and its ABI
// library, and the unwinder, linked in.
extern "C" int probe_cpp(char* buffer, int size) {
    try {
        throw std::runtime_error(std::format("C++{}", __cplusplus / 100 % 100));
    } catch (const std::exception& e) {
        return std::snprintf(buffer, static_cast<size_t>(size), "%s", std::string(e.what()).c_str());
    }
}
