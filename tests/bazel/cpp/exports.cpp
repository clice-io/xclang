// An inline variable is a weak definition, which a macOS program exports
// for dyld to coalesce unless it is linked with -no_exported_symbols
// (tests/bazel/bazel.ts). One the program writes stays exported at -O2,
// where a function whose address nothing takes may be hidden instead.
inline int calls = 0;

int main(int argc, char**) {
  calls += argc;
  return calls == 1 ? 0 : 1;
}
