#include "backend/access_tokens.h"

namespace pa {

std::string AccessTokens::get(const Identity& identity) {
  std::lock_guard lock(mutex_);
  const auto now = clock_();
  if (token_ && token_device_ == identity.device_id() && now < expires_) {
    return *token_;
  }
  const std::string nonce = client_.fetch_challenge(identity.device_id());
  const std::string token =
      client_.authenticate(identity.device_id(), identity.sign_challenge(nonce));
  token_ = token;
  token_device_ = identity.device_id();
  expires_ = now + kCacheFor;
  return token;
}

void AccessTokens::invalidate() {
  std::lock_guard lock(mutex_);
  token_.reset();
}

}  // namespace pa
