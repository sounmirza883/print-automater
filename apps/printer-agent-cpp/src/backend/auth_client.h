#pragma once

#include <nlohmann/json.hpp>

#include <chrono>
#include <optional>
#include <string>

#include "backend/backend_client.h"  // BackendError / to_backend_error: the API's error shape

namespace pa {

/// A staff account, exactly as services/api's AuthResult.user shape (auth/auth.service.ts).
struct StaffUser {
  std::string id;
  std::string name;
  std::string email;
  std::string role;
};

/// An access/refresh token pair plus the signed-in user and when the access token actually
/// expires (read from the token itself -- see jwt_expiry -- not guessed locally).
struct AuthSession {
  StaffUser user;
  std::string access_token;
  std::string refresh_token;
  std::chrono::system_clock::time_point access_token_expires_at;
};

/// Decodes a JWT's own "exp" claim (seconds since epoch, UTC) without checking its signature:
/// the agent never needs to verify its own access token -- the API is the one source of truth
/// on whether a token is still valid -- only to know when a refresh is worth attempting before
/// an authenticated call. nullopt for anything that is not a three-part JWT with a numeric
/// "exp" (a malformed or future token format never crashes the caller; it just means "refresh
/// before every call" is the safe fallback).
std::optional<std::chrono::system_clock::time_point> jwt_expiry(const std::string& token);

/// Staff login against the SAME contract apps/shop-web uses (services/api/src/auth):
/// POST /v1/auth/login, /v1/auth/refresh, /v1/auth/logout. Unlike BackendClient (pairing and
/// printing only -- see its own header comment), this talks to the general-purpose auth
/// surface that a human signs into, so the native dashboard pages (ApiClient, api_client.h)
/// can authenticate exactly as apps/shop-web does.
class AuthClient {
 public:
  explicit AuthClient(std::string base_url);

  /// POST /v1/auth/login. Throws BackendError(401, ...) on a wrong email or password -- the API
  /// deliberately answers the same way for both, so this cannot be used to enumerate accounts.
  AuthSession login(const std::string& email, const std::string& password);

  /// POST /v1/auth/refresh. The endpoint rotates the refresh token (the presented one is
  /// consumed) and does not return the user, so the caller's own `user` is carried over.
  /// Throws BackendError(401, ...) when the refresh token is invalid, expired, or already used
  /// (rotation reuse detection) -- the caller should then treat the session as signed out.
  AuthSession refresh(const StaffUser& user, const std::string& refresh_token);

  /// POST /v1/auth/logout. Revokes the refresh token at the API; best-effort from the caller's
  /// point of view (a network failure here should not block signing out locally).
  void logout(const std::string& refresh_token);

 private:
  nlohmann::json post(const std::string& path, const nlohmann::json& body);
  std::string base_url_;
};

}  // namespace pa
