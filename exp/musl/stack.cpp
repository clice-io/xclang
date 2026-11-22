// Experiment (exp/musl-hosts only): clang in-process, as clice runs it, on
// the main thread and on a std::thread of the default size: a template
// instantiated 900 levels deep, whose recursion in Sema needs more than
// musl's 128 KiB of thread stack.
#include "clang/Frontend/FrontendActions.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/raw_ostream.h"
#include <pthread.h>
#include <thread>

static const char *code =
    "template <int N> struct R { static constexpr int v = R<N - 1>::v + 1; };"
    "template <> struct R<0> { static constexpr int v = 0; };"
    "static_assert(R<900>::v == 900);";

static bool parse() {
  return clang::tooling::runToolOnCodeWithArgs(std::make_unique<clang::SyntaxOnlyAction>(), code,
                                               {"-ftemplate-depth=2000"}, "input.cpp");
}

int main(int argc, char **argv) {
  pthread_attr_t attr;
  size_t size = 0;
  pthread_attr_init(&attr);
  pthread_attr_getstacksize(&attr, &size);
  llvm::outs() << "default thread stack " << size / 1024 << " KiB\n";
  llvm::outs() << "main thread: " << (parse() ? "ok" : "failed") << "\n";
  llvm::outs().flush();
  bool ok = false;
  std::thread([&] { ok = parse(); }).join();
  llvm::outs() << "std::thread: " << (ok ? "ok" : "failed") << "\n";
  return ok ? 0 : 1;
}
