#include "identity/identity.h"

#include <windows.h>
#include <dpapi.h>

#include <nlohmann/json.hpp>

#include <cstdio>
#include <fstream>
#include <sstream>

#include "app/win.h"
#include "identity/base64url.h"

namespace pa {

namespace {

void ensure_sodium() {
  if (sodium_init() < 0) throw IdentityError("libsodium could not initialise.");
}

/// RFC 4122 version 4 UUID, lower-case, from libsodium's CSPRNG.
std::string random_uuid() {
  std::array<std::uint8_t, 16> bytes{};
  randombytes_buf(bytes.data(), bytes.size());
  bytes[6] = static_cast<std::uint8_t>((bytes[6] & 0x0F) | 0x40);
  bytes[8] = static_cast<std::uint8_t>((bytes[8] & 0x3F) | 0x80);
  char text[37];
  std::snprintf(text, sizeof text,
                "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", bytes[0],
                bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8],
                bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
  return text;
}

template <size_t N>
std::array<std::uint8_t, N> exact_bytes(const std::string& base64url, const char* what) {
  const auto decoded = base64url_decode(base64url);
  if (!decoded || decoded->size() != N) {
    throw IdentityError(std::string("The stored identity has an invalid ") + what + ".");
  }
  std::array<std::uint8_t, N> out{};
  std::copy(decoded->begin(), decoded->end(), out.begin());
  return out;
}

/// App-specific DPAPI entropy: another program running as the same user cannot unseal our
/// file just by calling CryptUnprotectData without knowing it.
constexpr char kEntropy[] = "PrintAutomated.Agent.Identity.v1";

std::string read_file(const std::filesystem::path& file) {
  std::ifstream in(file, std::ios::binary);
  if (!in) throw IdentityError("Could not open " + narrow(file.wstring()));
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

}  // namespace

Identity Identity::generate() {
  ensure_sodium();
  Identity identity;
  identity.device_id_ = random_uuid();
  crypto_sign_keypair(identity.public_key_.data(), identity.secret_key_.data());
  return identity;
}

Identity Identity::from_seed(std::string device_id, std::string shop_id,
                             std::span<const std::uint8_t> seed,
                             std::optional<std::span<const std::uint8_t>> expected_public_key) {
  ensure_sodium();
  if (seed.size() != crypto_sign_SEEDBYTES) {
    throw IdentityError("An Ed25519 seed must be 32 bytes.");
  }
  Identity identity;
  identity.device_id_ = std::move(device_id);
  identity.shop_id_ = std::move(shop_id);
  crypto_sign_seed_keypair(identity.public_key_.data(), identity.secret_key_.data(), seed.data());
  if (expected_public_key &&
      (expected_public_key->size() != kPublicKeyBytes ||
       sodium_memcmp(expected_public_key->data(), identity.public_key_.data(), kPublicKeyBytes) !=
           0)) {
    throw IdentityError("The imported private key does not match its public key.");
  }
  return identity;
}

Identity::Identity(const Identity&) = default;
Identity& Identity::operator=(const Identity&) = default;
Identity::Identity(Identity&& other) noexcept
    : device_id_(std::move(other.device_id_)),
      shop_id_(std::move(other.shop_id_)),
      public_key_(other.public_key_),
      secret_key_(other.secret_key_) {
  sodium_memzero(other.secret_key_.data(), other.secret_key_.size());
}
Identity& Identity::operator=(Identity&& other) noexcept {
  if (this != &other) {
    device_id_ = std::move(other.device_id_);
    shop_id_ = std::move(other.shop_id_);
    public_key_ = other.public_key_;
    secret_key_ = other.secret_key_;
    sodium_memzero(other.secret_key_.data(), other.secret_key_.size());
  }
  return *this;
}
Identity::~Identity() {
  sodium_memzero(secret_key_.data(), secret_key_.size());
}

std::string Identity::public_key_base64url() const {
  return base64url_encode(public_key_);
}

std::string Identity::sign_challenge(std::string_view nonce) const {
  std::array<std::uint8_t, crypto_sign_BYTES> signature{};
  crypto_sign_detached(signature.data(), nullptr,
                       reinterpret_cast<const unsigned char*>(nonce.data()), nonce.size(),
                       secret_key_.data());
  return base64url_encode(signature);
}

std::string Identity::to_json() const {
  nlohmann::json doc = {
      {"deviceId", device_id_},
      {"shopId", shop_id_},
      {"publicKey", base64url_encode(public_key_)},
      {"secretKey", base64url_encode(secret_key_)},
  };
  return doc.dump();
}

Identity Identity::from_json(std::string_view json) {
  nlohmann::json doc;
  try {
    doc = nlohmann::json::parse(json);
  } catch (const nlohmann::json::parse_error&) {
    throw IdentityError("The stored identity is not valid JSON.");
  }
  Identity identity;
  try {
    identity.device_id_ = doc.at("deviceId").get<std::string>();
    identity.shop_id_ = doc.at("shopId").get<std::string>();
    identity.public_key_ =
        exact_bytes<kPublicKeyBytes>(doc.at("publicKey").get<std::string>(), "public key");
    identity.secret_key_ =
        exact_bytes<kSecretKeyBytes>(doc.at("secretKey").get<std::string>(), "secret key");
  } catch (const nlohmann::json::exception&) {
    throw IdentityError("The stored identity is missing a field.");
  }
  // libsodium's secret key is seed || public key: the two halves must agree.
  if (sodium_memcmp(identity.secret_key_.data() + crypto_sign_SEEDBYTES, identity.public_key_.data(),
                    kPublicKeyBytes) != 0) {
    throw IdentityError("The stored identity's keys do not belong together.");
  }
  return identity;
}

std::string dpapi_seal(std::string_view plaintext) {
  DATA_BLOB in{static_cast<DWORD>(plaintext.size()),
               reinterpret_cast<BYTE*>(const_cast<char*>(plaintext.data()))};
  DATA_BLOB entropy{static_cast<DWORD>(sizeof kEntropy - 1),
                    reinterpret_cast<BYTE*>(const_cast<char*>(kEntropy))};
  DATA_BLOB out{};
  if (!CryptProtectData(&in, L"Print Automated agent identity", &entropy, nullptr, nullptr,
                        CRYPTPROTECT_UI_FORBIDDEN, &out)) {
    throw_last_error("CryptProtectData");
  }
  std::string sealed(reinterpret_cast<const char*>(out.pbData), out.cbData);
  LocalFree(out.pbData);
  return sealed;
}

std::string dpapi_unseal(std::string_view sealed) {
  DATA_BLOB in{static_cast<DWORD>(sealed.size()),
               reinterpret_cast<BYTE*>(const_cast<char*>(sealed.data()))};
  DATA_BLOB entropy{static_cast<DWORD>(sizeof kEntropy - 1),
                    reinterpret_cast<BYTE*>(const_cast<char*>(kEntropy))};
  DATA_BLOB out{};
  if (!CryptUnprotectData(&in, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN,
                          &out)) {
    throw_last_error("CryptUnprotectData");
  }
  std::string plaintext(reinterpret_cast<const char*>(out.pbData), out.cbData);
  SecureZeroMemory(out.pbData, out.cbData);
  LocalFree(out.pbData);
  return plaintext;
}

void save_identity(const Identity& identity, const std::filesystem::path& file) {
  std::string json = identity.to_json();
  const std::string sealed = dpapi_seal(json);
  sodium_memzero(json.data(), json.size());

  const std::filesystem::path temp = file.wstring() + L".tmp";
  {
    UniqueHandle handle(CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                    FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!handle.valid()) throw_last_error("CreateFileW(identity.dat.tmp)");
    DWORD written = 0;
    if (!WriteFile(handle.get(), sealed.data(), static_cast<DWORD>(sealed.size()), &written,
                   nullptr) ||
        written != sealed.size()) {
      throw_last_error("WriteFile(identity.dat.tmp)");
    }
    if (!FlushFileBuffers(handle.get())) throw_last_error("FlushFileBuffers(identity.dat.tmp)");
  }
  if (!MoveFileExW(temp.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    throw_last_error("MoveFileExW(identity.dat)");
  }
}

std::optional<Identity> load_identity(const std::filesystem::path& file,
                                      const std::filesystem::path& legacy_json_file) {
  if (std::filesystem::exists(file)) {
    std::string json = dpapi_unseal(read_file(file));
    Identity identity = Identity::from_json(json);
    sodium_memzero(json.data(), json.size());
    return identity;
  }
  if (!std::filesystem::exists(legacy_json_file)) {
    return std::nullopt;
  }

  // The Node agent's identity.json: {deviceId, shopId, publicKeyJwk: "<x>", privateKeyJwk: {d, x}}.
  std::string legacy = read_file(legacy_json_file);
  nlohmann::json doc;
  try {
    doc = nlohmann::json::parse(legacy);
  } catch (const nlohmann::json::parse_error&) {
    throw IdentityError("The Node agent's identity.json is not valid JSON; it was left in place.");
  }
  sodium_memzero(legacy.data(), legacy.size());
  std::optional<std::vector<std::uint8_t>> seed;
  std::optional<std::vector<std::uint8_t>> public_key;
  std::string device_id;
  std::string shop_id;
  try {
    device_id = doc.at("deviceId").get<std::string>();
    shop_id = doc.at("shopId").get<std::string>();
    public_key = base64url_decode(doc.at("publicKeyJwk").get<std::string>());
    seed = base64url_decode(doc.at("privateKeyJwk").at("d").get<std::string>());
  } catch (const nlohmann::json::exception&) {
    throw IdentityError("The Node agent's identity.json is missing a field; it was left in place.");
  }
  if (!seed || !public_key) {
    throw IdentityError("The Node agent's identity.json has an invalid key; it was left in place.");
  }
  Identity imported = Identity::from_seed(device_id, shop_id, *seed,
                                          std::span<const std::uint8_t>(*public_key));
  sodium_memzero(seed->data(), seed->size());

  save_identity(imported, file);
  // Only delete the plaintext once the sealed copy is known to read back identically.
  Identity reread = Identity::from_json(dpapi_unseal(read_file(file)));
  if (reread.to_json() != imported.to_json()) {
    throw IdentityError("The imported identity did not read back identically; identity.json kept.");
  }
  std::error_code ignored;
  std::filesystem::remove(legacy_json_file, ignored);
  return imported;
}

}  // namespace pa
