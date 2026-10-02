export module shapes;

import std;

export std::string describe(std::span<const int> sides) {
  return std::format("{} sides, perimeter {}", sides.size(), std::accumulate(sides.begin(), sides.end(), 0));
}
