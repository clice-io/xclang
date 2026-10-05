#include <cstdio>

extern "C" [[gnu::noinline]] int answer(int x) { return x * 6 + 36; }

int main(int argc, char**) { std::printf("%d\n", answer(argc)); }
