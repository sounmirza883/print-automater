#include "backend/auth_client.h"

#include "backend/http.h"
#include "identity/base64url.h"

namespace pa {

namespace {

std::string string_field(const nlohmann::json& body, const char* name) {
  if (!body.is_object() || !body.contains(name) || !body[name].is_string()) {
    throw BackendError(std::string("The API's answer is missing \"") + name + "\".",
                       "INVALID_RESPONSE", true, 0);
  }
  return body[name].get<std::string>();
}

StaffUser parse_user(const nlohmann::json& body) {
  if (!body.contains("user") || !body["user"].is_object()) {
    throw BackendError("The API's answer is missing \"user\".", "INVALID_RESPONSE", true, 0);
  }
  const auto& user = body["user"];
  StaffUser out;
  out.id = string_field(user, "id");
  out.name = string_field(user, "name");
  out.email = string_field(user, "email");
  out.role = string_field(user, "role");
  return out;
}

nlohmann::json parse_body(const std::string& text) {
  if (text.empty()) return nlohmann::json();
  try {
    return nlohmann::json::parse(text);
  } catch (const nlohmann::json::parse_error&) {
    throw BackendError("The API answered with something that is not JSON.", "INVALID_RESPONSE",
                       true, 0);
  }
}

std::chrono::system_clock::time_point fallback_expiry() {
  // A conservative guess (the API's own access tokens are issued for 15 minutes; see
  // services/api/src/auth/token.service.ts's ACCESS_TOKEN_TTL) for the rare case the token
  // does not parse as a JWT at all -- the next authenticated call simply refreshes early.
  using namespace std::chrono_literals;
  return std::chrono::system_clock::now() + 10min;
}

}  // namespace

std::optional<std::chrono::system_clock::time_point> jwt_expiry(const std::string& token) {
  const auto first_dot = token.find('.');
  if (first_dot == std::string::npos) return std::nullopt;
  const auto second_dot = token.find('.', first_dot + 1);
  if (second_dot == std::string::npos) return std::nullopt;
  const std::string payload_segment = token.substr(first_dot + 1, second_dot - first_dot - 1);
  const auto decoded = base64url_decode(payload_segment);
  if (!decoded) return std::nullopt;
  nlohmann::json payload;
  try {
    payload = nlohmann::json::parse(decoded->begin(), decoded->end());
  } catch (const nlohmann::json::parse_error&) {
    return std::nullopt;
  }
  if (!payload.is_object() || !payload.contains("exp") || !payload["exp"].is_number()) {
    return std::nullopt;
  }
  const auto exp_seconds = payload["exp"].get<std::int64_t>();
  return std::chrono::system_clock::time_point(std::chrono::seconds(exp_seconds));
}

AuthClient::AuthClient(std::string base_url) : base_url_(std::move(base_url)) {}

nlohmann::json AuthClient::post(const std::string& path, const nlohmann::json& body) {
  HttpRequest request;
  request.method = "POST";
  request.url = base_url_ + path;
  request.headers["Content-Type"] = "application/json";
  request.headers["Accept"] = "application/json";
  request.body = body.dump();
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

AuthSession AuthClient::login(const std::string& email, const std::string& password) {
  const auto body = post("/v1/auth/login", {{"email", email}, {"password", password}});
  AuthSession session;
  session.user = parse_user(body);
  session.access_token = string_field(body, "accessToken");
  session.refresh_token = string_field(body, "refreshToken");
  session.access_token_expires_at =
      jwt_expiry(session.access_token).value_or(fallback_expiry());
  return session;
}

AuthSession AuthClient::refresh(const StaffUser& user, const std::string& refresh_token) {
  const auto body = post("/v1/auth/refresh", {{"refreshToken", refresh_token}});
  AuthSession session;
  session.user = user;
  session.access_token = string_field(body, "accessToken");
  session.refresh_token = string_field(body, "refreshToken");
  session.access_token_expires_at =
      jwt_expiry(session.access_token).value_or(fallback_expiry());
  return session;
}

void AuthClient::logout(const std::string& refresh_token) {
  post("/v1/auth/logout", {{"refreshToken", refresh_token}});
}

}  // namespace pa
