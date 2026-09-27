#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <sodium.h>

#include <filesystem>
#include <fstream>
#include <regex>

#include "identity/base64url.h"
#include "identity/identity.h"

using Catch::Matchers::ContainsSubstring;

namespace {

std::filesystem::path fresh_dir(const wchar_t* name) {
  const auto dir = std::filesystem::temp_directory_path() / name;
  std::filesystem::remove_all(dir);
  std::filesystem::create_directories(dir);
  return dir;
}

std::string read_all(const std::filesystem::path& file) {
  std::ifstream in(file, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), {});
}

}  // namespace

TEST_CASE("base64url matches Node's Buffer 'base64url' (no padding, URL-safe alphabet)") {
  const std::vector<std::uint8_t> bytes = {0xFB, 0xFF, 0xBF, 0x01};
  CHECK(pa::base64url_encode(bytes) == "-_-_AQ");
  CHECK(pa::base64url_decode("-_-_AQ") == bytes);
  CHECK(pa::base64url_decode("-_-_AQ==") == bytes);
  CHECK_FALSE(pa::base64url_decode("not base64url!").has_value());
  CHECK(pa::base64url_decode("").value().empty());
}

TEST_CASE("a generated identity has a v4 UUID, a 32-byte public key, and verifiable signatures") {
  const auto identity = pa::Identity::generate();
  CHECK(std::regex_match(identity.device_id(),
                         std::regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")));
  const auto public_key = pa::base64url_decode(identity.public_key_base64url()).value();
  REQUIRE(public_key.size() == 32);

  const std::string nonce = "dGhlIHNlcnZlcidzIG5vbmNl";
  const auto signature = pa::base64url_decode(identity.sign_challenge(nonce)).value();
  REQUIRE(signature.size() == 64);
  CHECK(crypto_sign_verify_detached(signature.data(),
                                    reinterpret_cast<const unsigned char*>(nonce.data()),
                                    nonce.size(), public_key.data()) == 0);
  // A signature over a different nonce does not verify.
  const std::string other = "another nonce";
  CHECK(crypto_sign_verify_detached(signature.data(),
                                    reinterpret_cast<const unsigned char*>(other.data()),
                                    other.size(), public_key.data()) != 0);
}

TEST_CASE("RFC 8032 test vector 1: the seed gives the published public key and signature") {
  // RFC 8032 section 7.1, TEST 1 (empty message).
  const auto seed = *pa::base64url_decode("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A");
  const auto public_key = *pa::base64url_decode("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
  const auto identity = pa::Identity::from_seed("dev", "shop", seed,
                                                std::span<const std::uint8_t>(public_key));
  CHECK(identity.public_key_base64url() == "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
  CHECK(identity.sign_challenge("") ==
        "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc-bRr0lv18FlbviRlUUFDjnoQCw");
}

TEST_CASE("from_seed refuses a key pair that does not match") {
  const auto seed = std::vector<std::uint8_t>(32, 7);
  const auto wrong = std::vector<std::uint8_t>(32, 9);
  CHECK_THROWS_WITH(pa::Identity::from_seed("d", "s", seed, std::span<const std::uint8_t>(wrong)),
                    ContainsSubstring("does not match"));
}

TEST_CASE("the identity is stored DPAPI-sealed and reads back identically") {
  const auto dir = fresh_dir(L"pa-identity-test");
  auto identity = pa::Identity::generate();
  identity.set_shop_id("shop-123");
  pa::save_identity(identity, dir / L"identity.dat");

  const std::string raw = read_all(dir / L"identity.dat");
  CHECK(raw.find("secretKey") == std::string::npos);  // not plaintext on disk
  CHECK(raw.find(identity.device_id()) == std::string::npos);
  CHECK_FALSE(std::filesystem::exists(dir / L"identity.dat.tmp"));

  const auto loaded = pa::load_identity(dir / L"identity.dat", dir / L"identity.json");
  REQUIRE(loaded.has_value());
  CHECK(loaded->to_json() == identity.to_json());
  CHECK(loaded->sign_challenge("n") == identity.sign_challenge("n"));

  // A tampered file is refused, not silently accepted.
  std::string tampered = raw;
  tampered[tampered.size() / 2] = static_cast<char>(tampered[tampered.size() / 2] ^ 0x5A);
  std::ofstream(dir / L"identity.dat", std::ios::binary | std::ios::trunc) << tampered;
  CHECK_THROWS(pa::load_identity(dir / L"identity.dat", dir / L"identity.json"));
  std::filesystem::remove_all(dir);
}

TEST_CASE("an unpaired device has no identity") {
  const auto dir = fresh_dir(L"pa-identity-empty");
  CHECK_FALSE(pa::load_identity(dir / L"identity.dat", dir / L"identity.json").has_value());
  std::filesystem::remove_all(dir);
}

TEST_CASE("the Node agent's plaintext identity.json is imported, sealed, and then deleted") {
  const auto dir = fresh_dir(L"pa-identity-migrate");
  // RFC 8032 TEST 1 key, in the Node agent's JWK layout.
  std::ofstream(dir / L"identity.json") << R"({
    "deviceId": "0b5c5c1e-2f4a-4a55-9a0e-6c8e1f2d3b4a",
    "shopId": "shop-9",
    "publicKeyJwk": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    "privateKeyJwk": {"crv":"Ed25519","kty":"OKP",
                      "d":"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
                      "x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}
  })";
  const auto imported = pa::load_identity(dir / L"identity.dat", dir / L"identity.json");
  REQUIRE(imported.has_value());
  CHECK(imported->device_id() == "0b5c5c1e-2f4a-4a55-9a0e-6c8e1f2d3b4a");
  CHECK(imported->shop_id() == "shop-9");
  CHECK(imported->public_key_base64url() == "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
  CHECK_FALSE(std::filesystem::exists(dir / L"identity.json"));  // plaintext key gone
  CHECK(std::filesystem::exists(dir / L"identity.dat"));
  // And the next start reads the sealed copy.
  const auto again = pa::load_identity(dir / L"identity.dat", dir / L"identity.json");
  REQUIRE(again.has_value());
  CHECK(again->to_json() == imported->to_json());
  std::filesystem::remove_all(dir);
}

TEST_CASE("a broken identity.json is left in place with an explanation") {
  const auto dir = fresh_dir(L"pa-identity-broken");
  std::ofstream(dir / L"identity.json") << R"({"deviceId":"d","shopId":"s","publicKeyJwk":"AAAA",
    "privateKeyJwk":{"d":"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A"}})";
  CHECK_THROWS_WITH(pa::load_identity(dir / L"identity.dat", dir / L"identity.json"),
                    ContainsSubstring("does not match"));
  CHECK(std::filesystem::exists(dir / L"identity.json"));
  CHECK_FALSE(std::filesystem::exists(dir / L"identity.dat"));
  std::filesystem::remove_all(dir);
}
