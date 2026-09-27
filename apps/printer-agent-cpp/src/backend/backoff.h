#pragma once

#include <chrono>

namespace pa {

/// Ported from the Node agent's backend/reconnect-backoff.ts. A pure calculator (no sleeping),
/// one per independently failing loop (heartbeat, job poll): after each failure the wait
/// doubles up to a ceiling; a success resets it and says whether it ended an outage, which is
/// the cue to reconcile the ledger once per outage rather than on every healthy tick.
class ReconnectBackoff {
 public:
  ReconnectBackoff(std::chrono::milliseconds initial, std::chrono::milliseconds maximum)
      : initial_(initial), maximum_(maximum), interval_(initial) {}

  /// After a failed attempt: how long to wait before the next one.
  std::chrono::milliseconds record_failure() {
    ++consecutive_failures_;
    const auto delay = interval_;
    interval_ = std::min(interval_ * 2, maximum_);
    return delay;
  }

  /// After a successful attempt: resets, and returns true exactly when this success follows
  /// one or more failures ("we were down and just reconnected").
  bool record_success() {
    const bool reconnected = consecutive_failures_ > 0;
    consecutive_failures_ = 0;
    interval_ = initial_;
    return reconnected;
  }

 private:
  std::chrono::milliseconds initial_;
  std::chrono::milliseconds maximum_;
  std::chrono::milliseconds interval_;
  int consecutive_failures_ = 0;
};

}  // namespace pa
