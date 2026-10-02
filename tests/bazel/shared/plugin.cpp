#include <string>

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif

extern "C" EXPORT int plugin_answer() {
  std::string text = "forty-two";
  return text.size() == 9 ? 42 : 0;
}
