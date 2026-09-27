// The Visual Studio lookup of llvm/lib/WindowsDriver/MSVCPaths.cpp
// (findVCToolChainViaSetupConfig), as patched to build with mingw-w64:
// prints the newest instance's VC directory.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <comdef.h>
#include <cstdio>
#include <optional>
#include <string>
#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnon-virtual-dtor"
#endif
#include "MSVCSetupApi.h"
#ifdef __clang__
#pragma clang diagnostic pop
#endif
#ifdef __MINGW32__
__CRT_UUID_DECL(ISetupInstance, 0xB41463C3, 0x8866, 0x43B5, 0xBC, 0x33, 0x2B, 0x06, 0x76, 0xF7, 0xF4, 0x2E)
__CRT_UUID_DECL(ISetupInstance2, 0x89143C9A, 0x05AF, 0x49B0, 0xB7, 0x17, 0x72, 0xE2, 0x18, 0xA2, 0x18, 0x5C)
__CRT_UUID_DECL(IEnumSetupInstances, 0x6380BCFF, 0x41D3, 0x4B2E, 0x8B, 0x2E, 0xBF, 0x8A, 0x68, 0x10, 0xC8, 0x48)
__CRT_UUID_DECL(ISetupConfiguration, 0x42843719, 0xDB4C, 0x46C2, 0x8E, 0x7C, 0x64, 0xF1, 0x81, 0x6E, 0xFD, 0x5B)
__CRT_UUID_DECL(ISetupConfiguration2, 0x26AAB78C, 0x4A60, 0x49D6, 0xAF, 0x3B, 0x3C, 0x35, 0xBC, 0x93, 0x36, 0x5D)
__CRT_UUID_DECL(ISetupHelper, 0x42B21B78, 0x6192, 0x463E, 0x87, 0xBF, 0xD5, 0x77, 0x83, 0x8F, 0x1D, 0x5C)
__CRT_UUID_DECL(SetupConfiguration, 0x177F0C4A, 0x1CD3, 0x4DE7, 0xA3, 0x2C, 0x71, 0xDB, 0xBB, 0x9F, 0xA3, 0x6D)
#endif
_COM_SMARTPTR_TYPEDEF(ISetupConfiguration, __uuidof(ISetupConfiguration));
_COM_SMARTPTR_TYPEDEF(ISetupConfiguration2, __uuidof(ISetupConfiguration2));
_COM_SMARTPTR_TYPEDEF(ISetupHelper, __uuidof(ISetupHelper));
_COM_SMARTPTR_TYPEDEF(IEnumSetupInstances, __uuidof(IEnumSetupInstances));
_COM_SMARTPTR_TYPEDEF(ISetupInstance, __uuidof(ISetupInstance));
_COM_SMARTPTR_TYPEDEF(ISetupInstance2, __uuidof(ISetupInstance2));

int main() {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  struct Suppress {
    static void __stdcall handler(HRESULT, IErrorInfo *) {}
    Suppress() { _set_com_error_handler(handler); }
    ~Suppress() { _set_com_error_handler(_com_raise_error); }
  } suppress;
  ISetupConfigurationPtr Query;
  HRESULT HR = Query.CreateInstance(__uuidof(SetupConfiguration));
  if (FAILED(HR)) { std::printf("CreateInstance failed 0x%08lx\n", HR); return 1; }
  IEnumSetupInstancesPtr EnumInstances;
  HR = ISetupConfiguration2Ptr(Query)->EnumAllInstances(&EnumInstances);
  if (FAILED(HR)) { std::printf("EnumAllInstances failed 0x%08lx\n", HR); return 1; }
  ISetupInstancePtr Instance, Newest;
  std::optional<unsigned long long> NewestVersion;
  while ((HR = EnumInstances->Next(1, &Instance, nullptr)) == S_OK) {
    bstr_t VersionString;
    unsigned long long Version;
    if (FAILED(Instance->GetInstallationVersion(VersionString.GetAddress()))) continue;
    if (FAILED(ISetupHelperPtr(Query)->ParseVersion(VersionString, &Version))) continue;
    std::printf("instance %ls\n", (const wchar_t *)VersionString);
    if (!NewestVersion || Version > *NewestVersion) { Newest = Instance; NewestVersion = Version; }
  }
  if (!Newest) { std::printf("no instance\n"); return 1; }
  bstr_t VCPath;
  if (FAILED(Newest->ResolvePath(L"VC", VCPath.GetAddress()))) { std::printf("ResolvePath failed\n"); return 1; }
  std::printf("VC: %ls\n", (const wchar_t *)VCPath);
  return 0;
}
