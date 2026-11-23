/// Experiment (exp/mimalloc-hosts only): run a command and write its peak
/// memory, in KiB, to the file $PEAK_OUT; the command's exit status is this
/// program's. POSIX: the largest resident set of the command and the
/// processes it waited for (wait4). Windows: the command's peak working
/// set (it should be the program itself, llvm.exe, not a launcher).
///
///   PEAK_OUT=<file> peak <program> <arguments>...

#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>

/// The command line after its first argument (toolchain/launcher/alias.c).
static wchar_t *after_program(wchar_t *line) {
  if (*line == L'"') {
    for (++line; *line && *line != L'"'; ++line) {}
    if (*line) ++line;
  } else {
    while (*line && *line != L' ' && *line != L'\t') ++line;
  }
  while (*line == L' ' || *line == L'\t') ++line;
  return line;
}

int wmain(void) {
  wchar_t *command = after_program(GetCommandLineW());
  STARTUPINFOW si = {sizeof si};
  PROCESS_INFORMATION pi;
  if (!CreateProcessW(NULL, command, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "peak: cannot start %ls (%lu)\n", command, GetLastError());
    return 127;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD status = 1;
  GetExitCodeProcess(pi.hProcess, &status);
  PROCESS_MEMORY_COUNTERS counters = {sizeof counters};
  K32GetProcessMemoryInfo(pi.hProcess, &counters, sizeof counters);
  unsigned long long kib = counters.PeakWorkingSetSize / 1024;
#else
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) return 127;
  pid_t pid = fork();
  if (pid == 0) {
    execvp(argv[1], argv + 1);
    perror("peak: exec");
    _exit(127);
  }
  int wstatus = 0;
  struct rusage usage;
  if (pid < 0 || wait4(pid, &wstatus, 0, &usage) < 0) return 127;
  int status = WIFEXITED(wstatus) ? WEXITSTATUS(wstatus) : 128 + WTERMSIG(wstatus);
#ifdef __APPLE__
  unsigned long long kib = (unsigned long long)usage.ru_maxrss / 1024;
#else
  unsigned long long kib = (unsigned long long)usage.ru_maxrss;
#endif
#endif
  const char *out = getenv("PEAK_OUT");
  FILE *f = out ? fopen(out, "w") : NULL;
  if (f) {
    fprintf(f, "%llu\n", kib);
    fclose(f);
  }
  return (int)status;
}
