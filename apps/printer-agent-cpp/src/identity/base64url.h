#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace pa {

/// RFC 4648 base64url without padding: the encoding the API uses for the agent's public key
/// and challenge signatures (Node's Buffer "base64url"). Backed by libsodium.
std::string base64url_encode(std::span<const std::uint8_t> bytes);

/// Decodes base64url (padding tolerated). nullopt for anything that is not valid base64url.
std::optional<std::vector<std::uint8_t>> base64url_decode(std::string_view text);

}  // namespace pa
