#include "backend/backend_client.h"

#include "backend/http.h"

namespace pa {

namespace {

std::string string_field(const nlohmann::json& body, const char* name) {
  if (!body.is_object() || !body.contains(name) || !body[name].is_string()) {
    throw BackendError(std::string("The API's answer is missing \"") + name + "\".",
                       "INVALID_RESPONSE", true, 0);
  }
  return body[name].get<std::string>();
}

nlohmann::json parse_body(const std::string& text) {
  if (text.empty()) return nlohmann::json();  // e.g. the heartbeat answers 200 with no body
  try {
    return nlohmann::json::parse(text);
  } catch (const nlohmann::json::parse_error&) {
    throw BackendError("The API answered with something that is not JSON.", "INVALID_RESPONSE",
                       true, 0);
  }
}

}  // namespace

BackendError to_backend_error(long status, const std::string& body) {
  std::string message = "Request failed with status " + std::to_string(status);
  std::string code = "UNKNOWN_ERROR";
  bool retryable = status >= 500;
  try {
    const auto json = nlohmann::json::parse(body);
    if (json.is_object()) {
      if (json.contains("message") && json["message"].is_string()) message = json["message"];
      if (json.contains("error_code") && json["error_code"].is_string()) code = json["error_code"];
      if (json.contains("retryable") && json["retryable"].is_boolean()) retryable = json["retryable"];
    }
  } catch (const nlohmann::json::exception&) {
    // Not the API's error shape (a proxy page, say): keep the status-based defaults.
  }
  return BackendError(message, code, retryable, status);
}

const char* to_string(ReportedStatus status) {
  switch (status) {
    case ReportedStatus::Printing:
      return "PRINTING";
    case ReportedStatus::Printed:
      return "PRINTED";
    case ReportedStatus::Failed:
      return "FAILED";
    case ReportedStatus::Unknown:
      return "UNKNOWN";
  }
  return "UNKNOWN";
}

PrintJobSummary parse_print_job(const nlohmann::json& body) {
  PrintJobSummary job;
  job.id = string_field(body, "id");
  job.order_id = string_field(body, "orderId");
  job.printer_id = body.value("printerId", std::string{});
  job.printer_name = string_field(body, "printerName");
  job.status = body.value("status", std::string{});
  if (!body.contains("printConfiguration") || !body["printConfiguration"].is_object()) {
    throw BackendError("The API's job is missing its print configuration.", "INVALID_RESPONSE",
                       true, 0);
  }
  job.print_configuration = body["printConfiguration"];
  return job;
}

BackendClient::BackendClient(std::string base_url) : base_url_(std::move(base_url)) {}

nlohmann::json BackendClient::post(const std::string& path, const nlohmann::json& body,
                                   const std::optional<std::string>& access_token,
                                   const std::map<std::string, std::string>& extra_headers) {
  HttpRequest request;
  request.method = "POST";
  request.url = base_url_ + path;
  request.headers = extra_headers;
  request.headers["Content-Type"] = "application/json";
  request.headers["Accept"] = "application/json";
  if (access_token) request.headers["Authorization"] = "Bearer " + *access_token;
  request.body = body.is_null() ? std::string("{}") : body.dump();
  HttpResponse response;
  try {
    response = http_send(request);
  } catch (const NetworkError& error) {
    throw BackendError(error.what(), "NETWORK_ERROR", true, 0);
  }
  if (response.status < 200 || response.status >= 300) {
    throw to_backend_error(response.status, response.body);
  }
  return parse_body(response.body);
}

std::string BackendClient::register_agent(const std::string& pairing_code,
                                          const std::string& device_id,
                                          const std::string& public_key_base64url) {
  const auto body = post("/v1/agents/register",
                         {{"pairingCode", pairing_code},
                          {"deviceId", device_id},
                          {"publicKey", public_key_base64url}},
                         std::nullopt);
  return string_field(body, "shopId");
}

std::string BackendClient::fetch_challenge(const std::string& device_id) {
  return string_field(post("/v1/agents/authenticate/challenge", {{"deviceId", device_id}},
                           std::nullopt),
                      "nonce");
}

std::string BackendClient::authenticate(const std::string& device_id,
                                        const std::string& signature) {
  return string_field(post("/v1/agents/authenticate",
                           {{"deviceId", device_id}, {"signature", signature}}, std::nullopt),
                      "accessToken");
}

void BackendClient::send_heartbeat(const std::string& access_token,
                                   const nlohmann::json& printers) {
  post("/v1/agents/heartbeat", {{"printers", printers}}, access_token);
}

std::optional<PrintJobSummary> BackendClient::poll_jobs(const std::string& access_token,
                                                        std::chrono::seconds wait) {
  HttpRequest request;
  request.url = base_url_ + "/v1/agents/jobs?wait=" + std::to_string(wait.count());
  request.headers["Authorization"] = "Bearer " + access_token;
  request.headers["Accept"] = "application/json";
  request.timeout = wait + std::chrono::seconds(15);  // the call is expected to sit open
  HttpResponse response;
  try {
    response = http_send(request);
  } catch (const NetworkError& error) {
    throw BackendError(error.what(), "NETWORK_ERROR", true, 0);
  }
  if (response.status == 204) return std::nullopt;
  if (response.status < 200 || response.status >= 300) {
    throw to_backend_error(response.status, response.body);
  }
  return parse_print_job(parse_body(response.body));
}

PrintJobSummary BackendClient::claim_job(const std::string& access_token,
                                         const std::string& job_id) {
  return parse_print_job(post("/v1/agents/jobs/" + job_id + "/claim", nullptr, access_token));
}

void BackendClient::report_job_status(const std::string& access_token, const std::string& job_id,
                                      ReportedStatus status, const std::string& idempotency_key,
                                      const std::optional<std::string>& os_job_id) {
  nlohmann::json body = {{"status", to_string(status)}};
  if (os_job_id) body["osJobId"] = *os_job_id;
  post("/v1/agents/jobs/" + job_id + "/status", body, access_token,
       {{"Idempotency-Key", idempotency_key}});
}

void BackendClient::download_document(const std::string& access_token, const std::string& job_id,
                                      const std::filesystem::path& file) {
  HttpRequest request;
  request.url = base_url_ + "/v1/agents/jobs/" + job_id + "/document";
  request.headers["Authorization"] = "Bearer " + access_token;
  request.timeout = std::chrono::seconds(300);  // a large document on a slow line
  std::string error_body;
  long status = 0;
  try {
    status = http_download(request, file, error_body);
  } catch (const NetworkError& error) {
    throw BackendError(error.what(), "NETWORK_ERROR", true, 0);
  }
  if (status < 200 || status >= 300) throw to_backend_error(status, error_body);
}

}  // namespace pa
