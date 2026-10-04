import std;

#ifdef __cpp_exceptions
#error "compiled with exceptions"
#endif

int main() {
  std::vector<int> values{1, 2, 3};
  std::println("no exceptions: {}", std::ranges::fold_left(values, 0, std::plus{}));
}
