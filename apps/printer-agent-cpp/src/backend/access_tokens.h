#pragma once

#include <chrono>
#include <functional>
#include <mutex>
#include <optional>
#include <string>

#include "backend/backend_client.h"
#include "identity/identity.h"

namespace pa {

/// 24.4: the agent's short-lived access token (the API issues it for 15 minutes; it is cached
/// for 14 so a call made at the edge of the cache never presents an expired one).
///
/// Single-flighted, as the Node agent learned the hard way: the heartbeat and job loops both
/// need a token at startup, and two concurrent challenge requests make the server replace the
/// first nonce with the second, so the first signature then fails with INVALID_SIGNATURE.
/// Here one mutex covers the whole challenge -> sign -> authenticate round trip; a second
/// caller waits and then finds the fresh token in the cache.
class AccessTokens {
 public:
  using Clock = std::function<std::chrono::steady_clock::time_point()>;

  explicit AccessTokens(BackendClient& client, Clock clock = &std::chrono::steady_clock::now)
      : client_(client), clock_(std::move(clock)) {}

  std::string get(const Identity& identity);

  /// Drops the cached token (after a 401), so the next get() authenticates again.
  void invalidate();

  static constexpr std::chrono::minutes kCacheFor{14};

 private:
  BackendClient& client_;
  Clock clock_;
  std::mutex mutex_;
  std::optional<std::string> token_;
  std::string token_device_;
  std::chrono::steady_clock::time_point expires_{};
};

}  // namespace pa
