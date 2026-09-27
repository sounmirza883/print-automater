#pragma once

#include <nlohmann/json.hpp>

#include <chrono>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>

namespace pa {

/// The API refused a request, or could not be reached (status 0, NETWORK_ERROR). Same shape as
/// the Node agent's BackendError and the API's error body {message, error_code, retryable}.
class BackendError : public std::runtime_error {
 public:
  BackendError(const std::string& message, std::string error_code, bool retryable, long status)
      : std::runtime_error(message),
        error_code_(std::move(error_code)),
        retryable_(retryable),
        status_(status) {}
  const std::string& error_code() const { return error_code_; }
  bool retryable() const { return retryable_; }
  long status() const { return status_; }

 private:
  std::string error_code_;
  bool retryable_;
  long status_;
};

/// A print job as GET /v1/agents/jobs and POST .../claim return it.
struct PrintJobSummary {
  std::string id;
  std::string order_id;
  std::string printer_id;
  std::string printer_name;
  std::string status;
  nlohmann::json print_configuration;  // pages, copies, paperSize, color, sides, orientation
};

PrintJobSummary parse_print_job(const nlohmann::json& body);

enum class ReportedStatus { Printing, Printed, Failed, Unknown };
const char* to_string(ReportedStatus status);

/// 24.4 (ported from backend/backend-client.ts): the agent's calls to services/api. Does not
/// retry by itself: each caller decides what a failure means (the status reporter retries
/// with backoff; a failed pairing is shown to the person pairing).
class BackendClient {
 public:
  explicit BackendClient(std::string base_url);

  const std::string& base_url() const { return base_url_; }

  /// POST /v1/agents/register -> the shop this pairing code belongs to.
  std::string register_agent(const std::string& pairing_code, const std::string& device_id,
                             const std::string& public_key_base64url);
  /// POST /v1/agents/authenticate/challenge -> a nonce to sign.
  std::string fetch_challenge(const std::string& device_id);
  /// POST /v1/agents/authenticate -> a 15-minute agent access token.
  std::string authenticate(const std::string& device_id, const std::string& signature);
  /// POST /v1/agents/heartbeat
  void send_heartbeat(const std::string& access_token, const nlohmann::json& printers);
  /// GET /v1/agents/jobs?wait=N (long poll): nullopt on 204 "nothing to do".
  std::optional<PrintJobSummary> poll_jobs(const std::string& access_token,
                                           std::chrono::seconds wait);
  /// POST /v1/agents/jobs/:id/claim. A 409 (someone else won) surfaces as BackendError(409).
  PrintJobSummary claim_job(const std::string& access_token, const std::string& job_id);
  /// POST /v1/agents/jobs/:id/status with Idempotency-Key, so a retried report is applied once.
  void report_job_status(const std::string& access_token, const std::string& job_id,
                         ReportedStatus status, const std::string& idempotency_key,
                         const std::optional<std::string>& os_job_id);
  /// GET /v1/agents/jobs/:id/document, streamed to `file`.
  void download_document(const std::string& access_token, const std::string& job_id,
                         const std::filesystem::path& file);

 private:
  nlohmann::json post(const std::string& path, const nlohmann::json& body,
                      const std::optional<std::string>& access_token,
                      const std::map<std::string, std::string>& extra_headers = {});
  std::string base_url_;
};

/// Builds a BackendError from an HTTP status and the API's JSON error body (tolerates any body).
BackendError to_backend_error(long status, const std::string& body);

}  // namespace pa
