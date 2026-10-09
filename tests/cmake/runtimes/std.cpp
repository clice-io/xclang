import std;

// A function of the program on the module's types: its name has their
// inline namespace.
[[gnu::noinline, gnu::used]] void add(std::vector<std::string>& words, std::string_view word) {
  words.emplace_back(word);
}

int main() {
  std::vector<std::string> words{"import", "std"};
  add(words, "of the variant");
  std::printf("%zu elements\n", words.size());
}
