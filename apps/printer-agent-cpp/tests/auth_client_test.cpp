#include <catch2/catch_test_macros.hpp>

#include <nlohmann/json.hpp>

#include <chrono>

#include "backend/auth_client.h"
#include "identity/base64url.h"

namespace {

/// A JWT this test controls end to end: real base64url segments (so jwt_expiry's parsing is
/// exercised exactly as it would be against a real token), but no real signature, since
/// jwt_expiry deliberately never checks one (see its own header comment).
std::string make_jwt(const nlohmann::json& payload) {
  const std::string header_json = R"({"alg":"HS256","typ":"JWT"})";
  const std::string payload_json = payload.dump();
  const auto header_bytes =
      std::vector<std::uint8_t>(header_json.begin(), header_json.end());
  const auto payload_bytes =
      std::vector<std::uint8_t>(payload_json.begin(), payload_json.end());
  return pa::base64url_encode(header_bytes) + "." + pa::base64url_encode(payload_bytes) +
        ".not-a-real-signature";
}

}  // namespace

TEST_CASE("jwt_expiry reads the exp claim without checking the signature") {
  const auto epoch_seconds = 1'893'456'000;  // 2030-01-01T00:00:00Z
  const std::string token = make_jwt({{"sub", "user-1"}, {"exp", epoch_seconds}});
  const auto expiry = pa::jwt_expiry(token);
  REQUIRE(expiry.has_value());
  CHECK(std::chrono::system_clock::to_time_t(*expiry) == epoch_seconds);
}

TEST_CASE("jwt_expiry returns nullopt for anything that isn't a well-formed JWT") {
  CHECK_FALSE(pa::jwt_expiry("").has_value());
  CHECK_FALSE(pa::jwt_expiry("not-a-jwt-at-all").has_value());
  CHECK_FALSE(pa::jwt_expiry("one.two").has_value());                 // only one dot
  CHECK_FALSE(pa::jwt_expiry("!!!.!!!.!!!").has_value());             // not base64url
  CHECK_FALSE(pa::jwt_expiry(make_jwt({{"sub", "user-1"}})).has_value());  // no "exp"
  CHECK_FALSE(
      pa::jwt_expiry(make_jwt({{"exp", "not-a-number"}})).has_value());  // wrong type
}

TEST_CASE("jwt_expiry tolerates a payload that is valid base64url but not JSON") {
  const auto garbage = std::vector<std::uint8_t>{1, 2, 3, 4, 5};
  const std::string token = "header." + pa::base64url_encode(garbage) + ".sig";
  CHECK_FALSE(pa::jwt_expiry(token).has_value());
}
