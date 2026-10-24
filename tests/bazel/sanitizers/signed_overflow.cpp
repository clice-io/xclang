#include <climits>
#include <cstdio>

int main(int argc, char**) {
    int n = INT_MAX;
    // A signed overflow, which UBSan reports.
    n += argc;
    std::printf("%d\n", n);
}
