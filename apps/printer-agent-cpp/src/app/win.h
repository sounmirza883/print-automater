#pragma once

#include <windows.h>

#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>

namespace pa {

/// A Win32 call failed. Carries the API name and GetLastError() so the log says exactly what
/// went wrong, never just "failed".
class Win32Error : public std::runtime_error {
 public:
  Win32Error(std::string_view api, DWORD code);
  DWORD code() const noexcept { return code_; }

 private:
  DWORD code_;
};

/// Throws Win32Error(api, GetLastError()).
[[noreturn]] void throw_last_error(std::string_view api);

/// UTF-8 <-> UTF-16 (Win32's wide strings). Invalid input throws std::runtime_error.
std::wstring widen(std::string_view utf8);
std::string narrow(std::wstring_view utf16);

/// Owns a Win32 HANDLE; closes it once.
class UniqueHandle {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE handle) noexcept : handle_(handle) {}
  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;
  UniqueHandle(UniqueHandle&& other) noexcept : handle_(other.release()) {}
  UniqueHandle& operator=(UniqueHandle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }
  ~UniqueHandle() { reset(); }

  HANDLE get() const noexcept { return handle_; }
  bool valid() const noexcept { return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE; }
  HANDLE release() noexcept {
    HANDLE h = handle_;
    handle_ = nullptr;
    return h;
  }
  void reset(HANDLE handle = nullptr) noexcept {
    if (valid()) CloseHandle(handle_);
    handle_ = handle;
  }

 private:
  HANDLE handle_ = nullptr;
};

/// Creates `file`, which must not exist yet, with a protected DACL holding one entry: full
/// control for the current Windows user. It inherits nothing from its folder, so no other
/// account on the machine (other users, services) can open it; the Win32 counterpart of the
/// Node agent's 0600. Returns the open handle (GENERIC_READ | GENERIC_WRITE).
UniqueHandle create_private_file(const std::filesystem::path& file);

/// The current user's SID as a string ("S-1-5-21-...").
std::wstring current_user_sid();

}  // namespace pa
