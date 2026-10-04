import std;
import std.compat;

int main() {
  std::vector<int> sides{5, 3, 4};
  std::ranges::sort(sides);
  std::string caught;
  try {
    throw std::runtime_error(std::to_string(7));
  } catch (const std::exception& e) {
    caught = e.what();
  }
  std::println("{} {} {}: {} sides, caught {}", sides[0], sides[1], sides[2], sides.size(), caught);
  printf("from std.compat\n");
  return sides == std::vector<int>{3, 4, 5} && caught == "7" ? 0 : 1;
}
