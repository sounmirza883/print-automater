#pragma once

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stop_token>
#include <string>
#include <thread>
#include <vector>

#include "agent/job_processor.h"
#include "app/log.h"
#include "backend/access_tokens.h"
#include "backend/backend_client.h"
#include "config/config.h"
#include "config/paths.h"
#include "identity/identity.h"
#include "ledger/ledger.h"
#include "printing/heartbeat.h"

namespace pa {

/// What the tray and the local pairing page show.
struct AgentStatus {
  bool paired = false;
  bool pairing = false;
  std::string device_id;
  std::string shop_id;
  std::string last_error;         // the latest problem, for a person to read; empty when healthy
  std::string last_heartbeat_at;  // ISO-8601 UTC, empty before the first one
  int printers = 0;               // print queues seen on the latest heartbeat
  std::string last_job;           // e.g. "PRINTED at 2026-09-28T10:00:00.000Z"
};

/// JobApi over the real API: each call takes the cached access token, and a 401 drops it so
/// the next call signs a fresh challenge.
class BackendJobApi final : public JobApi {
 public:
  using CurrentIdentity = std::function<std::shared_ptr<const Identity>()>;
  BackendJobApi(BackendClient& client, AccessTokens& tokens, CurrentIdentity identity)
      : client_(client), tokens_(tokens), identity_(std::move(identity)) {}

  std::optional<PrintJobSummary> poll(std::chrono::seconds wait) override;
  PrintJobSummary claim(const std::string& job_id) override;
  void download(const std::string& job_id, const std::filesystem::path& file) override;
  void report(const std::string& job_id, ReportedStatus status, const std::string& idempotency_key,
              const std::optional<std::string>& os_job_id) override;

 private:
  std::string token();
  void on_error(const BackendError& error);
  BackendClient& client_;
  AccessTokens& tokens_;
  CurrentIdentity identity_;
};

/// JobPrinter over PDFium and the Windows spooler. With `print_to_file_dir`, a job for a
/// save-to-file queue is written there as <jobId>.pdf (trials); real printers are unaffected.
class SpoolerJobPrinter final : public JobPrinter {
 public:
  explicit SpoolerJobPrinter(std::optional<std::filesystem::path> print_to_file_dir)
      : print_to_file_dir_(std::move(print_to_file_dir)) {}
  SubmittedPrint print(const std::filesystem::path& document, const PrintJobSummary& job,
                       const PrintSettings& settings) override;
  std::optional<JobResult> monitor(const std::string& printer_name, DWORD spool_job_id,
                                   std::stop_token stop) override;

 private:
  std::optional<std::filesystem::path> print_to_file_dir_;
};

/// The running agent (ported from the Node agent's index.ts): three threads sharing one
/// identity, token cache and ledger.
///  - heartbeat: every 30 s, the installed printers and what changed about them; on failure the
///    wait doubles up to 5 minutes.
///  - jobs: first reports UNKNOWN for every job a previous run left unresolved (the Node agent
///    only marked them locally and left the API to time them out), then long-polls and prints
///    one job at a time; on an API failure the wait doubles from 5 s up to a minute.
///  - housekeeping: hourly, orphaned temp documents and old ledger rows.
/// Until the computer is paired, the heartbeat and job threads wait; pair() starts them working.
class Agent {
 public:
  Agent(AgentPaths paths, AgentConfig config, Logger& log,
        std::shared_ptr<const Identity> identity, std::string startup_error);
  Agent(const Agent&) = delete;
  Agent& operator=(const Agent&) = delete;
  ~Agent();

  /// Opens the ledger, runs the startup sweeps, and starts the threads. Throws when the ledger
  /// cannot be opened (the agent must not print without its duplicate protection).
  void start();
  /// Stops the threads and waits for them (a print already sent to the spooler is not undone).
  void stop();

  AgentStatus status() const;
  /// Called (from any thread) whenever status() changes.
  void set_status_listener(std::function<void()> listener);

  /// Registers this computer with the pairing code and saves the new identity. Throws
  /// PairingError with a message for the person pairing.
  void pair(std::string_view typed_code);

 private:
  void heartbeat_loop(std::stop_token stop);
  void job_loop(std::stop_token stop);
  void housekeeping_loop(std::stop_token stop);
  void housekeep(std::chrono::minutes temp_min_age);
  std::shared_ptr<const Identity> identity() const;
  void set_error(std::string message);
  void notify();

  AgentPaths paths_;
  AgentConfig config_;
  Logger& log_;
  BackendClient client_;
  AccessTokens tokens_;
  BackendJobApi job_api_;
  SpoolerJobPrinter printer_;
  std::unique_ptr<JobLedger> ledger_;
  std::vector<LedgerRow> leftovers_;  // unresolved by a previous run; reported UNKNOWN once

  mutable std::mutex mutex_;
  std::shared_ptr<const Identity> identity_;
  AgentStatus status_;
  std::function<void()> listener_;

  std::vector<std::jthread> threads_;
};

}  // namespace pa
