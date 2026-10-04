// Exceptions, threads, <filesystem> and <format> (with floating point, which
// needs the library's to_chars).
#include <atomic>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>

int main() {
  try {
    throw std::runtime_error("thrown");
  } catch (const std::exception &e) {
    std::cout << std::format("caught: {}\n", e.what());
  }
  std::atomic<int> sum{0};
  {
    std::vector<std::jthread> threads;
    for (int i = 1; i <= 4; ++i) threads.emplace_back([&sum, i] { sum += i; });
  }
  namespace fs = std::filesystem;
  fs::path dir = fs::temp_directory_path() / "xclang-sdk-probe";
  fs::create_directories(dir);
  std::ofstream(dir / "f.txt") << "12345";
  auto size = fs::file_size(dir / "f.txt");
  fs::remove_all(dir);
  std::cout << std::format("threads: {}, file size: {}, pi: {:.3f}\n", sum.load(), size, 3.14159);
  return sum == 10 && size == 5 ? 0 : 1;
}
