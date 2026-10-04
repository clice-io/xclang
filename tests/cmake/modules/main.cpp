import std;
import geometry;

int main() {
  Shape triangle{"triangle", {3, 4, 5}};
  std::string text = describe(triangle);
  std::println("{}", text);
  return text == "triangle: 3 sides, perimeter 12" ? 0 : 1;
}
