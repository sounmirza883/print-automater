#pragma once

#include <chrono>
#include <filesystem>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

struct sqlite3;

namespace pa {

/// 24.6 (ported exactly from the Node agent's ledger/ledger.ts; same file, same table, same
/// semantics). This is the duplicate-print protection:
///  - `claim()` inserts the job's row and, with journal_mode=WAL + synchronous=FULL, returns only
///    once it is durably on disk. It is called BEFORE the job is sent to the printer.
///  - `result` stays NULL until the outcome is known. A NULL row found at the next start means
///    "a previous run claimed this and never learned the outcome": the startup sweep marks it
///    UNKNOWN and it is never resubmitted (a human resolves it).
///  - job_id is the PRIMARY KEY: claiming the same job twice is an error, not a second row.
enum class JobResult { Printed, Failed, Unknown };

const char* to_string(JobResult result);

struct LedgerRow {
  std::string job_id;
  std::string order_id;
  std::string printer_name;
  std::string claimed_at;  // ISO-8601 UTC with milliseconds, like JavaScript's toISOString()
  std::optional<JobResult> result;
  std::optional<std::string> result_at;
};

class LedgerError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/// Thrown by claim() when the job already has a row (the primary key refused it).
class AlreadyClaimedError : public LedgerError {
 public:
  using LedgerError::LedgerError;
};

/// Thread-safe: the job loop and the hourly housekeeping share one ledger.
class JobLedger {
 public:
  explicit JobLedger(const std::filesystem::path& file);
  JobLedger(const JobLedger&) = delete;
  JobLedger& operator=(const JobLedger&) = delete;
  ~JobLedger();

  void claim(const std::string& job_id, const std::string& order_id,
             const std::string& printer_name);
  void record_result(const std::string& job_id, JobResult result);
  std::optional<LedgerRow> get(const std::string& job_id) const;
  std::vector<LedgerRow> unresolved() const;

  /// Deletes PRINTED and FAILED rows whose result is older than `retention`. NULL (in flight)
  /// and UNKNOWN rows are never pruned: an UNKNOWN row is this agent's only local evidence if
  /// that print is ever disputed. Returns how many rows were removed.
  int prune_old_resolved(std::chrono::milliseconds retention);

  /// For tests: the timestamp source (defaults to the system clock).
  using Clock = std::chrono::system_clock::time_point (*)();
  void set_clock_for_tests(Clock clock) { clock_ = clock; }

 private:
  void exec(const char* sql) const;
  std::string now_iso() const;
  mutable std::mutex mutex_;
  sqlite3* db_ = nullptr;
  Clock clock_;
};

/// Formats a time as JavaScript's Date.toISOString() does: "2026-09-28T07:05:09.123Z".
std::string iso8601_utc(std::chrono::system_clock::time_point time);

/// The startup sweep (ported from ledger/startup-sweep.ts): every unresolved row belongs to a
/// previous run, so it is marked UNKNOWN (never resubmitted). Returns the rows it marked, so
/// the caller can log each one and report UNKNOWN to the API.
std::vector<LedgerRow> mark_unresolved_as_unknown(JobLedger& ledger);

}  // namespace pa
