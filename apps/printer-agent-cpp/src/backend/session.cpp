#include "backend/session.h"

#include <nlohmann/json.hpp>

#include <fstream>
#include <sstream>

#include "identity/identity.h"  // dpapi_seal / dpapi_unseal

namespace pa {

namespace {

std::string read_file(const std::filesystem::path& file) {
  std::ifstream in(file, std::ios::binary);
  if (!in) throw std::runtime_error("Could not open the session file.");
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

}  // namespace

Session::Session(std::filesystem::path session_file) : session_file_(std::move(session_file)) {}

void Session::set(AuthSession session) {
  std::lock_guard lock(mutex_);
  save_to_disk(session);
  session_ = std::move(session);
}

void Session::clear() {
  std::lock_guard lock(mutex_);
  session_.reset();
  std::error_code ignored;
  std::filesystem::remove(session_file_, ignored);
}

std::optional<AuthSession> Session::current() const {
  std::lock_guard lock(mutex_);
  return session_;
}

bool Session::access_token_near_expiry(std::chrono::seconds skew) const {
  std::lock_guard lock(mutex_);
  if (!session_) return true;
  return std::chrono::system_clock::now() + skew >= session_->access_token_expires_at;
}

void Session::save_to_disk(const AuthSession& session) const {
  nlohmann::json doc = {
      {"userId", session.user.id},
      {"userName", session.user.name},
      {"userEmail", session.user.email},
      {"userRole", session.user.role},
      {"refreshToken", session.refresh_token},
  };
  std::string json = doc.dump();
  const std::string sealed = dpapi_seal(json);

  const std::filesystem::path temp = session_file_.wstring() + L".tmp";
  {
    std::ofstream out(temp, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("Could not write the session file.");
    out.write(sealed.data(), static_cast<std::streamsize>(sealed.size()));
    if (!out) throw std::runtime_error("Could not write the session file.");
  }
  std::error_code rename_error;
  std::filesystem::rename(temp, session_file_, rename_error);
  if (rename_error) {
    std::error_code ignored;
    std::filesystem::remove(temp, ignored);
    throw std::runtime_error("Could not save the session file: " + rename_error.message());
  }
}

std::optional<std::pair<StaffUser, std::string>> Session::load_persisted() const {
  if (!std::filesystem::exists(session_file_)) return std::nullopt;
  std::string json;
  try {
    json = dpapi_unseal(read_file(session_file_));
  } catch (...) {
    return std::nullopt;
  }
  nlohmann::json doc;
  try {
    doc = nlohmann::json::parse(json);
  } catch (const nlohmann::json::parse_error&) {
    return std::nullopt;
  }
  if (!doc.is_object() || !doc.contains("refreshToken") || !doc["refreshToken"].is_string()) {
    return std::nullopt;
  }
  StaffUser user;
  user.id = doc.value("userId", std::string{});
  user.name = doc.value("userName", std::string{});
  user.email = doc.value("userEmail", std::string{});
  user.role = doc.value("userRole", std::string{});
  return std::make_pair(std::move(user), doc["refreshToken"].get<std::string>());
}

}  // namespace pa
