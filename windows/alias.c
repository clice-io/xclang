/// The programs a Windows toolchain names twice (clang++ for clang, ld.lld
/// for lld, llvm-ranlib for llvm-ar, ...), without a second copy of each:
/// Windows makes symlinks only with extra rights, and conda packages
/// cannot carry hard links. Every alias is a copy of this small program,
/// which starts the real one with the command line it was given, argv[0]
/// included. LLVM's tools tell what they are asked to be from argv[0]
/// (clang++ is the g++ driver, ld.lld the ELF linker), and find their
/// installation from their own module path, so the real program behaves
/// exactly as if it had been started under the alias's name.
///
/// ALIASES (aliases.h, written by scripts/toolchain.ts) pairs each alias
/// with the program it stands for, both without .exe.

#include <windows.h>

#include "aliases.h"

static void fail(const char *what) {
  DWORD written;
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), what, lstrlenA(what), &written, NULL);
  ExitProcess(127);
}

int wmain(void) {
  wchar_t self[MAX_PATH * 4];
  DWORD length = GetModuleFileNameW(NULL, self, sizeof(self) / sizeof(self[0]));
  if (length == 0 || length >= sizeof(self) / sizeof(self[0])) fail("xclang alias: cannot find itself\n");

  /// self = <dir>\<name>.exe; the table is looked up by <name>.
  wchar_t *name = self;
  for (wchar_t *p = self; *p; ++p)
    if (*p == L'\\' || *p == L'/') name = p + 1;
  wchar_t *dot = NULL;
  for (wchar_t *p = name; *p; ++p)
    if (*p == L'.') dot = p;
  if (dot) *dot = 0;

  const wchar_t *target = NULL;
  for (size_t i = 0; i < sizeof(ALIASES) / sizeof(ALIASES[0]); ++i)
    if (lstrcmpiW(name, ALIASES[i][0]) == 0) target = ALIASES[i][1];
  if (!target) fail("xclang alias: not an alias of anything\n");

  wchar_t program[MAX_PATH * 4];
  lstrcpynW(program, self, (int)(name - self) + 1);
  if (lstrlenW(program) + lstrlenW(target) + 5 > (int)(sizeof(program) / sizeof(program[0])))
    fail("xclang alias: path too long\n");
  lstrcatW(program, target);
  lstrcatW(program, L".exe");

  /// The child dies with this process: a build tool that kills the alias
  /// on a timeout kills the compiler too.
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
  }
  /// Ctrl-C reaches the child through the shared console; this process
  /// only waits for it.
  SetConsoleCtrlHandler(NULL, TRUE);

  STARTUPINFOW startup = {0};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process;
  if (!CreateProcessW(program, GetCommandLineW(), NULL, NULL, TRUE, CREATE_SUSPENDED, NULL, NULL,
                      &startup, &process))
    fail("xclang alias: cannot start the program it stands for\n");
  if (job) AssignProcessToJobObject(job, process.hProcess);
  ResumeThread(process.hThread);
  CloseHandle(process.hThread);

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(process.hProcess, &code);
  return (int)code;
}
