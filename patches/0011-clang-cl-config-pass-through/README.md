# clang-cl: a config file's /clang: options reported unused

clang claims every option of a config file as it reads it, so that the
driver does not warn about one a compile does not use (a C++ include path
in a C compile, a linker option in `-c`). clang-cl reads its config files
in its own option table, where an option of clang's driver alone, such as
`-stdlib++-isystem`, can only be passed through with `/clang:`. The driver
parses those again, after the config files, as new options, and claims
none of them: each that a compile does not use is reported as unused, as
if the user had typed it.

xclang's config files of the MSVC targets give clang-cl libc++'s headers
with `/clang:-stdlib++-isystem<dir>`, clang-cl having nothing of its own
that adds a C++-only include directory before clang's. Without the patch,
every C compile by clang-cl warns `argument unused during compilation:
'-stdlib++-isystem ...'`, an error with `/WX`.

The patch claims the options a `/clang:` passes through when the `/clang:`
was claimed already, which only those of a config file are at that point.

- Upstream: not reported.
- Checked: applies to 23.1.2 with `-F0`; tests/toolchain/smoke.ts compiles
  C with clang-cl and `/WX` for the MSVC targets, through their config
  files.
