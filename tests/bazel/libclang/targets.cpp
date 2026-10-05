// Registers every target's MC layer, as libclang has it (the targets,
// assembly parsers and disassemblers its headers list), as a tool that infers
// a target from a compiler's name does, and looks targets up by triple.
#include "llvm/MC/MCRegisterInfo.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/TargetParser/Triple.h"

#include <cstring>
#include <iterator>
#include <memory>
#include <string>

int main() {
  llvm::InitializeAllTargetInfos();
  llvm::InitializeAllTargetMCs();
  llvm::InitializeAllAsmParsers();
  llvm::InitializeAllDisassemblers();
  auto targets = llvm::TargetRegistry::targets();
  llvm::outs() << "targets " << std::distance(targets.begin(), targets.end()) << "\n";
  struct {
    const char *triple, *name;
  } cases[] = {
      {"aarch64-linux-gnu", "aarch64"},
      {"arm-none-eabi", "arm"},
      {"riscv64-unknown-elf", "riscv64"},
      {"x86_64-w64-windows-gnu", "x86-64"},
  };
  int status = 0;
  for (const auto &c : cases) {
    std::string error;
    const llvm::Target *target = llvm::TargetRegistry::lookupTarget(llvm::Triple(c.triple), error);
    if (!target) {
      llvm::outs() << c.triple << ": " << error << "\n";
      status = 1;
      continue;
    }
    // The MC descriptions (registers, the assembler backend) and the parser.
    std::unique_ptr<llvm::MCRegisterInfo> registers(target->createMCRegInfo(llvm::Triple(c.triple)));
    bool mc = registers && target->hasMCAsmBackend() && target->hasMCAsmParser();
    llvm::outs() << c.triple << " " << target->getName() << (mc ? " mc asm-parser" : "") << "\n";
    if (std::strcmp(target->getName(), c.name) != 0 || !mc) status = 1;
  }
  return status;
}
