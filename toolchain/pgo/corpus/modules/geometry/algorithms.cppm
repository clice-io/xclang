/// The algorithms partition: templates importers instantiate, and
/// functions the implementation unit defines.

export module geometry:algorithms;

import std;
import :shapes;

export namespace geometry {

template <shape S>
double total_area(std::span<const S> shapes) {
  return std::ranges::fold_left(shapes | std::views::transform(&S::area), 0.0, std::plus<>{});
}

double total_area(std::span<const any_shape> shapes);
box bounds(std::span<const any_shape> shapes);
std::vector<point> convex_hull(std::vector<point> points);
std::map<std::string, std::size_t, std::less<>> histogram(std::span<const any_shape> shapes);

template <shape... S>
std::string describe(const S&... shapes) {
  std::string out;
  ((out += std::format("{}({:.2f}) ", shapes.name(), shapes.area())), ...);
  return out;
}

template <shape S, typename Pred>
auto largest_if(std::span<const S> shapes, Pred pred) -> std::optional<std::reference_wrapper<const S>> {
  auto matching = shapes | std::views::filter(pred);
  auto it = std::ranges::max_element(matching, {}, &S::area);
  if (it == matching.end()) return std::nullopt;
  return std::cref(*it);
}

}  // namespace geometry
