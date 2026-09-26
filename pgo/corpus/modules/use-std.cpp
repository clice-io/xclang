/// A program on `import std;`: the standard library as a C++20 module,
/// precompiled from libc++'s std.cppm.

import std;

template <typename T>
concept Summable = requires(T a, T b) { a + b; };

template <Summable T>
auto total(const std::vector<T>& values) {
  return std::ranges::fold_left(values, T{}, std::plus<>{});
}

int main() {
  std::map<std::string, std::vector<int>> groups;
  for (int i = 0; i < 100; ++i) groups[std::format("g{}", i % 7)].push_back(i);
  auto sizes = groups | std::views::transform([](const auto& g) { return g.second.size(); });
  std::vector<std::size_t> counts(sizes.begin(), sizes.end());
  std::optional<int> best;
  for (const auto& [name, values] : groups) {
    if (!best || total(values) > *best) best = total(values);
  }
  std::println("{} groups, largest sum {}, sizes {}", groups.size(), best.value_or(0), counts);
}
