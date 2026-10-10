#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>

#include "backend/session.h"

using namespace std::chrono_literals;

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

pa::AuthSession sample_session(std::chrono::system_clock::time_point expires_at) {
  pa::AuthSession session;
  session.user = {"user-1", "Jess Printer", "jess@example.com", "SHOP_OWNER"};
  session.access_token = "access-token-value";
  session.refresh_token = "refresh-token-value";
  session.access_token_expires_at = expires_at;
  return session;
}

}  // namespace

TEST_CASE("a fresh Session has no current() until set()") {
  const auto dir = fresh_dir(L"pa-session-empty");
  pa::Session session(dir / L"session.dat");
  CHECK_FALSE(session.current().has_value());
  CHECK(session.access_token_near_expiry());  // no session at all counts as "needs a refresh"
  CHECK_FALSE(session.load_persisted().has_value());
  std::filesystem::remove_all(dir);
}

TEST_CASE("set() persists the refresh token DPAPI-sealed, not in plaintext") {
  const auto dir = fresh_dir(L"pa-session-set");
  pa::Session session(dir / L"session.dat");
  session.set(sample_session(std::chrono::system_clock::now() + 15min));

  REQUIRE(session.current().has_value());
  CHECK(session.current()->user.email == "jess@example.com");

  const std::string raw = read_all(dir / L"session.dat");
  CHECK(raw.find("refresh-token-value") == std::string::npos);
  CHECK(raw.find("jess@example.com") == std::string::npos);
  CHECK_FALSE(std::filesystem::exists(dir / L"session.dat.tmp"));
  std::filesystem::remove_all(dir);
}

TEST_CASE("load_persisted round-trips the user and refresh token across a fresh Session") {
  const auto dir = fresh_dir(L"pa-session-roundtrip");
  {
    pa::Session session(dir / L"session.dat");
    session.set(sample_session(std::chrono::system_clock::now() + 15min));
  }
  pa::Session reloaded(dir / L"session.dat");
  CHECK_FALSE(reloaded.current().has_value());  // persistence is disk-only, not shared state
  const auto persisted = reloaded.load_persisted();
  REQUIRE(persisted.has_value());
  CHECK(persisted->first.id == "user-1");
  CHECK(persisted->first.email == "jess@example.com");
  CHECK(persisted->second == "refresh-token-value");
  std::filesystem::remove_all(dir);
}

TEST_CASE("clear() drops the in-memory session and deletes the persisted file") {
  const auto dir = fresh_dir(L"pa-session-clear");
  pa::Session session(dir / L"session.dat");
  session.set(sample_session(std::chrono::system_clock::now() + 15min));
  REQUIRE(std::filesystem::exists(dir / L"session.dat"));

  session.clear();
  CHECK_FALSE(session.current().has_value());
  CHECK_FALSE(std::filesystem::exists(dir / L"session.dat"));
  std::filesystem::remove_all(dir);
}

TEST_CASE("access_token_near_expiry is true once within the skew window, false well before it") {
  const auto dir = fresh_dir(L"pa-session-expiry");
  pa::Session session(dir / L"session.dat");
  session.set(sample_session(std::chrono::system_clock::now() + 15min));
  CHECK_FALSE(session.access_token_near_expiry(30s));

  session.set(sample_session(std::chrono::system_clock::now() + 10s));
  CHECK(session.access_token_near_expiry(30s));

  session.set(sample_session(std::chrono::system_clock::now() - 1min));  // already expired
  CHECK(session.access_token_near_expiry(30s));
  std::filesystem::remove_all(dir);
}

TEST_CASE("clear() on a session that was never set() is harmless (logout with nothing to clear)") {
  const auto dir = fresh_dir(L"pa-session-clear-empty");
  pa::Session session(dir / L"session.dat");
  session.clear();
  CHECK_FALSE(session.current().has_value());
  CHECK_FALSE(std::filesystem::exists(dir / L"session.dat"));
  std::filesystem::remove_all(dir);
}

TEST_CASE("a session can be set() again after clear(), e.g. signing back in after logout") {
  const auto dir = fresh_dir(L"pa-session-clear-then-set");
  pa::Session session(dir / L"session.dat");
  session.set(sample_session(std::chrono::system_clock::now() + 15min));
  session.clear();

  pa::AuthSession second = sample_session(std::chrono::system_clock::now() + 15min);
  second.user.email = "someone-else@example.com";
  session.set(second);

  REQUIRE(session.current().has_value());
  CHECK(session.current()->user.email == "someone-else@example.com");
  CHECK(std::filesystem::exists(dir / L"session.dat"));
  std::filesystem::remove_all(dir);
}

TEST_CASE("a corrupted session file is treated as no persisted session, not a crash") {
  const auto dir = fresh_dir(L"pa-session-corrupt");
  pa::Session session(dir / L"session.dat");
  session.set(sample_session(std::chrono::system_clock::now() + 15min));

  std::string raw = read_all(dir / L"session.dat");
  raw[raw.size() / 2] = static_cast<char>(raw[raw.size() / 2] ^ 0x5A);
  std::ofstream(dir / L"session.dat", std::ios::binary | std::ios::trunc) << raw;

  pa::Session reloaded(dir / L"session.dat");
  CHECK_FALSE(reloaded.load_persisted().has_value());
  std::filesystem::remove_all(dir);
}
