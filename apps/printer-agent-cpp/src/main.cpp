#include <windows.h>
#include <shellapi.h>

#include <sodium.h>

#include <memory>
#include <string>
#include <string_view>

#include "agent/agent.h"
#include "app/log.h"
#include "app/status_window.h"
#include "app/tray.h"
#include "app/version.h"
#include "app/win.h"
#include "backend/http.h"
#include "config/config.h"
#include "config/paths.h"
#include "identity/identity.h"
#include "server/loopback.h"

namespace {

constexpr int kPagePort = 7171;
constexpr wchar_t kPageUrl[] = L"http://127.0.0.1:7171";

void show_error(const std::string& message) {
  std::wstring text;
  try {
    text = pa::widen(message);
  } catch (...) {
    text = L"The Print Automated agent could not start.";
  }
  MessageBoxW(nullptr, text.c_str(), L"Print Automated agent", MB_ICONERROR | MB_OK);
}

std::wstring describe(const pa::AgentStatus& status) {
  if (status.pairing) return L"Pairing…";
  if (!status.paired) return L"Not paired: open the agent page to pair";
  std::wstring text;
  if (!status.last_error.empty()) {
    try {
      text = L"Problem: " + pa::widen(status.last_error);
    } catch (...) {
      text = L"Problem: see the agent page";
    }
  } else if (status.last_heartbeat_at.empty()) {
    text = L"Paired, connecting…";
  } else {
    text = L"Connected, " + std::to_wstring(status.printers) +
           (status.printers == 1 ? L" printer" : L" printers");
  }
  return text;
}

/// An identity.dat that cannot be read is moved aside, not overwritten by the next pairing, so
/// whatever went wrong with it can still be looked at.
void set_aside(const std::filesystem::path& file) {
  auto aside = file;
  aside += L".unreadable-" + std::to_wstring(GetTickCount64());
  MoveFileExW(file.c_str(), aside.c_str(), MOVEFILE_REPLACE_EXISTING);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR command_line, int) {
  // --pair: open the pairing page once started (the installer's first launch). A normal start
  // at sign-in never opens a browser; the tray shows when pairing is still needed.
  const bool open_page = command_line != nullptr && std::wstring_view(command_line).find(L"--pair") != std::wstring_view::npos;
  // One agent per Windows user: a second start just opens the running one's page.
  pa::UniqueHandle single_instance(CreateMutexW(nullptr, TRUE, L"Local\\PrintAutomatedAgent"));
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    ShellExecuteW(nullptr, L"open", kPageUrl, nullptr, nullptr, SW_SHOWNORMAL);
    return 0;
  }

  pa::AgentPaths paths;
  try {
    paths = pa::agent_paths();
    pa::ensure_agent_dirs(paths);
  } catch (const std::exception& error) {
    show_error(std::string("The agent's folder could not be created: ") + error.what());
    return 1;
  }

  pa::FileLogger log(paths.log_dir);
  log.info("printer agent starting", {{"version", pa::agent_version()}});
  try {
    if (sodium_init() < 0) throw std::runtime_error("libsodium could not initialise.");
    pa::http_global_init();
    const pa::AgentConfig config = pa::load_agent_config(paths.config_file);
    log.info("configuration loaded", {{"apiBaseUrl", config.api_base_url},
                                      {"ledgerRetentionDays", config.ledger_retention_days}});

    std::shared_ptr<const pa::Identity> identity;
    std::string startup_error;
    try {
      if (auto loaded = pa::load_identity(paths.identity_file, paths.legacy_identity_file)) {
        identity = std::make_shared<const pa::Identity>(std::move(*loaded));
        log.info("loaded identity",
                 {{"deviceId", identity->device_id()}, {"shopId", identity->shop_id()}});
      } else {
        log.info("not paired yet");
      }
    } catch (const std::exception& error) {
      log.error("the saved identity could not be read; it was set aside",
                {{"error", error.what()}});
      set_aside(paths.identity_file);
      startup_error = "The saved pairing could not be read, so this computer must be paired again.";
    }

    pa::Agent agent(paths, config, log, identity, startup_error);
    pa::LoopbackServer server(kPagePort,
                              {[&agent] { return agent.status(); },
                               [&agent](std::string_view code) { agent.pair(code); }},
                              log);
    server.start();  // throws when the port is taken: never two agents printing at once
    agent.start();

    // 28: the tray's own click/menu default shows this in-process window; the browser page
    // (kPageUrl) stays reachable too, unchanged, since it's the only thing a SECOND launched
    // instance (below) or an external pairing walkthrough can reach.
    pa::StatusWindow window(
        instance, [&agent] { return agent.status(); },
        [&agent](std::string_view code) { agent.pair(code); });
    pa::Tray tray(
        instance, kPageUrl, [&] { window.show(); },
        [&] {
          log.info("shutting down");
          server.stop();
          agent.stop();
        });
    const auto refresh_status = [&] {
      tray.set_status(describe(agent.status()));
      window.on_status_changed();
    };
    agent.set_status_listener(refresh_status);
    refresh_status();
    if (open_page) ShellExecuteW(nullptr, L"open", kPageUrl, nullptr, nullptr, SW_SHOWNORMAL);

    const int code = tray.run();
    agent.set_status_listener(nullptr);
    log.info("printer agent stopped");
    return code;
  } catch (const std::exception& error) {
    log.error("the agent could not start", {{"error", error.what()}});
    show_error(std::string("The Print Automated agent could not start.\n\n") + error.what());
    return 1;
  }
}
