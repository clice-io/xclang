// The same code twice, which identical code folding merges (hello_icf).
#include <cstdio>

[[gnu::noinline]] int twin_a(int x) { return x * 3 + 1; }
[[gnu::noinline]] int twin_b(int x) { return x * 3 + 1; }

int main(int argc, char**) {
  std::printf("twins %d\n", twin_a(argc) + twin_b(argc));
  return 0;
}
