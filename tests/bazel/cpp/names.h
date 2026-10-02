#pragma once

#include <memory>
#include <string>
#include <vector>

// Allocated here, freed by the caller.
std::unique_ptr<std::vector<std::string>> names();

// Throws std::out_of_range for an index past the end.
const std::string& name_at(const std::vector<std::string>& names, std::size_t index);
