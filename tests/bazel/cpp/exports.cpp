// A template instantiated here is a weak definition, which a macOS program
// exports for dyld to coalesce unless it is linked with
// -no_exported_symbols (tests/bazel/bazel.ts).
template <class T>
[[gnu::noinline]] T twice(T x) {
  return x + x;
}

int main(int argc, char**) { return twice(argc) == 2 ? 0 : 1; }
