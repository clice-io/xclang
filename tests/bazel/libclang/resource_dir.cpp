// The resource directory clang finds next to this program, as a tool on
// libclang finds it: <bindir>/../lib/clang/<major>, with clang's headers.
#include "clang/Options/OptionUtils.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/raw_ostream.h"

int main(int, char** argv) {
  std::string dir = clang::GetResourcesPath(argv[0], reinterpret_cast<void*>(&main));
  llvm::SmallString<256> stddef(dir);
  llvm::sys::path::append(stddef, "include", "stddef.h");
  bool found = llvm::sys::fs::exists(stddef);
  llvm::outs() << stddef << (found ? "" : ": not found") << "\n";
  return found ? 0 : 1;
}
