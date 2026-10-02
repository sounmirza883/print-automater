#pragma once

#include <chrono>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <utility>

#include "backend/auth_client.h"

namespace pa {

/// The signed-in staff session (slice 1 of the native dashboard pages). The access token lives
/// in memory only -- it is short-lived (15 minutes, server-side) and simply re-minted from the
/// refresh token when needed. The refresh token is persisted to disk the same way identity.dat
/// is: DPAPI-sealed for the current Windows user (identity.h's dpapi_seal/dpapi_unseal), so a
/// restart of the agent does not force staff to sign in again, and a copied session.dat is
/// useless on another machine or under another Windows account.
class Session {
 public:
  explicit Session(std::filesystem::path session_file);

  /// Replaces the current in-memory session (after a successful login or refresh) and persists
  /// its refresh token to disk. Thread-safe.
  void set(AuthSession session);

  /// Clears the in-memory session and deletes the persisted file -- logout, or a refresh that
  /// failed because the refresh token was invalid, expired, or already used.
  void clear();

  /// nullopt before any login, and after clear().
  std::optional<AuthSession> current() const;

  /// True once the access token is already expired or within `skew` of expiring (or there is no
  /// session at all). The default matches ApiClient's own single-refresh-and-retry margin.
  bool access_token_near_expiry(std::chrono::seconds skew = std::chrono::seconds(30)) const;

  /// A previously-persisted session, if session.dat exists and can be read, for the caller to
  /// present to AuthClient::refresh() at startup. Does not touch current(); the caller decides
  /// what a failed refresh means (set() on success, clear() on failure) rather than this class
  /// silently deciding to delete a file it merely failed to read once.
  std::optional<std::pair<StaffUser, std::string>> load_persisted() const;

 private:
  void save_to_disk(const AuthSession& session) const;

  std::filesystem::path session_file_;
  mutable std::mutex mutex_;
  std::optional<AuthSession> session_;
};

}  // namespace pa
