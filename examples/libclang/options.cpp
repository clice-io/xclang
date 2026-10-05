#include <cstdio>

int main() {
    int count = 0;
#define OPTION(...) ++count;
#include <llvm-options-td/clang-Driver-Options.inc>
#undef OPTION
    std::printf("clang has %d options\n", count);
}
