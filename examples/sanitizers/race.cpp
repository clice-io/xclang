#include <chrono>
#include <thread>

int shared;

int main() {
    std::thread t([] { shared++; });
    // The thread's write first, then the main thread's, which races with
    // it: in this order TSan reports the race every time.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    shared++;
    t.join();
}
