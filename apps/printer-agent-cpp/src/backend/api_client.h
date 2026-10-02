#pragma once

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

#include "backend/auth_client.h"
#include "backend/session.h"

namespace pa {

/// A generic authenticated REST client against services/api, for every native dashboard page
/// this agent grows after slice 1 (Orders, Printers, Inventory, ...) -- they all share this one
/// client instead of each hand-rolling HTTP calls. Built directly on http.cpp's CURL wrapper,
/// the same one BackendClient uses for pairing and printing; this class owns none of the CURL
/// plumbing itself.
///
/// Before every call, refreshes the access token first if it is missing or near its 15-minute
/// expiry (Session::access_token_near_expiry) -- cheaper than waiting to be told no. If the API
/// still answers 401 (clock skew, revocation, concurrent logout elsewhere, ...), refreshes once
/// more and retries the SAME request exactly once; a second 401 is thrown to the caller as-is.
/// A refresh that itself fails (the refresh token is invalid, expired, or reused) clears the
/// session, so main.cpp's caller can show the Login window again.
class ApiClient {
 public:
  ApiClient(std::string base_url, Session& session, AuthClient& auth_client);

  nlohmann::json get(const std::string& path);
  nlohmann::json post(const std::string& path, const nlohmann::json& body);
  nlohmann::json patch(const std::string& path, const nlohmann::json& body);

 private:
  nlohmann::json request(const std::string& method, const std::string& path,
                         const std::optional<nlohmann::json>& body);
  /// Refreshes now if there is no session or the access token is near expiry. Throws
  /// BackendError("NOT_SIGNED_IN") when there is no session at all and no persisted refresh
  /// token to fall back on.
  void ensure_fresh_token();
  /// Attempts one refresh using the current session's refresh token. Returns false (and clears
  /// the session) when the refresh itself fails.
  bool try_refresh();

  std::string base_url_;
  Session& session_;
  AuthClient& auth_client_;
};

}  // namespace pa
