#pragma once

#include <filesystem>

namespace pa {

/// 24.2 (ported from the Node agent's config/paths.ts): the agent's entire state is exactly one
/// directory, %LOCALAPPDATA%\PrintAutomated, so it is one thing to back up, inspect or wipe.
/// The file names match the Node agent's where the format is shared (the SQLite ledger), so a
/// machine moving from the Node agent keeps its ledger history.
struct AgentPaths {
  std::filesystem::path root;
  std::filesystem::path config_file;     // config.json   (API URL, retention), written by the installer
  std::filesystem::path identity_file;   // identity.dat  (DPAPI-sealed; 24.3)
  std::filesystem::path legacy_identity_file;  // identity.json (the Node agent's plaintext key)
  std::filesystem::path session_file;    // session.dat   (DPAPI-sealed staff refresh token; slice 1)
  std::filesystem::path ledger_file;     // ledger.sqlite (24.6)
  std::filesystem::path log_dir;         // logs\ .
  std::filesystem::path tmp_dir;         // tmp\  (job documents while printing; 24.8)
};

/// The layout inside `root` itself (pure).
AgentPaths agent_paths_in(const std::filesystem::path& root);

/// The layout under a given base directory: base\PrintAutomated (pure; used by tests).
AgentPaths agent_paths_under(const std::filesystem::path& local_app_data);

/// The real layout under the current user's Local AppData (SHGetKnownFolderPath), or inside
/// PRINT_AUTOMATED_AGENT_HOME when that is set to an absolute path: for development and
/// tests, so a trial run never touches the machine's real agent (or imports and deletes a
/// Node agent's identity.json there).
AgentPaths agent_paths();

/// Creates root, logs and tmp if missing. Idempotent.
void ensure_agent_dirs(const AgentPaths& paths);

}  // namespace pa
