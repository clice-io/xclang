/// The implementation unit of geometry.

module geometry;

import std;
import :detail;

namespace geometry {

double cross(point o, point a, point b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

polygon::polygon(std::vector<point> vertices) : vertices_(std::move(vertices)) {
  if (vertices_.size() < 3) throw std::invalid_argument(std::format("a polygon needs 3 vertices, not {}", vertices_.size()));
}

double polygon::area() const {
  double twice = 0;
  for (std::size_t i = 0; i < vertices_.size(); ++i) {
    const point& a = vertices_[i];
    const point& b = vertices_[(i + 1) % vertices_.size()];
    twice += a.x * b.y - b.x * a.y;
  }
  return std::abs(twice) / 2;
}

box polygon::bounds() const {
  box result{vertices_.front(), vertices_.front()};
  for (const point& p : vertices_) result = detail::merge(result, {p, p});
  return result;
}

double total_area(std::span<const any_shape> shapes) {
  return detail::sum_by(shapes, [](const any_shape& s) { return std::visit([](const auto& v) { return v.area(); }, s); });
}

box bounds(std::span<const any_shape> shapes) {
  if (shapes.empty()) return {};
  auto of = [](const any_shape& s) { return std::visit([](const auto& v) { return v.bounds(); }, s); };
  box result = of(shapes.front());
  for (const any_shape& s : shapes.subspan(1)) result = detail::merge(result, of(s));
  return result;
}

std::vector<point> convex_hull(std::vector<point> points) {
  std::ranges::sort(points);
  auto [first, last] = std::ranges::unique(points);
  points.erase(first, last);
  if (points.size() < 3) return points;
  std::vector<point> hull(2 * points.size());
  std::size_t k = 0;
  for (const point& p : points) {
    while (k >= 2 && cross(hull[k - 2], hull[k - 1], p) <= 0) --k;
    hull[k++] = p;
  }
  for (std::size_t i = points.size() - 1, t = k + 1; i > 0; --i) {
    while (k >= t && cross(hull[k - 2], hull[k - 1], points[i - 1]) <= 0) --k;
    hull[k++] = points[i - 1];
  }
  hull.resize(k - 1);
  return hull;
}

std::map<std::string, std::size_t, std::less<>> histogram(std::span<const any_shape> shapes) {
  std::map<std::string, std::size_t, std::less<>> counts;
  for (const any_shape& s : shapes) ++counts[std::string(std::visit([](const auto& v) { return v.name(); }, s))];
  return counts;
}

}  // namespace geometry
