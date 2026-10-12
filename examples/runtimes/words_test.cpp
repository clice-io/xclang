#include <cstdio>
#include <map>
#include <sstream>
#include <string>

int main() {
    std::istringstream text("the runtimes from source are the runtimes of the build");
    std::map<std::string, int> counts;
    for (std::string word; text >> word;) ++counts[word];
    std::string report;
    for (const auto& [word, n] : counts) report += word + " " + std::to_string(n) + "\n";
    // MemorySanitizer checks what printf reads: libc++ wrote it, so libc++
    // must be instrumented too.
    std::printf("%s", report.c_str());
    return counts["runtimes"] == 2 ? 0 : 1;
}
