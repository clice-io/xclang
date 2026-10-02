// Loads the shared library named by the first argument and calls into it.
#include <cstdio>
#include <string>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

int main(int argc, char** argv) {
  if (argc != 2) return 1;
  std::string path = argv[1];
  std::printf("loading %s\n", path.c_str());
#ifdef _WIN32
  for (char& c : path) if (c == '/') c = '\\';
  HMODULE library = LoadLibraryA(path.c_str());
  if (!library) return 1;
  auto answer = reinterpret_cast<int (*)()>(GetProcAddress(library, "plugin_answer"));
#else
  if (path.find('/') == std::string::npos) path = "./" + path;
  void* library = dlopen(path.c_str(), RTLD_NOW);
  if (!library) {
    std::printf("%s\n", dlerror());
    return 1;
  }
  auto answer = reinterpret_cast<int (*)()>(dlsym(library, "plugin_answer"));
#endif
  if (!answer) return 1;
  int value = answer();
  std::printf("plugin_answer() = %d\n", value);
  return value == 42 ? 0 : 1;
}
