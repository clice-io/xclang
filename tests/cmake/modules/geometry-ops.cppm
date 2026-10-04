export module geometry:ops;

import std;
import :shapes;

export int perimeter(const Shape& shape) { return std::accumulate(shape.sides.begin(), shape.sides.end(), 0); }

export std::string describe(const Shape& shape) {
  return std::format("{}: {} sides, perimeter {}", shape.name, shape.sides.size(), perimeter(shape));
}
