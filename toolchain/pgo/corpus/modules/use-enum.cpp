/// Enum reflection through the magic_enum module: names, values, flags
/// and containers indexed by enums.

import std;
import magic_enum;

namespace app {

enum class level { trace, debug, info, warning, error, fatal };
enum class permission : std::uint8_t { none = 0, read = 1 << 0, write = 1 << 1, execute = 1 << 2 };
enum class color { red = -2, green = 0, blue = 4, alpha = 16 };

}  // namespace app

template <>
struct magic_enum::customize::enum_range<app::color> {
  static constexpr int min = -8;
  static constexpr int max = 32;
};

template <typename E>
std::string table() {
  std::string out;
  for (auto [value, name] : magic_enum::enum_entries<E>()) {
    out += std::format("{}={} ", name, magic_enum::enum_integer(value));
  }
  return out;
}

int main() {
  using namespace magic_enum::bitwise_operators;
  auto parsed = magic_enum::enum_cast<app::level>("warning");
  auto flags = app::permission::read | app::permission::execute;
  magic_enum::containers::array<app::level, int> counts{};
  for (auto l : magic_enum::enum_values<app::level>()) counts[l] = static_cast<int>(magic_enum::enum_index(l).value_or(0));
  std::println("{} levels: {}", magic_enum::enum_count<app::level>(), table<app::level>());
  std::println("colors: {}", table<app::color>());
  std::println("parsed {}, flags {}, fatal index {}", magic_enum::enum_name(parsed.value_or(app::level::info)),
               magic_enum::enum_flags_name(flags), counts[app::level::fatal]);
  std::println("contains blue: {}", magic_enum::enum_contains<app::color>(4));
}
