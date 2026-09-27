#include "backend/status_reporter.h"

#include "app/stop.h"

namespace pa {

bool is_permanent_refusal(const std::exception& error) noexcept {
  const auto* refused = dynamic_cast<const BackendError*>(&error);
  if (refused == nullptr || refused->retryable()) return false;
  const long status = refused->status();
  return status >= 400 && status < 500 && status != 401 && status != 408 && status != 429;
}

bool report_status_with_retry(
    const std::function<void(const std::string& idempotency_key)>& send,
    const std::string& job_id, ReportedStatus status, std::stop_token stop,
    const ReportRetryOptions& options,
    const std::function<void(const std::exception&, int attempt, std::chrono::milliseconds)>&
        on_retry) {
  const std::string key = job_id + ":" + to_string(status);
  auto interval = options.initial;
  for (int attempt = 1;; ++attempt) {
    if (stop.stop_requested()) return false;
    try {
      send(key);
      return true;
    } catch (const std::exception& error) {
      if (is_permanent_refusal(error)) throw;
      if (options.max_attempts && attempt >= *options.max_attempts) throw;
      if (on_retry) on_retry(error, attempt, interval);
    }
    if (!sleep_unless_stopped(stop, interval)) return false;
    interval = std::min(interval * 2, options.maximum);
  }
}

}  // namespace pa
