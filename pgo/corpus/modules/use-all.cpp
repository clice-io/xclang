/// One translation unit importing every module of the corpus, and
/// std.compat's global names.

import std.compat;
import nlohmann.json;
import magic_enum;
import geometry;

enum class kind { circle, polygon, hexagon };

int main(int argc, char** argv) {
  nlohmann::json doc = nlohmann::json::array();
  std::vector<geometry::any_shape> shapes{geometry::circle({0, 0}, 1), geometry::regular<6>({2, 2}, 1)};
  for (const auto& s : shapes) {
    auto k = static_cast<kind>(s.index());
    doc.push_back({{"kind", magic_enum::enum_name(k)},
                   {"area", std::visit([](const auto& v) { return v.area(); }, s)}});
  }
  printf("%s %zu %d\n", doc.dump().c_str(), strlen(argv[0]), argc);
  std::println("{}", geometry::total_area(shapes));
}
