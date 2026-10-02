module;

#include <string>

export module greeting;

import math;

export std::string greeting(int n) { return "square " + std::to_string(square(n)); }
