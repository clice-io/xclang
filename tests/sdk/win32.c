#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

static DWORD WINAPI worker(LPVOID arg) {
  *(LONG *)arg = 42;
  return 0;
}

int main(void) {
  WCHAR name[MAX_COMPUTERNAME_LENGTH + 1];
  DWORD n = MAX_COMPUTERNAME_LENGTH + 1;
  if (!GetComputerNameW(name, &n)) return 1;
  SYSTEM_INFO si;
  GetNativeSystemInfo(&si);
  LONG value = 0;
  HANDLE t = CreateThread(NULL, 0, worker, &value, 0, NULL);
  WaitForSingleObject(t, INFINITE);
  CloseHandle(t);
  WCHAR upper[] = L"user32";
  CharUpperW(upper);
  WCHAR user[256];
  DWORD un = 256;
  BOOL got_user = GetUserNameW(user, &un);
  printf("computer: %ls, arch: %u, thread: %ld, %ls, user: %s\n", name,
         (unsigned)si.wProcessorArchitecture, value, upper, got_user ? "yes" : "no");
  return value == 42 ? 0 : 1;
}
