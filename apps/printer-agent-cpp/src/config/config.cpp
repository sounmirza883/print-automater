#include "config/config.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace pa {

namespace {

std::string lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return text;
}

/// scheme://host[:port][/path] -> the host, lower-cased and without brackets or port.
std::string host_of(const std::string& url, size_t scheme_end) {
  const size_t start = scheme_end + 3;  // past "://"
  size_t end = url.find_first_of("/?#", start);
  if (end == std::string::npos) end = url.size();
  std::string authority = url.substr(start, end - start);
  if (authority.find('@') != std::string::npos) return {};  // no credentials in the URL
  if (!authority.empty() && authority.front() == '[') {
    const size_t close = authority.find(']');
    return close == std::string::npos ? std::string{} : lower(authority.substr(0, close + 1));
  }
  const size_t colon = authority.find(':');
  return lower(colon == std::string::npos ? authority : authority.substr(0, colon));
}

std::string validate_api_url(std::string url, const std::string& source) {
  while (!url.empty() && std::isspace(static_cast<unsigned char>(url.back()))) url.pop_back();
  while (!url.empty() && std::isspace(static_cast<unsigned char>(url.front()))) url.erase(0, 1);
  while (!url.empty() && url.back() == '/') url.pop_back();
  const size_t scheme_end = url.find("://");
  if (url.empty() || scheme_end == std::string::npos) {
    throw ConfigError("The API URL from " + source + " is not a URL: \"" + url + "\"");
  }
  const std::string scheme = lower(url.substr(0, scheme_end));
  const std::string host = host_of(url, scheme_end);
  if (host.empty()) {
    throw ConfigError("The API URL from " + source + " has no host (or includes credentials).");
  }
  const bool loopback = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
  if (scheme == "https" || (scheme == "http" && loopback)) {
    return url;
  }
  throw ConfigError("The API URL from " + source +
                    " must use https (plain http is allowed only for localhost): \"" + url + "\"");
}

int validate_retention(const std::string& text, const std::string& source) {
  int days = 0;
  const auto* first = text.data();
  const auto* last = text.data() + text.size();
  const auto [ptr, ec] = std::from_chars(first, last, days);
  if (ec != std::errc{} || ptr != last || days < 1 || days > 3650) {
    throw ConfigError("LEDGER_RETENTION_DAYS from " + source +
                      " must be a whole number of days from 1 to 3650, not \"" + text + "\"");
  }
  return days;
}

std::filesystem::path validate_print_dir(const std::string& text, const std::string& source) {
  std::filesystem::path dir;
  try {
    dir = std::filesystem::path(std::u8string(text.begin(), text.end()));
  } catch (const std::exception&) {
    throw ConfigError("printToFileDir from " + source + " is not a valid path.");
  }
  if (!dir.is_absolute()) {
    throw ConfigError("printToFileDir from " + source + " must be an absolute path, not \"" +
                      text + "\"");
  }
  return dir;
}

}  // namespace

AgentConfig parse_agent_config(const std::string& config_json, const EnvLookup& env) {
  AgentConfig config;
  std::optional<std::string> url;
  std::string url_source;

  if (!config_json.empty()) {
    nlohmann::json doc;
    try {
      doc = nlohmann::json::parse(config_json);
    } catch (const nlohmann::json::parse_error& error) {
      throw ConfigError(std::string("config.json is not valid JSON: ") + error.what());
    }
    if (!doc.is_object()) throw ConfigError("config.json must be a JSON object.");
    if (doc.contains("apiBaseUrl")) {
      if (!doc["apiBaseUrl"].is_string()) throw ConfigError("config.json apiBaseUrl must be text.");
      url = doc["apiBaseUrl"].get<std::string>();
      url_source = "config.json";
    }
    if (doc.contains("ledgerRetentionDays")) {
      if (!doc["ledgerRetentionDays"].is_number_integer()) {
        throw ConfigError("config.json ledgerRetentionDays must be a whole number.");
      }
      config.ledger_retention_days =
          validate_retention(std::to_string(doc["ledgerRetentionDays"].get<long long>()),
                             "config.json");
    }
    if (doc.contains("printToFileDir")) {
      if (!doc["printToFileDir"].is_string()) {
        throw ConfigError("config.json printToFileDir must be text.");
      }
      config.print_to_file_dir =
          validate_print_dir(doc["printToFileDir"].get<std::string>(), "config.json");
    }
  }

  if (auto from_env = env("API_BASE_URL")) {
    url = *from_env;
    url_source = "the API_BASE_URL environment variable";
  }
  if (auto from_env = env("LEDGER_RETENTION_DAYS")) {
    config.ledger_retention_days =
        validate_retention(*from_env, "the LEDGER_RETENTION_DAYS environment variable");
  }

  if (auto from_env = env("PRINT_TO_FILE_DIR")) {
    config.print_to_file_dir =
        validate_print_dir(*from_env, "the PRINT_TO_FILE_DIR environment variable");
  }

  if (!url) {
    throw ConfigError(
        "No API URL is configured: set apiBaseUrl in config.json (the installer writes it) or "
        "the API_BASE_URL environment variable.");
  }
  config.api_base_url = validate_api_url(*url, url_source);
  return config;
}

AgentConfig load_agent_config(const std::filesystem::path& config_file) {
  std::string text;
  if (std::filesystem::exists(config_file)) {
    std::ifstream in(config_file, std::ios::binary);
    std::ostringstream buffer;
    buffer << in.rdbuf();
    text = buffer.str();
    // A UTF-8 byte-order mark (Notepad adds one) is not part of the JSON.
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF) {
      text.erase(0, 3);
    }
  }
  return parse_agent_config(text, [](const char* name) -> std::optional<std::string> {
    char* value = nullptr;
    size_t length = 0;
    if (_dupenv_s(&value, &length, name) != 0 || value == nullptr) return std::nullopt;
    std::string result(value);
    std::free(value);
    if (result.empty()) return std::nullopt;
    return result;
  });
}

}  // namespace pa
