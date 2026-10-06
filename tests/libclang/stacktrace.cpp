/// A tool on libclang that crashes on purpose, for the stack trace LLVM's
/// handler prints (tests/libclang.ts), through frames with names (frame_a,
/// frame_b, frame_c) for llvm-symbolizer to show:
///
///   trap      a trap three frames down: the process's crash handler, as in
///             lld or an out-of-process cc1
///   crc       the same inside a CrashRecoveryContext that dumps the stack,
///             as clang's in-process cc1
///   qsort     a trap in qsort's comparator: the C library's frames between
///             the crash and frame_c
///   handler   a trap with a signal handler that prints the stack itself
///             (sys::PrintStackTrace from inside the handler, as clice did)

#include "llvm/Support/CrashRecoveryContext.h"
#include "llvm/Support/InitLLVM.h"
#include "llvm/Support/Signals.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdlib>
#include <cstring>

static const char *Mode = "";

[[gnu::noinline]] static int compare(const void *A, const void *B) {
  __builtin_trap();
  return *static_cast<const int *>(A) - *static_cast<const int *>(B);
}

[[gnu::noinline]] static void frame_c() {
  if (std::strcmp(Mode, "qsort") == 0) {
    int Values[] = {3, 1, 2};
    std::qsort(Values, 3, sizeof(int), compare);
  }
  __builtin_trap();
}

[[gnu::noinline]] static void frame_b() {
  frame_c();
  asm volatile("");
}

[[gnu::noinline]] static void frame_a() {
  frame_b();
  asm volatile("");
}

static void printStack(void *) {
  llvm::errs() << "--- sys::PrintStackTrace from the signal handler\n";
  llvm::sys::PrintStackTrace(llvm::errs());
  llvm::errs() << "--- end of the handler's trace\n";
}

int main(int argc, char **argv) {
  llvm::InitLLVM X(argc, argv);
  if (argc < 2) {
    llvm::errs() << "usage: stacktrace trap|crc|qsort|handler\n";
    return 2;
  }
  Mode = argv[1];
  if (std::strcmp(Mode, "handler") == 0)
    llvm::sys::AddSignalHandler(printStack, nullptr);
  if (std::strcmp(Mode, "crc") == 0) {
    llvm::CrashRecoveryContext::Enable();
    llvm::CrashRecoveryContext CRC;
    CRC.DumpStackAndCleanupOnFailure = true;
    if (!CRC.RunSafely(frame_a))
      llvm::errs() << "crash recovered, code " << CRC.RetCode << "\n";
    return 1;
  }
  frame_a();
  return 0;
}
