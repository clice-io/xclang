/// A configuration loader on nlohmann/json and the std module: parsing,
/// traversal, conversions of user types and JSON pointers.

import std;
import nlohmann.json;

using nlohmann::json;
using namespace nlohmann::literals::json_literals;

namespace app {

struct endpoint {
  std::string host;
  std::uint16_t port = 0;
  std::vector<std::string> tags;
  std::optional<double> timeout;
};

void to_json(json& j, const endpoint& e) {
  j = json{{"host", e.host}, {"port", e.port}, {"tags", e.tags}};
  if (e.timeout) j["timeout"] = *e.timeout;
}

void from_json(const json& j, endpoint& e) {
  j.at("host").get_to(e.host);
  j.at("port").get_to(e.port);
  e.tags = j.value("tags", std::vector<std::string>{});
  if (auto it = j.find("timeout"); it != j.end()) e.timeout = it->get<double>();
}

struct config {
  std::string name;
  std::map<std::string, endpoint> endpoints;
  std::unordered_map<std::string, json> extra;
};

void from_json(const json& j, config& c) {
  c.name = j.value("name", "unnamed");
  c.endpoints = j.at("endpoints").get<std::map<std::string, endpoint>>();
  for (const auto& item : j.items()) {
    if (item.key() != "name" && item.key() != "endpoints") c.extra.emplace(item.key(), item.value());
  }
}

std::size_t count_leaves(const json& j) {
  if (j.is_object() || j.is_array()) {
    std::size_t n = 0;
    for (const auto& child : j) n += count_leaves(child);
    return n;
  }
  return 1;
}

}  // namespace app

int main() {
  auto text = R"({
    "name": "gateway",
    "endpoints": {
      "primary": {"host": "10.0.0.1", "port": 8080, "tags": ["a", "b"], "timeout": 2.5},
      "backup": {"host": "10.0.0.2", "port": 8081}
    },
    "limits": {"rps": 1000, "burst": [1, 2, 3]},
    "debug": false
  })";
  json j = json::parse(text);
  auto cfg = j.get<app::config>();
  json back = cfg.endpoints;
  back["/primary/port"_json_pointer] = 9090;
  auto patch = json::diff(j["endpoints"], back);
  nlohmann::ordered_json ordered = {{"z", 1}, {"a", 2}};
  auto merged = R"({"limits": {"rps": 5}})"_json;
  j.merge_patch(merged);
  std::vector<std::uint8_t> packed = json::to_cbor(j);
  std::println("{} endpoints, {} leaves, {} patch ops, {} cbor bytes, first key {}", cfg.endpoints.size(),
               app::count_leaves(j), patch.size(), packed.size(), ordered.begin().key());
  std::println("{}", j.dump(2));
}
