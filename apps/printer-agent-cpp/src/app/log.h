#pragma once

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace pa {

enum class LogLevel { Info, Warn, Error };

/// Structured logging: a message plus fields. Never pass secrets (tokens, keys, pairing codes)
/// or document contents as fields; job, order and printer ids are fine.
class Logger {
 public:
  virtual ~Logger() = default;
  virtual void write(LogLevel level, std::string_view message, const nlohmann::json& fields) = 0;

  void info(std::string_view message, const nlohmann::json& fields = nlohmann::json::object()) {
    write(LogLevel::Info, message, fields);
  }
  void warn(std::string_view message, const nlohmann::json& fields = nlohmann::json::object()) {
    write(LogLevel::Warn, message, fields);
  }
  void error(std::string_view message, const nlohmann::json& fields = nlohmann::json::object()) {
    write(LogLevel::Error, message, fields);
  }
};

/// JSON lines in logs\agent-YYYY-MM-DD.log (UTC dates), one file per day. Like the Node agent's
/// pino-roll setup it cannot fill the disk: 10 MB per day at most (then a single marker line)
/// and the 14 newest days are kept. Thread-safe; each line is written straight to the file,
/// so the log survives a crash up to the last line.
class FileLogger final : public Logger {
 public:
  explicit FileLogger(std::filesystem::path log_dir, std::uint64_t max_bytes_per_day = 10u << 20,
                      int keep_days = 14);
  FileLogger(const FileLogger&) = delete;
  FileLogger& operator=(const FileLogger&) = delete;
  ~FileLogger() override;

  void write(LogLevel level, std::string_view message, const nlohmann::json& fields) override;

 private:
  void open_for(const std::string& day);
  void prune_old_files() const;

  std::filesystem::path log_dir_;
  std::uint64_t max_bytes_;
  int keep_days_;
  std::mutex mutex_;
  void* file_ = nullptr;  // HANDLE
  std::string day_;
  std::uint64_t written_ = 0;
  bool capped_ = false;
};

/// Keeps lines in memory (tests).
class MemoryLogger final : public Logger {
 public:
  struct Line {
    LogLevel level;
    std::string message;
    nlohmann::json fields;
  };
  void write(LogLevel level, std::string_view message, const nlohmann::json& fields) override {
    std::lock_guard lock(mutex_);
    lines_.push_back({level, std::string(message), fields});
  }
  std::vector<Line> lines() const {
    std::lock_guard lock(mutex_);
    return lines_;
  }

 private:
  mutable std::mutex mutex_;
  std::vector<Line> lines_;
};

}  // namespace pa
