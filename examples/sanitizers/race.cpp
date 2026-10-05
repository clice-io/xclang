#include <thread>

int shared;

int main() {
    std::thread t([] { shared++; });
    shared++;
    t.join();
}
