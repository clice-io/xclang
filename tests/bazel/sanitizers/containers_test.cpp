#include <cstdio>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

int main() {
    std::vector<std::string> words;
    std::thread worker([&] {
        for (int i = 0; i < 100; ++i) words.push_back(std::string(i, 'x'));
    });
    worker.join();
    try {
        throw std::runtime_error(std::to_string(words.size()) + " words");
    } catch (const std::exception& e) {
        std::puts(e.what());
    }
    return words.size() == 100 ? 0 : 1;
}
