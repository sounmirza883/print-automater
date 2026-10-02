#include "backend/api_client.h"

#include "backend/http.h"

namespace pa {

namespace {

nlohmann::json parse_body(const std::string& text) {
  if (text.empty()) return nlohmann::json();
  try {
    return nlohmann::json::parse(text);
  } catch (const nlohmann::json::parse_error&) {
    throw BackendError("The API answered with something that is not JSON.", "INVALID_RESPONSE",
                       true, 0);
  }
}

}  // namespace

ApiClient::ApiClient(std::string base_url, Session& session, AuthClient& auth_client)
    : base_url_(std::move(base_url)), session_(session), auth_client_(auth_client) {}

void ApiClient::ensure_fresh_token() {
  if (!session_.access_token_near_expiry()) return;
  if (!try_refresh()) {
    throw BackendError("Not signed in.", "NOT_SIGNED_IN", false, 401);
  }
}

bool ApiClient::try_refresh() {
  const auto current = session_.current();
  if (!current) return false;
  try {
    AuthSession refreshed = auth_client_.refresh(current->user, current->refresh_token);
    session_.set(std::move(refreshed));
    return true;
  } catch (const BackendError&) {
    session_.clear();
    return false;
  } catch (const NetworkError&) {
    // The network, not the token, is the problem: keep the session so the next call can retry
    // once connectivity returns, rather than forcing a fresh sign-in.
    return false;
  }
}

nlohmann::json ApiClient::request(const std::string& method, const std::string& path,
                                  const std::optional<nlohmann::json>& body) {
  ensure_fresh_token();

  const auto send_with = [&](const std::string& access_token) {
    HttpRequest http_request;
    http_request.method = method;
    http_request.url = base_url_ + path;
    http_request.headers["Authorization"] = "Bearer " + access_token;
    http_request.headers["Accept"] = "application/json";
    if (body) {
      http_request.headers["Content-Type"] = "application/json";
      http_request.body = body->dump();
    }
    try {
      return http_send(http_request);
    } catch (const NetworkError& error) {
      throw BackendError(error.what(), "NETWORK_ERROR", true, 0);
    }
  };

  const auto session = session_.current();
  if (!session) throw BackendError("Not signed in.", "NOT_SIGNED_IN", false, 401);
  HttpResponse response = send_with(session->access_token);

  if (response.status == 401) {
    if (try_refresh()) {
      const auto retried_session = session_.current();
      if (retried_session) {
        response = send_with(retried_session->access_token);
      }
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw to_backend_error(response.status, response.body);
  }
  return parse_body(response.body);
}

nlohmann::json ApiClient::get(const std::string& path) { return request("GET", path, std::nullopt); }

nlohmann::json ApiClient::post(const std::string& path, const nlohmann::json& body) {
  return request("POST", path, std::optional<nlohmann::json>(body));
}

nlohmann::json ApiClient::patch(const std::string& path, const nlohmann::json& body) {
  return request("PATCH", path, std::optional<nlohmann::json>(body));
}

}  // namespace pa
