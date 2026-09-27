#pragma once

#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace pa {

/// The code from the shop app, as the API issues it: 8 characters from an alphabet without the
/// look-alikes 0/O and 1/I/L (services/api pairing-code.util.ts). Case, spaces and dashes are
/// forgiven, since it is typed by hand; anything else is nullopt.
std::optional<std::string> normalize_pairing_code(std::string_view typed);

/// Pairing did not happen; `what()` is written for the person pairing, and `http_status` is
/// what the local pairing page answers with.
class PairingError : public std::runtime_error {
 public:
  PairingError(const std::string& message, int http_status)
      : std::runtime_error(message), http_status_(http_status) {}
  int http_status() const { return http_status_; }

 private:
  int http_status_;
};

}  // namespace pa
