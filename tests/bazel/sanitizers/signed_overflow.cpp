#include <climits>
#include <cstdio>

int main(int argc, char**) {
    int n = INT_MAX;
    // A signed overflow: UBSan reports it, and the program goes on.
    n += argc;
    std::printf("%d\n", n);
}
