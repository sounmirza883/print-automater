#pragma once

#include <sodium.h>

#include <array>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>

namespace pa {

/// 24.3 (ported from the Node agent's config/identity-store.ts). An Ed25519 keypair generated
/// on this machine, once, at pairing. Only the public key ever leaves it: POST
/// /agents/register sends it (raw 32 bytes, base64url), and afterwards the agent proves
/// possession by signing the server's challenge nonce. `device_id` is minted with the keys
/// and never changes; the server treats (deviceId, publicKey) as one identity.
class Identity {
 public:
  static constexpr size_t kPublicKeyBytes = crypto_sign_PUBLICKEYBYTES;
  static constexpr size_t kSecretKeyBytes = crypto_sign_SECRETKEYBYTES;

  /// New random keys and device id; `shop_id` is empty until registration answers.
  static Identity generate();

  /// Rebuilds from a 32-byte Ed25519 seed (the Node agent's JWK `d`); checks the derived public
  /// key against `expected_public_key` when given.
  static Identity from_seed(std::string device_id, std::string shop_id,
                            std::span<const std::uint8_t> seed,
                            std::optional<std::span<const std::uint8_t>> expected_public_key);

  Identity(const Identity&);
  Identity& operator=(const Identity&);
  Identity(Identity&&) noexcept;
  Identity& operator=(Identity&&) noexcept;
  ~Identity();  // wipes the secret key

  const std::string& device_id() const { return device_id_; }
  const std::string& shop_id() const { return shop_id_; }
  void set_shop_id(std::string shop_id) { shop_id_ = std::move(shop_id); }

  /// The public key as POST /agents/register expects it: raw 32 bytes, base64url.
  std::string public_key_base64url() const;

  /// Signs the raw UTF-8 bytes of the server's nonce; returns the signature base64url-encoded,
  /// exactly what services/api's verifyEd25519Signature checks.
  std::string sign_challenge(std::string_view nonce) const;

  /// Serialised form for sealing: {"deviceId","shopId","publicKey","secretKey"} (base64url).
  std::string to_json() const;
  static Identity from_json(std::string_view json);

 private:
  Identity() = default;
  std::string device_id_;
  std::string shop_id_;
  std::array<std::uint8_t, kPublicKeyBytes> public_key_{};
  std::array<std::uint8_t, kSecretKeyBytes> secret_key_{};
};

class IdentityError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/// DPAPI seal/unseal for the current Windows user (CryptProtectData, no UI). Only this user on
/// this machine can unseal: a copied identity.dat is useless elsewhere.
std::string dpapi_seal(std::string_view plaintext);
std::string dpapi_unseal(std::string_view sealed);

/// identity.dat: the identity JSON sealed with DPAPI, written atomically (temp file, flushed,
/// then renamed over the old one) so a crash mid-write never leaves a half-written key.
void save_identity(const Identity& identity, const std::filesystem::path& file);

/// Loads identity.dat. If it is missing but the Node agent's plaintext identity.json exists,
/// imports that (checking its key pair), seals it into identity.dat, verifies the sealed copy
/// reads back identically, and only then deletes identity.json, so the private key is never
/// left in plaintext and a machine moving from the Node agent does not have to re-pair.
/// nullopt when the device has never been paired.
std::optional<Identity> load_identity(const std::filesystem::path& file,
                                      const std::filesystem::path& legacy_json_file);

}  // namespace pa
