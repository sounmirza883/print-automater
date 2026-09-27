#include "app/win.h"

#include <sddl.h>

#include <climits>
#include <memory>
#include <sstream>
#include <vector>

namespace pa {

namespace {

std::string describe(std::string_view api, DWORD code) {
  wchar_t* buffer = nullptr;
  const DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, code, 0, reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
  std::string text;
  if (length > 0 && buffer != nullptr) {
    std::wstring message(buffer, length);
    while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n' ||
                                message.back() == L' ' || message.back() == L'.')) {
      message.pop_back();
    }
    try {
      text = narrow(message);
    } catch (...) {
      text.clear();
    }
  }
  if (buffer != nullptr) LocalFree(buffer);
  std::ostringstream out;
  out << api << " failed (error " << code << (text.empty() ? "" : ": ") << text << ")";
  return out.str();
}

}  // namespace

Win32Error::Win32Error(std::string_view api, DWORD code)
    : std::runtime_error(describe(api, code)), code_(code) {}

void throw_last_error(std::string_view api) {
  throw Win32Error(api, GetLastError());
}

std::wstring widen(std::string_view utf8) {
  if (utf8.empty()) return {};
  if (utf8.size() > static_cast<size_t>(INT_MAX)) throw std::runtime_error("string too long");
  const int size = static_cast<int>(utf8.size());
  const int needed =
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), size, nullptr, 0);
  if (needed <= 0) throw std::runtime_error("invalid UTF-8");
  std::wstring out(static_cast<size_t>(needed), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), size, out.data(), needed);
  return out;
}

std::string narrow(std::wstring_view utf16) {
  if (utf16.empty()) return {};
  if (utf16.size() > static_cast<size_t>(INT_MAX)) throw std::runtime_error("string too long");
  const int size = static_cast<int>(utf16.size());
  const int needed = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, utf16.data(), size,
                                         nullptr, 0, nullptr, nullptr);
  if (needed <= 0) throw std::runtime_error("invalid UTF-16");
  std::string out(static_cast<size_t>(needed), '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, utf16.data(), size, out.data(), needed,
                      nullptr, nullptr);
  return out;
}

std::wstring current_user_sid() {
  HANDLE raw_token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw_token)) {
    throw_last_error("OpenProcessToken");
  }
  UniqueHandle token(raw_token);
  DWORD size = 0;
  GetTokenInformation(token.get(), TokenUser, nullptr, 0, &size);
  if (size == 0) throw_last_error("GetTokenInformation");
  std::vector<BYTE> buffer(size);
  if (!GetTokenInformation(token.get(), TokenUser, buffer.data(), size, &size)) {
    throw_last_error("GetTokenInformation");
  }
  wchar_t* text = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid, &text)) {
    throw_last_error("ConvertSidToStringSidW");
  }
  std::wstring sid(text);
  LocalFree(text);
  return sid;
}

UniqueHandle create_private_file(const std::filesystem::path& file) {
  // D: DACL, P: protected (no inherited entries), one ACE: Allow, File All access, this user.
  const std::wstring sddl = L"D:P(A;;FA;;;" + current_user_sid() + L")";
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1,
                                                            &descriptor, nullptr)) {
    throw_last_error("ConvertStringSecurityDescriptorToSecurityDescriptorW");
  }
  std::unique_ptr<void, decltype(&LocalFree)> owned(descriptor, &LocalFree);
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  UniqueHandle handle(CreateFileW(file.c_str(), GENERIC_READ | GENERIC_WRITE, 0, &attributes,
                                  CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!handle.valid()) throw_last_error("CreateFileW");
  return handle;
}

}  // namespace pa
