#include "agent/pairing.h"

namespace pa {

std::optional<std::string> normalize_pairing_code(std::string_view typed) {
  constexpr std::string_view kAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  std::string code;
  for (const char c : typed) {
    if (c == ' ' || c == '-' || c == '\t') continue;
    const char upper = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
    if (kAlphabet.find(upper) == std::string_view::npos) return std::nullopt;
    code.push_back(upper);
    if (code.size() > 8) return std::nullopt;
  }
  if (code.size() != 8) return std::nullopt;
  return code;
}

}  // namespace pa
