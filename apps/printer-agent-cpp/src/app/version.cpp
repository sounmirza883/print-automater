#include "app/version.h"

#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <sodium.h>
#include <sqlite3.h>

#include <sstream>

namespace pa {

std::string agent_version() {
  return PA_VERSION;
}

std::string dependency_versions() {
  std::ostringstream out;
  out << "libcurl " << curl_version_info(CURLVERSION_NOW)->version << '\n'
      << "libsodium " << sodium_version_string() << '\n'
      << "sqlite " << sqlite3_libversion() << '\n'
      << "nlohmann-json " << NLOHMANN_JSON_VERSION_MAJOR << '.' << NLOHMANN_JSON_VERSION_MINOR
      << '.' << NLOHMANN_JSON_VERSION_PATCH;
  return out.str();
}

}  // namespace pa
