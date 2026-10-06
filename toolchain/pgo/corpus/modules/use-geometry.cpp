/// A program on the geometry module: its partitions, templates
/// instantiated here, and the std module.

import std;
import geometry;

int main() {
  using namespace geometry;
  std::vector<any_shape> shapes;
  std::mt19937 rng(42);
  std::uniform_real_distribution<double> coord(-10, 10), size(0.5, 3);
  for (int i = 0; i < 64; ++i) {
    point c{coord(rng), coord(rng)};
    switch (i % 3) {
      case 0: shapes.emplace_back(circle(c, size(rng))); break;
      case 1: shapes.emplace_back(regular<6>(c, size(rng))); break;
      default: shapes.emplace_back(polygon({c, c + point{size(rng), 0}, c + point{0, size(rng)}})); break;
    }
  }
  std::vector<point> cloud;
  for (int i = 0; i < 500; ++i) cloud.push_back({coord(rng), coord(rng)});
  auto hull = convex_hull(cloud);
  std::vector<circle> circles{{{0, 0}, 1}, {{3, 3}, 2}, {{-1, 4}, 0.5}};
  auto big = largest_if(std::span<const circle>(circles), [](const circle& c) { return c.center().x >= 0; });
  auto [lo, hi] = bounds(shapes);
  std::println("area {:.2f}, circles {:.2f}, hull of {} points, bounds {} {}", total_area(shapes),
               total_area(std::span<const circle>(circles)), hull.size(), lo, hi);
  std::println("{}", describe(circles[0], regular<6>({0, 0}, 1), polygon({{0, 0}, {1, 0}, {0, 1}})));
  for (const auto& [name, count] : histogram(shapes)) std::println("{}: {}", name, count);
  if (big) std::println("largest circle on the right: {:.2f}", big->get().area());
}
