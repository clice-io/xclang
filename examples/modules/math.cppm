export module math;

export import :ops;
import std;

export std::string describe(std::string_view name, std::span<const int> sides) {
    return std::format("{}: {} sides, perimeter {}", name, sides.size(), perimeter(sides));
}
