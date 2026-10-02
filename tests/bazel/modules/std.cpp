import std;
import std.compat;
import shapes;

int main() {
  std::vector<int> sides{5, 3, 4};
  std::ranges::sort(sides);
  std::string text = describe(sides);
  std::cout << std::format("{} {} {}: {}\n", sides[0], sides[1], sides[2], text);
  printf("from std.compat\n");
  return text == "3 sides, perimeter 12" && sides == std::vector<int>{3, 4, 5} ? 0 : 1;
}
