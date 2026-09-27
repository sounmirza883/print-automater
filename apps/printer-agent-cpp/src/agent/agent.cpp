#include "agent/agent.h"

#include "agent/pairing.h"
#include "app/stop.h"
#include "app/win.h"
#include "backend/backoff.h"
#include "backend/http.h"
#include "documents/job_document.h"
#include "printing/discovery.h"
#include "printing/print_monitor.h"

namespace pa {

using namespace std::chrono_literals;

namespace {

constexpr auto kHeartbeatInterval = 30s;
constexpr auto kHeartbeatBackoffCeiling = 5min;
constexpr auto kJobLoopBackoff = 5s;
constexpr auto kJobLoopBackoffCeiling = 60s;
constexpr auto kNotPairedPoll = 1s;
constexpr auto kHousekeepingInterval = 1h;
constexpr auto kTempOrphanAge = 60min;

std::string now_iso() {
  return iso8601_utc(std::chrono::system_clock::now());
}

}  // namespace

// --- BackendJobApi ---

std::string BackendJobApi::token() {
  const auto identity = identity_();
  if (!identity) throw BackendError("This computer is not paired.", "NOT_PAIRED", true, 0);
  try {
    return tokens_.get(*identity);
  } catch (const BackendError& error) {
    on_error(error);
    throw;
  }
}

void BackendJobApi::on_error(const BackendError& error) {
  if (error.status() == 401) tokens_.invalidate();
}

std::optional<PrintJobSummary> BackendJobApi::poll(std::chrono::seconds wait) {
  try {
    return client_.poll_jobs(token(), wait);
  } catch (const BackendError& error) {
    on_error(error);
    throw;
  }
}

PrintJobSummary BackendJobApi::claim(const std::string& job_id) {
  try {
    return client_.claim_job(token(), job_id);
  } catch (const BackendError& error) {
    on_error(error);
    throw;
  }
}

void BackendJobApi::download(const std::string& job_id, const std::filesystem::path& file) {
  try {
    client_.download_document(token(), job_id, file);
  } catch (const BackendError& error) {
    on_error(error);
    throw;
  }
}

void BackendJobApi::report(const std::string& job_id, ReportedStatus status,
                           const std::string& idempotency_key,
                           const std::optional<std::string>& os_job_id) {
  try {
    client_.report_job_status(token(), job_id, status, idempotency_key, os_job_id);
  } catch (const BackendError& error) {
    on_error(error);
    throw;
  }
}

// --- SpoolerJobPrinter ---

SubmittedPrint SpoolerJobPrinter::print(const std::filesystem::path& document,
                                        const PrintJobSummary& job, const PrintSettings& settings) {
  // The spooler shows this name to anyone who opens the queue: a job id, never a customer's.
  const std::wstring name = L"Print Automated job " + std::wstring(job.id.begin(), job.id.end());
  std::optional<std::filesystem::path> output;
  if (print_to_file_dir_) {
    const auto port = queue_port(job.printer_name);
    if (port && saves_to_file(*port)) {
      std::filesystem::create_directories(*print_to_file_dir_);
      output = job_document_path(*print_to_file_dir_, job.id);
    }
  }
  return print_pdf(document, job.printer_name, settings, name, output);
}

std::optional<JobResult> SpoolerJobPrinter::monitor(const std::string& printer_name,
                                                    DWORD spool_job_id, std::stop_token stop) {
  return monitor_spooler_job(printer_name, spool_job_id, stop);
}

// --- Agent ---

Agent::Agent(AgentPaths paths, AgentConfig config, Logger& log,
             std::shared_ptr<const Identity> identity, std::string startup_error)
    : paths_(std::move(paths)),
      config_(std::move(config)),
      log_(log),
      client_(config_.api_base_url),
      tokens_(client_),
      job_api_(client_, tokens_, [this] { return this->identity(); }),
      printer_(config_.print_to_file_dir),
      identity_(std::move(identity)) {
  status_.last_error = std::move(startup_error);
  if (identity_) {
    status_.paired = true;
    status_.device_id = identity_->device_id();
    status_.shop_id = identity_->shop_id();
  }
}

Agent::~Agent() {
  stop();
}

std::shared_ptr<const Identity> Agent::identity() const {
  std::lock_guard lock(mutex_);
  return identity_;
}

AgentStatus Agent::status() const {
  std::lock_guard lock(mutex_);
  return status_;
}

void Agent::set_status_listener(std::function<void()> listener) {
  std::lock_guard lock(mutex_);
  listener_ = std::move(listener);
}

void Agent::notify() {
  std::function<void()> listener;
  {
    std::lock_guard lock(mutex_);
    listener = listener_;
  }
  if (listener) listener();
}

void Agent::set_error(std::string message) {
  {
    std::lock_guard lock(mutex_);
    if (status_.last_error == message) return;
    status_.last_error = std::move(message);
  }
  notify();
}

void Agent::housekeep(std::chrono::minutes temp_min_age) {
  const int removed = sweep_temp_files(paths_.tmp_dir, temp_min_age);
  if (removed > 0) log_.warn("removed orphaned temp documents", {{"count", removed}});
  try {
    const int pruned =
        ledger_->prune_old_resolved(std::chrono::hours(24) * config_.ledger_retention_days);
    if (pruned > 0) log_.info("pruned old ledger rows", {{"count", pruned}});
  } catch (const std::exception& error) {
    log_.error("ledger prune failed", {{"error", error.what()}});
  }
}

void Agent::start() {
  ledger_ = std::make_unique<JobLedger>(paths_.ledger_file);
  // A row still unresolved belongs to a previous run that never learned the outcome: it becomes
  // UNKNOWN and is never printed again.
  leftovers_ = mark_unresolved_as_unknown(*ledger_);
  for (const auto& row : leftovers_) {
    log_.warn("job left unresolved by a previous run; marked UNKNOWN, will not be printed again",
              {{"jobId", row.job_id}, {"orderId", row.order_id}, {"printer", row.printer_name}});
  }
  // Every temp file now predates this process, so none can be in use.
  housekeep(std::chrono::minutes(0));

  threads_.emplace_back([this](std::stop_token stop) { heartbeat_loop(stop); });
  threads_.emplace_back([this](std::stop_token stop) { job_loop(stop); });
  threads_.emplace_back([this](std::stop_token stop) { housekeeping_loop(stop); });
}

void Agent::stop() {
  if (threads_.empty()) return;
  for (auto& thread : threads_) thread.request_stop();
  http_shutdown();  // a long poll would otherwise hold the job thread for up to 35 seconds
  threads_.clear();  // joins
}

void Agent::heartbeat_loop(std::stop_token stop) {
  ReconnectBackoff backoff(kHeartbeatInterval, kHeartbeatBackoffCeiling);
  std::map<std::string, LastReportedPrinter> last_reported;
  while (!stop.stop_requested()) {
    const auto me = identity();
    if (!me) {
      sleep_unless_stopped(stop, kNotPairedPoll);
      continue;
    }
    try {
      const std::string token = tokens_.get(*me);
      const auto printers = discover_printers(config_.print_to_file_dir.has_value());
      // Only once the API has the beat do its fields count as reported; the Node agent
      // committed them first, so a failed beat could hide a change until the next restart.
      auto reported = last_reported;
      client_.send_heartbeat(token, heartbeat_printers(printers, reported));
      last_reported = std::move(reported);
      {
        std::lock_guard lock(mutex_);
        status_.last_heartbeat_at = now_iso();
        status_.printers = static_cast<int>(printers.size());
        status_.last_error.clear();
      }
      notify();
      if (backoff.record_success()) log_.info("heartbeat reconnected to the API");
      sleep_unless_stopped(stop, kHeartbeatInterval);
    } catch (const std::exception& error) {
      if (stop.stop_requested()) break;  // shutdown aborted the request: not a failure
      if (const auto* refused = dynamic_cast<const BackendError*>(&error);
          refused != nullptr && refused->status() == 401) {
        tokens_.invalidate();
      }
      const auto wait = backoff.record_failure();
      log_.warn("heartbeat failed", {{"error", error.what()}, {"retryInMs", wait.count()}});
      set_error(std::string("Could not reach Print Automated: ") + error.what());
      sleep_unless_stopped(stop, wait);
    }
  }
}

void Agent::job_loop(std::stop_token stop) {
  ReconnectBackoff backoff(kJobLoopBackoff, kJobLoopBackoffCeiling);
  JobProcessorOptions options;
  options.tmp_dir = paths_.tmp_dir;
  bool leftovers_reported = false;
  while (!stop.stop_requested()) {
    if (!identity()) {
      sleep_unless_stopped(stop, kNotPairedPoll);
      continue;
    }
    if (!leftovers_reported) {
      for (const auto& row : leftovers_) {
        report_or_log(job_api_, log_, row.job_id, ReportedStatus::Unknown, std::nullopt,
                      options.report, stop);
      }
      leftovers_reported = true;
    }
    try {
      const auto result = process_next_job(job_api_, printer_, *ledger_, log_, options, stop);
      if (backoff.record_success()) log_.info("job loop reconnected to the API");
      const char* verdict = result.outcome == JobOutcome::Printed   ? "PRINTED"
                            : result.outcome == JobOutcome::Failed  ? "FAILED"
                            : result.outcome == JobOutcome::Unknown ? "UNKNOWN"
                                                                    : nullptr;
      if (verdict != nullptr) {
        {
          std::lock_guard lock(mutex_);
          status_.last_job = std::string(verdict) + " at " + now_iso() +
                             (result.error.empty() ? "" : " (" + result.error + ")");
        }
        notify();
      }
    } catch (const std::exception& error) {
      if (stop.stop_requested()) break;  // shutdown aborted the long poll: not a failure
      const auto wait = backoff.record_failure();
      log_.error("job loop error", {{"error", error.what()}, {"retryInMs", wait.count()}});
      set_error(std::string("Could not fetch print jobs: ") + error.what());
      sleep_unless_stopped(stop, wait);
    }
  }
}

void Agent::housekeeping_loop(std::stop_token stop) {
  while (sleep_unless_stopped(stop, kHousekeepingInterval)) {
    housekeep(std::chrono::duration_cast<std::chrono::minutes>(kTempOrphanAge));
  }
}

void Agent::pair(std::string_view typed_code) {
  const auto code = normalize_pairing_code(typed_code);
  if (!code) {
    throw PairingError("Enter the 8-character pairing code shown in the Print Automated app.", 422);
  }
  {
    std::lock_guard lock(mutex_);
    if (identity_) throw PairingError("This computer is already paired.", 409);
    if (status_.pairing) throw PairingError("Pairing is already in progress.", 409);
    status_.pairing = true;
  }
  notify();

  try {
    Identity fresh = Identity::generate();
    fresh.set_shop_id(client_.register_agent(*code, fresh.device_id(), fresh.public_key_base64url()));
    save_identity(fresh, paths_.identity_file);
    auto saved = std::make_shared<const Identity>(std::move(fresh));
    {
      std::lock_guard lock(mutex_);
      identity_ = saved;
      status_.pairing = false;
      status_.paired = true;
      status_.device_id = saved->device_id();
      status_.shop_id = saved->shop_id();
      status_.last_error.clear();
    }
    log_.info("paired", {{"deviceId", saved->device_id()}, {"shopId", saved->shop_id()}});
    notify();
  } catch (const std::exception& error) {
    const auto* refused = dynamic_cast<const BackendError*>(&error);
    const std::string message = refused != nullptr
                                    ? std::string(error.what())
                                    : std::string("Pairing failed: ") + error.what();
    {
      std::lock_guard lock(mutex_);
      status_.pairing = false;
      status_.last_error = message;
    }
    log_.error("pairing failed", {{"error", error.what()}});
    notify();
    const bool bad_code = refused != nullptr && refused->status() >= 400 && refused->status() < 500;
    throw PairingError(message, bad_code ? 422 : 502);
  }
}

}  // namespace pa
