#pragma once

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <stop_token>

namespace pa {

/// Sleeps for `duration` unless `stop` is requested first (shutdown must not wait out a
/// 60-second backoff). Returns false when stopped.
inline bool sleep_unless_stopped(std::stop_token stop, std::chrono::milliseconds duration) {
  std::mutex mutex;
  std::condition_variable_any wake;
  std::unique_lock lock(mutex);
  return !wake.wait_for(lock, stop, duration, [] { return false; }) && !stop.stop_requested();
}

}  // namespace pa
