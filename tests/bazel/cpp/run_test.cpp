// Runs the program named by the first argument, which on Windows is a .exe.
#include <cstdio>
#include <string>

#ifdef _WIN32
#define popen _popen
#define pclose _pclose
#endif

int main(int argc, char** argv) {
  if (argc != 2) return 1;
  std::string program = argv[1];
#ifdef _WIN32
  if (program.size() < 4 || program.compare(program.size() - 4, 4, ".exe") != 0) {
    std::printf("%s is not a .exe\n", program.c_str());
    return 1;
  }
  for (char& c : program) if (c == '/') c = '\\';
#endif
  FILE* pipe = popen(program.c_str(), "r");
  if (!pipe) return 1;
  std::string output;
  char buffer[256];
  while (std::fgets(buffer, sizeof buffer, pipe)) output += buffer;
  int status = pclose(pipe);
  std::printf("%s: %s", program.c_str(), output.c_str());
  return status == 0 && output == "hello from xclang\n" ? 0 : 1;
}
