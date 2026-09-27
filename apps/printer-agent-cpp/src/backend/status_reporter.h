#pragma once

#include <chrono>
#include <functional>
#include <optional>
#include <stop_token>
#include <string>

#include "backend/backend_client.h"

namespace pa {

struct ReportRetryOptions {
  std::chrono::milliseconds initial{2000};
  std::chrono::milliseconds maximum{30000};
  /// Tests bound it; production leaves it unset so a report keeps trying for as long as the
  /// API stays unreachable.
  std::optional<int> max_attempts;
};

/// 24.11 (ported from backend/status-reporter.ts): reports a job's status until the API accepts
/// it. The Idempotency-Key is `${jobId}:${status}`, the same on every retry, so however many
/// times this retries the API applies the transition once; this function's job is only that
/// the report eventually arrives. Waits double from `initial` up to `maximum`.
///
/// `send` performs one attempt (it fetches a fresh access token each time, so a long outage
/// cannot leave it holding an expired one). Returns false if `stop` ended it first; rethrows
/// the last error once max_attempts is reached.
///
/// A refusal the API will never change its mind about (is_permanent_refusal) is rethrown at
/// once instead of retried: the API already answers 200 to a late or replayed report, so what
/// is left (the job is not this agent's, the body is invalid) would otherwise keep the job
/// loop retrying forever and printing nothing else.
/// A 4xx the API marked not retryable, other than 401 (a fresh token fixes it), 408 and 429.
bool is_permanent_refusal(const std::exception& error) noexcept;

bool report_status_with_retry(
    const std::function<void(const std::string& idempotency_key)>& send,
    const std::string& job_id, ReportedStatus status, std::stop_token stop,
    const ReportRetryOptions& options = {},
    const std::function<void(const std::exception&, int attempt, std::chrono::milliseconds)>&
        on_retry = {});

}  // namespace pa
