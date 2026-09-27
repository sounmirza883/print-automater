#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <filesystem>
#include <map>

#include "app/win.h"
#include "config/config.h"
#include "config/paths.h"

using Catch::Matchers::ContainsSubstring;

namespace {

pa::EnvLookup env_of(std::map<std::string, std::string> values) {
  return [values](const char* name) -> std::optional<std::string> {
    const auto it = values.find(name);
    if (it == values.end()) return std::nullopt;
    return it->second;
  };
}

}  // namespace

TEST_CASE("the agent's state lives in one directory under Local AppData") {
  const auto paths = pa::agent_paths_under(L"C:\\Users\\x\\AppData\\Local");
  CHECK(paths.root == std::filesystem::path(L"C:\\Users\\x\\AppData\\Local\\PrintAutomated"));
  for (const auto& inside : {paths.config_file, paths.identity_file, paths.legacy_identity_file,
                             paths.ledger_file, paths.log_dir, paths.tmp_dir}) {
    CHECK(inside.parent_path() == paths.root);
  }
  CHECK(paths.ledger_file.filename() == L"ledger.sqlite");  // shared with the Node agent
}

TEST_CASE("ensure_agent_dirs creates the tree and is idempotent") {
  const auto base = std::filesystem::temp_directory_path() / L"pa-paths-test";
  std::filesystem::remove_all(base);
  const auto paths = pa::agent_paths_under(base);
  pa::ensure_agent_dirs(paths);
  pa::ensure_agent_dirs(paths);
  CHECK(std::filesystem::is_directory(paths.log_dir));
  CHECK(std::filesystem::is_directory(paths.tmp_dir));
  std::filesystem::remove_all(base);
}

TEST_CASE("config reads config.json, lets the environment override it, and trims the URL") {
  const auto from_file =
      pa::parse_agent_config(R"({"apiBaseUrl":"https://api.example.com/","ledgerRetentionDays":7})",
                             env_of({}));
  CHECK(from_file.api_base_url == "https://api.example.com");
  CHECK(from_file.ledger_retention_days == 7);

  const auto overridden = pa::parse_agent_config(
      R"({"apiBaseUrl":"https://api.example.com"})",
      env_of({{"API_BASE_URL", "http://localhost:3000"}, {"LEDGER_RETENTION_DAYS", "45"}}));
  CHECK(overridden.api_base_url == "http://localhost:3000");
  CHECK(overridden.ledger_retention_days == 45);

  CHECK(pa::parse_agent_config("", env_of({{"API_BASE_URL", "https://x.test"}}))
            .ledger_retention_days == 30);
}

TEST_CASE("config refuses plain http off the machine, a missing URL and bad values") {
  CHECK_THROWS_WITH(pa::parse_agent_config("", env_of({})), ContainsSubstring("No API URL"));
  CHECK_THROWS_WITH(pa::parse_agent_config(R"({"apiBaseUrl":"http://192.168.1.10:3000"})", env_of({})),
                    ContainsSubstring("must use https"));
  CHECK_THROWS_WITH(pa::parse_agent_config(R"({"apiBaseUrl":"https://user:pw@api.test"})", env_of({})),
                    ContainsSubstring("credentials"));
  CHECK_THROWS_WITH(pa::parse_agent_config(R"({"apiBaseUrl":"not a url"})", env_of({})),
                    ContainsSubstring("not a URL"));
  CHECK_THROWS_WITH(pa::parse_agent_config("{oops", env_of({})), ContainsSubstring("not valid JSON"));
  CHECK_THROWS_WITH(
      pa::parse_agent_config("", env_of({{"API_BASE_URL", "https://x.test"},
                                          {"LEDGER_RETENTION_DAYS", "0"}})),
      ContainsSubstring("1 to 3650"));
  CHECK_NOTHROW(pa::parse_agent_config(R"({"apiBaseUrl":"http://127.0.0.1:3000"})", env_of({})));
  CHECK_NOTHROW(pa::parse_agent_config(R"({"apiBaseUrl":"http://[::1]:3000"})", env_of({})));
}

TEST_CASE("UTF-8 and UTF-16 convert both ways") {
  const std::string text = "Caf\xC3\xA9 printer";
  CHECK(pa::narrow(pa::widen(text)) == text);
  CHECK_THROWS(pa::widen(std::string("\xFF\xFE", 2)));
}

TEST_CASE("PRINT_AUTOMATED_AGENT_HOME moves the whole state folder; a relative one is ignored") {
  _wputenv_s(L"PRINT_AUTOMATED_AGENT_HOME", L"C:\\agent-trial");
  const auto moved = pa::agent_paths();
  CHECK(moved.root == std::filesystem::path(L"C:\\agent-trial"));
  CHECK(moved.identity_file == std::filesystem::path(L"C:\\agent-trial\\identity.dat"));

  _wputenv_s(L"PRINT_AUTOMATED_AGENT_HOME", L"relative\\dir");
  CHECK(pa::agent_paths().root.filename() == L"PrintAutomated");

  _wputenv_s(L"PRINT_AUTOMATED_AGENT_HOME", L"");
  CHECK(pa::agent_paths().root.filename() == L"PrintAutomated");
}

TEST_CASE("printToFileDir is off unless set, and must be an absolute path") {
  const auto plain = pa::parse_agent_config(R"({"apiBaseUrl":"https://api.example.com"})", env_of({}));
  CHECK_FALSE(plain.print_to_file_dir.has_value());

  const auto trial = pa::parse_agent_config(
      R"({"apiBaseUrl":"https://api.example.com","printToFileDir":"C:\\trial\\printed"})",
      env_of({}));
  REQUIRE(trial.print_to_file_dir.has_value());
  CHECK(*trial.print_to_file_dir == std::filesystem::path(L"C:\\trial\\printed"));

  const auto from_env = pa::parse_agent_config(
      R"({"apiBaseUrl":"https://api.example.com"})", env_of({{"PRINT_TO_FILE_DIR", "D:\\out"}}));
  CHECK(*from_env.print_to_file_dir == std::filesystem::path(L"D:\\out"));

  CHECK_THROWS_AS(pa::parse_agent_config(
                      R"({"apiBaseUrl":"https://api.example.com","printToFileDir":"relative"})",
                      env_of({})),
                  pa::ConfigError);
  CHECK_THROWS_AS(pa::parse_agent_config(
                      R"({"apiBaseUrl":"https://api.example.com","printToFileDir":3})", env_of({})),
                  pa::ConfigError);
}
