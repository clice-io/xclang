/// The names a Windows toolchain gives its one program, llvm.exe (clang,
/// clang++, ld.lld, llvm-ar, llvm-ranlib, ...), without a copy of it for
/// each: Windows makes links only with extra rights, and conda packages
/// cannot carry hard links. Every name is a copy of this small program,
/// which starts llvm.exe next to it as `llvm <name> <arguments>`.
///
/// The name goes in as a subcommand, not as argv[0]: on Windows, LLVM
/// replaces the file name in argv[0] with its own module's (llvm.exe)
/// before anything reads it. As a subcommand it reaches the tool as its
/// argv[0], which is what the tools tell their mode from (clang++ is the
/// g++ driver, ld.lld the ELF linker, llvm-ranlib is ranlib).

#include <windows.h>

static void fail(const char *what) {
  DWORD written;
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), what, lstrlenA(what), &written, NULL);
  ExitProcess(127);
}

/// The command line after its first argument, which Windows ends at the
/// closing quote when it starts with one, else at the first blank.
static const wchar_t *after_program(const wchar_t *line) {
  if (*line == L'"') {
    for (++line; *line && *line != L'"'; ++line) {}
    return *line ? line + 1 : line;
  }
  while (*line && *line != L' ' && *line != L'\t') ++line;
  return line;
}

int wmain(void) {
  enum { CAPACITY = 32768 };
  static wchar_t self[CAPACITY], program[CAPACITY], line[CAPACITY];
  DWORD length = GetModuleFileNameW(NULL, self, CAPACITY);
  if (length == 0 || length >= CAPACITY) fail("xclang alias: cannot find itself\n");

  /// self = <dir>\<name>.exe
  wchar_t *name = self;
  for (wchar_t *p = self; *p; ++p)
    if (*p == L'\\' || *p == L'/') name = p + 1;
  wchar_t *dot = NULL;
  for (wchar_t *p = name; *p; ++p)
    if (*p == L'.') dot = p;
  if (dot && lstrcmpiW(dot, L".exe") == 0) *dot = 0;

  const wchar_t *rest = after_program(GetCommandLineW());
  if ((name - self) + lstrlenW(name) + lstrlenW(rest) + 16 >= CAPACITY) fail("xclang alias: command line too long\n");
  lstrcpynW(program, self, (int)(name - self) + 1);
  lstrcatW(program, L"llvm.exe");
  lstrcpyW(line, L"\"");
  lstrcatW(line, program);
  lstrcatW(line, L"\" ");
  lstrcatW(line, name);
  lstrcatW(line, rest);

  /// The child dies with this process: a build tool that kills the alias
  /// on a timeout kills the compiler too. It is born in the job: a child
  /// made suspended and assigned afterwards stays suspended forever,
  /// outside any job, when a kill lands in between. Where the job cannot
  /// be had (no job list before Windows 10, a job the kernel will not nest
  /// in), the child starts without it.
  HANDLE job = CreateJobObjectW(NULL, NULL);
  LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &size);
    attributes = HeapAlloc(GetProcessHeap(), 0, size);
    if (attributes && !(InitializeProcThreadAttributeList(attributes, 1, 0, &size) &&
                        UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job,
                                                  sizeof(job), NULL, NULL)))
      attributes = NULL;
  }
  /// Ctrl-C reaches the child through the shared console; this process
  /// only waits for it.
  SetConsoleCtrlHandler(NULL, TRUE);

  STARTUPINFOEXW startup = {0};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION process;
  BOOL started = attributes && CreateProcessW(program, line, NULL, NULL, TRUE, EXTENDED_STARTUPINFO_PRESENT,
                                              NULL, NULL, &startup.StartupInfo, &process);
  if (!started) {
    startup.StartupInfo.cb = sizeof(startup.StartupInfo);
    started = CreateProcessW(program, line, NULL, NULL, TRUE, 0, NULL, NULL, &startup.StartupInfo, &process);
  }
  if (!started) fail("xclang alias: cannot start llvm.exe\n");
  CloseHandle(process.hThread);

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(process.hProcess, &code);
  return (int)code;
}
