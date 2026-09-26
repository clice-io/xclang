/// nlohmann/json as a module, the way a project wraps a header-only
/// library it does not own: the header in the global module fragment,
/// its names exported. Importers that also `import std;` merge the
/// standard library this header includes with the std module's.

module;

#include <nlohmann/json.hpp>

export module nlohmann.json;

export namespace nlohmann {
using ::nlohmann::adl_serializer;
using ::nlohmann::basic_json;
using ::nlohmann::json;
using ::nlohmann::json_pointer;
using ::nlohmann::ordered_json;
using ::nlohmann::ordered_map;

inline namespace literals {
inline namespace json_literals {
using ::nlohmann::literals::json_literals::operator""_json;
using ::nlohmann::literals::json_literals::operator""_json_pointer;
}  // namespace json_literals
}  // namespace literals
}  // namespace nlohmann
