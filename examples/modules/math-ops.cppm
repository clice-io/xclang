export module math:ops;

import std;

export int perimeter(std::span<const int> sides) {
    return std::accumulate(sides.begin(), sides.end(), 0);
}
