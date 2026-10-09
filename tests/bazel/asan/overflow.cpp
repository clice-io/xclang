#include <cstdio>
#include <string>

int main(int argc, char**) {
    std::string s(40, 'x');
    s.reserve(100);
    // Past size(), within capacity(): only an instrumented libc++ annotates it.
    volatile char c = s.data()[40 + argc];
    (void)c;
    std::puts("no report");
}
