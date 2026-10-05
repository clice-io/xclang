#include <cstdio>

[[gnu::noinline]] static int greet(const char* name) { return std::printf("hello %s\n", name); }

// The same code twice, which identical code folding merges (hello_icf).
[[gnu::noinline]] int twin_a(int x) { return x * 3 + 1; }
[[gnu::noinline]] int twin_b(int x) { return x * 3 + 1; }

int main(int argc, char**) { return greet("symbols") > 0 && twin_a(argc) == twin_b(argc) ? 0 : 1; }
