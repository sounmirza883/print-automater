#include "ledger/ledger.h"

#include <sqlite3.h>

#include "app/win.h"

#include <cstdio>
#include <ctime>

namespace pa {

namespace {

std::chrono::system_clock::time_point system_now() {
  return std::chrono::system_clock::now();
}

std::optional<JobResult> parse_result(const unsigned char* text) {
  if (text == nullptr) return std::nullopt;
  const std::string value(reinterpret_cast<const char*>(text));
  if (value == "PRINTED") return JobResult::Printed;
  if (value == "FAILED") return JobResult::Failed;
  if (value == "UNKNOWN") return JobResult::Unknown;
  throw LedgerError("The ledger holds an unknown result: " + value);
}

std::string column_text(sqlite3_stmt* stmt, int column) {
  const unsigned char* text = sqlite3_column_text(stmt, column);
  return text == nullptr ? std::string{} : std::string(reinterpret_cast<const char*>(text));
}

/// A prepared statement that finalises itself.
class Statement {
 public:
  Statement(sqlite3* db, const char* sql) : db_(db) {
    if (sqlite3_prepare_v2(db, sql, -1, &stmt_, nullptr) != SQLITE_OK) {
      throw LedgerError(std::string("Ledger statement failed to prepare: ") + sqlite3_errmsg(db));
    }
  }
  Statement(const Statement&) = delete;
  Statement& operator=(const Statement&) = delete;
  ~Statement() { sqlite3_finalize(stmt_); }

  void bind(int index, const std::string& value) {
    if (sqlite3_bind_text(stmt_, index, value.c_str(), static_cast<int>(value.size()),
                          SQLITE_TRANSIENT) != SQLITE_OK) {
      throw LedgerError(std::string("Ledger bind failed: ") + sqlite3_errmsg(db_));
    }
  }
  int step() { return sqlite3_step(stmt_); }
  sqlite3_stmt* get() const { return stmt_; }

 private:
  sqlite3* db_;
  sqlite3_stmt* stmt_ = nullptr;
};

LedgerRow read_row(sqlite3_stmt* stmt) {
  LedgerRow row;
  row.job_id = column_text(stmt, 0);
  row.order_id = column_text(stmt, 1);
  row.printer_name = column_text(stmt, 2);
  row.claimed_at = column_text(stmt, 3);
  row.result = parse_result(sqlite3_column_text(stmt, 4));
  if (sqlite3_column_type(stmt, 5) != SQLITE_NULL) row.result_at = column_text(stmt, 5);
  return row;
}

constexpr const char* kSelectColumns =
    "SELECT job_id, order_id, printer_name, claimed_at, result, result_at FROM job_ledger";

}  // namespace

const char* to_string(JobResult result) {
  switch (result) {
    case JobResult::Printed:
      return "PRINTED";
    case JobResult::Failed:
      return "FAILED";
    case JobResult::Unknown:
      return "UNKNOWN";
  }
  return "UNKNOWN";
}

std::string iso8601_utc(std::chrono::system_clock::time_point time) {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch());
  const std::time_t seconds = static_cast<std::time_t>(ms.count() / 1000);
  const int millis = static_cast<int>(ms.count() % 1000);
  std::tm utc{};
  gmtime_s(&utc, &seconds);
  char text[32];
  std::snprintf(text, sizeof text, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", utc.tm_year + 1900,
                utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec, millis);
  return text;
}

JobLedger::JobLedger(const std::filesystem::path& file) : clock_(&system_now) {
  const std::string utf8 = narrow(file.wstring());  // sqlite3_open_v2 takes UTF-8
  if (sqlite3_open_v2(utf8.c_str(), &db_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                      nullptr) != SQLITE_OK) {
    const std::string message = db_ ? sqlite3_errmsg(db_) : "out of memory";
    sqlite3_close(db_);
    db_ = nullptr;
    throw LedgerError("Could not open the job ledger: " + message);
  }
  // Another process reading the file (an inspection tool, a Node agent left running) makes a
  // write wait briefly instead of failing the claim.
  sqlite3_busy_timeout(db_, 5000);
  // WAL + FULL: every write must survive a hard power-off, not only a clean exit. That is the
  // whole reason this ledger exists.
  exec("PRAGMA journal_mode = WAL");
  exec("PRAGMA synchronous = FULL");
  exec(R"(CREATE TABLE IF NOT EXISTS job_ledger (
            job_id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            printer_name TEXT NOT NULL,
            claimed_at TEXT NOT NULL,
            result TEXT,
            result_at TEXT
          ))");
}

JobLedger::~JobLedger() {
  sqlite3_close(db_);
}

void JobLedger::exec(const char* sql) const {
  char* error = nullptr;
  if (sqlite3_exec(db_, sql, nullptr, nullptr, &error) != SQLITE_OK) {
    const std::string message = error ? error : "unknown error";
    sqlite3_free(error);
    throw LedgerError(std::string("Ledger statement failed: ") + message);
  }
}

std::string JobLedger::now_iso() const {
  return iso8601_utc(clock_());
}

void JobLedger::claim(const std::string& job_id, const std::string& order_id,
                      const std::string& printer_name) {
  std::lock_guard lock(mutex_);
  Statement stmt(db_,
                 "INSERT INTO job_ledger (job_id, order_id, printer_name, claimed_at) "
                 "VALUES (?, ?, ?, ?)");
  stmt.bind(1, job_id);
  stmt.bind(2, order_id);
  stmt.bind(3, printer_name);
  stmt.bind(4, now_iso());
  const int rc = stmt.step();
  if (rc == SQLITE_CONSTRAINT) {
    throw AlreadyClaimedError("Job " + job_id + " is already in the ledger.");
  }
  if (rc != SQLITE_DONE) {
    throw LedgerError(std::string("Ledger claim failed: ") + sqlite3_errmsg(db_));
  }
}

void JobLedger::record_result(const std::string& job_id, JobResult result) {
  std::lock_guard lock(mutex_);
  Statement stmt(db_, "UPDATE job_ledger SET result = ?, result_at = ? WHERE job_id = ?");
  stmt.bind(1, to_string(result));
  stmt.bind(2, now_iso());
  stmt.bind(3, job_id);
  if (stmt.step() != SQLITE_DONE) {
    throw LedgerError(std::string("Ledger update failed: ") + sqlite3_errmsg(db_));
  }
}

std::optional<LedgerRow> JobLedger::get(const std::string& job_id) const {
  std::lock_guard lock(mutex_);
  Statement stmt(db_, (std::string(kSelectColumns) + " WHERE job_id = ?").c_str());
  stmt.bind(1, job_id);
  const int rc = stmt.step();
  if (rc == SQLITE_ROW) return read_row(stmt.get());
  if (rc == SQLITE_DONE) return std::nullopt;
  throw LedgerError(std::string("Ledger read failed: ") + sqlite3_errmsg(db_));
}

std::vector<LedgerRow> JobLedger::unresolved() const {
  std::lock_guard lock(mutex_);
  Statement stmt(db_, (std::string(kSelectColumns) + " WHERE result IS NULL").c_str());
  std::vector<LedgerRow> rows;
  int rc;
  while ((rc = stmt.step()) == SQLITE_ROW) rows.push_back(read_row(stmt.get()));
  if (rc != SQLITE_DONE) {
    throw LedgerError(std::string("Ledger read failed: ") + sqlite3_errmsg(db_));
  }
  return rows;
}

int JobLedger::prune_old_resolved(std::chrono::milliseconds retention) {
  std::lock_guard lock(mutex_);
  const std::string cutoff = iso8601_utc(clock_() - retention);
  Statement stmt(db_,
                 "DELETE FROM job_ledger WHERE result IN ('PRINTED', 'FAILED') AND result_at < ?");
  stmt.bind(1, cutoff);
  if (stmt.step() != SQLITE_DONE) {
    throw LedgerError(std::string("Ledger prune failed: ") + sqlite3_errmsg(db_));
  }
  return sqlite3_changes(db_);
}

std::vector<LedgerRow> mark_unresolved_as_unknown(JobLedger& ledger) {
  std::vector<LedgerRow> rows = ledger.unresolved();
  for (const auto& row : rows) {
    ledger.record_result(row.job_id, JobResult::Unknown);
  }
  return rows;
}

}  // namespace pa
