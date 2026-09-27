#include "identity/base64url.h"

#include <sodium.h>

namespace pa {

std::string base64url_encode(std::span<const std::uint8_t> bytes) {
  const size_t capacity =
      sodium_base64_encoded_len(bytes.size(), sodium_base64_VARIANT_URLSAFE_NO_PADDING);
  std::string out(capacity, '\0');
  sodium_bin2base64(out.data(), out.size(), bytes.data(), bytes.size(),
                    sodium_base64_VARIANT_URLSAFE_NO_PADDING);
  out.resize(capacity - 1);  // drop the terminating NUL libsodium writes
  return out;
}

std::optional<std::vector<std::uint8_t>> base64url_decode(std::string_view text) {
  std::string_view trimmed = text;
  while (!trimmed.empty() && trimmed.back() == '=') trimmed.remove_suffix(1);
  std::vector<std::uint8_t> out(trimmed.size() * 3 / 4 + 3);
  size_t written = 0;
  const char* end = nullptr;
  if (sodium_base642bin(out.data(), out.size(), trimmed.data(), trimmed.size(), nullptr, &written,
                        &end, sodium_base64_VARIANT_URLSAFE_NO_PADDING) != 0 ||
      end != trimmed.data() + trimmed.size()) {
    return std::nullopt;
  }
  out.resize(written);
  return out;
}

}  // namespace pa
