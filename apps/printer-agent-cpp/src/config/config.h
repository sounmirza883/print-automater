#pragma once

#include <filesystem>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>

namespace pa {

/// 24.2: the agent's settings. Defaults match the Node agent (packages/config agentEnvSchema).
struct AgentConfig {
  /// The API, without a trailing slash, e.g. "https://api.example.com".
  std::string api_base_url;
  int ledger_retention_days = 30;
  /// For trials and demonstrations only: print queues that save to a file instead of paper
  /// (Microsoft Print to PDF and similar, whose port asks for a file name) are then offered to
  /// the API too, and a job sent to one is written here as <jobId>.pdf. Without it those queues
  /// are not reported at all, because printing to one would open a Save dialog that nobody is
  /// there to answer. config.json printToFileDir or PRINT_TO_FILE_DIR; an absolute path.
  std::optional<std::filesystem::path> print_to_file_dir;
};

class ConfigError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/// Reads an environment variable; returns nullopt when unset or empty.
using EnvLookup = std::function<std::optional<std::string>(const char* name)>;

/// Builds the config from the installer's config.json text (may be empty when the file is
/// absent) plus environment overrides, the same names the Node agent read:
///   API_BASE_URL, LEDGER_RETENTION_DAYS.
///   (and PRINT_TO_FILE_DIR for print_to_file_dir)
/// Rules: the API URL is required; it must be https, except http to localhost / 127.0.0.1 /
/// [::1] for development (the agent sends bearer tokens and a signed identity over it); a
/// trailing slash is removed; retention is a whole number of days from 1 to 3650.
/// Throws ConfigError with a message that says which setting is wrong and where it came from.
AgentConfig parse_agent_config(const std::string& config_json, const EnvLookup& env);

/// Reads `config_file` (if it exists) and the real environment.
AgentConfig load_agent_config(const std::filesystem::path& config_file);

}  // namespace pa
