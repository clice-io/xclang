/// An internal partition: shared by the implementation, exported by
/// nothing.

module geometry:detail;

import std;
import :shapes;

namespace geometry::detail {

inline box merge(const box& a, const box& b) {
  return {{std::min(a.first.x, b.first.x), std::min(a.first.y, b.first.y)},
          {std::max(a.second.x, b.second.x), std::max(a.second.y, b.second.y)}};
}

template <std::ranges::input_range R, typename F>
double sum_by(R&& range, F f) {
  double total = 0;
  for (auto&& element : range) total += std::invoke(f, element);
  return total;
}

}  // namespace geometry::detail
