/// The shapes partition: value types, and the concept the algorithms are
/// written against.

export module geometry:shapes;

import std;

export namespace geometry {

struct point {
  double x = 0;
  double y = 0;

  friend auto operator<=>(const point&, const point&) = default;
  friend point operator+(point a, point b) { return {a.x + b.x, a.y + b.y}; }
  friend point operator-(point a, point b) { return {a.x - b.x, a.y - b.y}; }
  friend point operator*(point a, double k) { return {a.x * k, a.y * k}; }
};

using box = std::pair<point, point>;

/// Twice the signed area of the triangle o, a, b.
double cross(point o, point a, point b);

template <typename S>
concept shape = requires(const S& s) {
  { s.area() } -> std::convertible_to<double>;
  { s.bounds() } -> std::same_as<box>;
  { s.name() } -> std::convertible_to<std::string_view>;
};

class circle {
public:
  circle(point center, double radius) : center_(center), radius_(radius) {}

  double area() const { return std::numbers::pi * radius_ * radius_; }
  box bounds() const {
    return {{center_.x - radius_, center_.y - radius_}, {center_.x + radius_, center_.y + radius_}};
  }
  std::string_view name() const { return "circle"; }
  point center() const { return center_; }

private:
  point center_;
  double radius_;
};

class polygon {
public:
  explicit polygon(std::vector<point> vertices);

  double area() const;
  box bounds() const;
  std::string_view name() const { return "polygon"; }
  std::span<const point> vertices() const { return vertices_; }

private:
  std::vector<point> vertices_;
};

template <std::size_t N>
class regular : public polygon {
public:
  regular(point center, double radius) : polygon(make(center, radius)) {}

private:
  static std::vector<point> make(point center, double radius) {
    std::vector<point> vertices;
    for (std::size_t i = 0; i < N; ++i) {
      double angle = 2 * std::numbers::pi * static_cast<double>(i) / N;
      vertices.push_back(center + point{std::cos(angle), std::sin(angle)} * radius);
    }
    return vertices;
  }
};

using any_shape = std::variant<circle, polygon, regular<6>>;

}  // namespace geometry

template <>
struct std::formatter<geometry::point> {
  constexpr auto parse(std::format_parse_context& ctx) { return ctx.begin(); }
  auto format(const geometry::point& p, std::format_context& ctx) const {
    return std::format_to(ctx.out(), "({:.3f}, {:.3f})", p.x, p.y);
  }
};
