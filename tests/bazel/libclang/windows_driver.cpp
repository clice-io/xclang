// Looks for Visual Studio through its Setup API, as clang's driver does for
// an MSVC target (llvm/WindowsDriver, patches/0004): COM code that, on the
// MinGW targets, links oleaut32, which LLVMWindowsDriver's link interface
// leaves to CMake's default libraries (packages/bazel/bazel/libclang.bzl).
// What it finds is the smoke test's to check; elsewhere it finds nothing.
#include "llvm/Support/VirtualFileSystem.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/WindowsDriver/MSVCPaths.h"

#include <optional>
#include <string>

int main() {
  std::string path;
  llvm::ToolsetLayout layout;
  bool found = llvm::findVCToolChainViaSetupConfig(*llvm::vfs::getRealFileSystem(), std::nullopt, path, layout);
  llvm::outs() << "Visual Studio's VC tools: " << (found ? path : "none") << "\n";
  return 0;
}
