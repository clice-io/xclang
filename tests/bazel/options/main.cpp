// Counts the options of each table of llvm-option-inc, as a tool reading those
// command lines without LLVM does.
#include <cstdio>

#define OPTION(...) ++count;

int main() {
  struct Table {
    const char* name;
    int count;
    int minimum;
  };
  Table tables[] = {
      {"clang", [] { int count = 0;
#include <llvm-options-td/clang-Driver-Options.inc>
        return count; }(), 1000},
      {"lld ELF", [] { int count = 0;
#include <llvm-options-td/lld-ELF-Options.inc>
        return count; }(), 100},
      {"lld COFF", [] { int count = 0;
#include <llvm-options-td/lld-COFF-Options.inc>
        return count; }(), 100},
      {"lld MachO", [] { int count = 0;
#include <llvm-options-td/lld-MachO-Options.inc>
        return count; }(), 100},
      {"lld MinGW", [] { int count = 0;
#include <llvm-options-td/lld-MinGW-Options.inc>
        return count; }(), 50},
      {"lld wasm", [] { int count = 0;
#include <llvm-options-td/lld-wasm-Options.inc>
        return count; }(), 50},
      {"llvm-lib", [] { int count = 0;
#include <llvm-options-td/llvm-lib-Options.inc>
        return count; }(), 10},
      {"llvm-dlltool", [] { int count = 0;
#include <llvm-options-td/llvm-dlltool-Options.inc>
        return count; }(), 5},
  };
  int failed = 0;
  for (const Table& t : tables) {
    std::printf("%s: %d options\n", t.name, t.count);
    failed += t.count < t.minimum;
  }
  return failed;
}
