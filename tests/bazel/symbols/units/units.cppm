// A module whose units share file names: the partition logging.cppm and the
// implementation unit logging.cpp, and types.cpp in two directories.
export module units;

export import :logging;

export int types_a(int x);
export int types_b(int x);
