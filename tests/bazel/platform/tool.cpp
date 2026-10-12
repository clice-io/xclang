#include <fstream>
#include <string>

int main(int, char** argv) {
  std::string text = "generated";
  std::ofstream(argv[1]) << text << '\n';
}
