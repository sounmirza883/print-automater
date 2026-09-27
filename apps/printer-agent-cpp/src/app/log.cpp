#include "app/log.h"

#include <windows.h>

#include <algorithm>
#include <chrono>

#include "ledger/ledger.h"

namespace pa {

namespace {

const char* level_name(LogLevel level) {
  switch (level) {
    case LogLevel::Info: return "info";
    case LogLevel::Warn: return "warn";
    case LogLevel::Error: return "error";
  }
  return "info";
}

}  // namespace

FileLogger::FileLogger(std::filesystem::path log_dir, std::uint64_t max_bytes_per_day,
                       int keep_days)
    : log_dir_(std::move(log_dir)), max_bytes_(max_bytes_per_day), keep_days_(keep_days) {}

FileLogger::~FileLogger() {
  if (file_ != nullptr) CloseHandle(file_);
}

void FileLogger::open_for(const std::string& day) {
  if (file_ != nullptr) CloseHandle(file_);
  file_ = nullptr;
  day_ = day;
  capped_ = false;
  written_ = 0;
  std::error_code ignored;
  std::filesystem::create_directories(log_dir_, ignored);
  const auto path = log_dir_ / (L"agent-" + std::wstring(day.begin(), day.end()) + L".log");
  HANDLE handle = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return;  // logging must never stop the agent
  file_ = handle;
  LARGE_INTEGER size{};
  if (GetFileSizeEx(handle, &size)) written_ = static_cast<std::uint64_t>(size.QuadPart);
  capped_ = written_ >= max_bytes_;
  prune_old_files();
}

void FileLogger::prune_old_files() const {
  std::vector<std::filesystem::path> logs;
  std::error_code error;
  for (const auto& entry : std::filesystem::directory_iterator(log_dir_, error)) {
    const auto name = entry.path().filename().wstring();
    if (name.starts_with(L"agent-") && name.ends_with(L".log")) logs.push_back(entry.path());
  }
  if (static_cast<int>(logs.size()) <= keep_days_) return;
  std::sort(logs.begin(), logs.end());  // agent-YYYY-MM-DD sorts by date
  for (size_t i = 0; i + static_cast<size_t>(keep_days_) < logs.size(); ++i) {
    std::filesystem::remove(logs[i], error);
  }
}

void FileLogger::write(LogLevel level, std::string_view message, const nlohmann::json& fields) {
  const std::string time = iso8601_utc(std::chrono::system_clock::now());
  nlohmann::json line = fields.is_object() ? fields : nlohmann::json::object();
  line["time"] = time;
  line["level"] = level_name(level);
  line["msg"] = message;
  line["pid"] = GetCurrentProcessId();
  std::string text = line.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + "\n";

  std::lock_guard lock(mutex_);
  const std::string day = time.substr(0, 10);
  if (day != day_) open_for(day);
  if (file_ == nullptr || capped_) return;
  if (written_ + text.size() > max_bytes_) {
    capped_ = true;
    text = R"({"time":")" + time +
           R"(","level":"warn","msg":"daily log size limit reached; further lines today are dropped"})" +
           "\n";
  }
  DWORD done = 0;
  if (WriteFile(static_cast<HANDLE>(file_), text.data(), static_cast<DWORD>(text.size()), &done,
                nullptr)) {
    written_ += done;
  }
}

}  // namespace pa
