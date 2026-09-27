#include "config/paths.h"

#include <shlobj.h>

#include <cstdlib>

#include "app/win.h"

namespace pa {

AgentPaths agent_paths_in(const std::filesystem::path& root) {
  AgentPaths paths;
  paths.root = root;
  paths.config_file = paths.root / L"config.json";
  paths.identity_file = paths.root / L"identity.dat";
  paths.legacy_identity_file = paths.root / L"identity.json";
  paths.ledger_file = paths.root / L"ledger.sqlite";
  paths.log_dir = paths.root / L"logs";
  paths.tmp_dir = paths.root / L"tmp";
  return paths;
}

AgentPaths agent_paths_under(const std::filesystem::path& local_app_data) {
  return agent_paths_in(local_app_data / L"PrintAutomated");
}

AgentPaths agent_paths() {
  wchar_t* home = nullptr;
  size_t length = 0;
  if (_wdupenv_s(&home, &length, L"PRINT_AUTOMATED_AGENT_HOME") == 0 && home != nullptr) {
    const std::filesystem::path override_root(home);
    free(home);
    if (!override_root.empty() && override_root.is_absolute()) return agent_paths_in(override_root);
  }
  PWSTR raw = nullptr;
  const HRESULT hr = SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &raw);
  if (FAILED(hr) || raw == nullptr) {
    if (raw != nullptr) CoTaskMemFree(raw);
    throw Win32Error("SHGetKnownFolderPath(LocalAppData)", static_cast<DWORD>(hr));
  }
  const std::filesystem::path base(raw);
  CoTaskMemFree(raw);
  return agent_paths_under(base);
}

void ensure_agent_dirs(const AgentPaths& paths) {
  std::filesystem::create_directories(paths.root);
  std::filesystem::create_directories(paths.log_dir);
  std::filesystem::create_directories(paths.tmp_dir);
}

}  // namespace pa
