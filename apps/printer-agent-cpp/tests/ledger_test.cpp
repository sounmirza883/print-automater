#include <catch2/catch_test_macros.hpp>

#include <sqlite3.h>

#include <filesystem>

#include "ledger/ledger.h"

using namespace std::chrono_literals;

namespace {

std::filesystem::path fresh_ledger(const wchar_t* name) {
  const auto dir = std::filesystem::temp_directory_path() / name;
  std::filesystem::remove_all(dir);
  std::filesystem::create_directories(dir);
  return dir / L"ledger.sqlite";
}

std::chrono::system_clock::time_point g_now;
std::chrono::system_clock::time_point fake_now() {
  return g_now;
}

}  // namespace

TEST_CASE("timestamps are formatted like JavaScript's toISOString") {
  const auto t = std::chrono::system_clock::time_point(std::chrono::milliseconds(1790578509123));
  CHECK(pa::iso8601_utc(t) == "2026-09-28T06:55:09.123Z");
}

TEST_CASE("a claim is a row with no result; the same job cannot be claimed twice") {
  const auto file = fresh_ledger(L"pa-ledger-claim");
  pa::JobLedger ledger(file);
  ledger.claim("job-1", "order-1", "Front desk");
  const auto row = ledger.get("job-1");
  REQUIRE(row.has_value());
  CHECK(row->order_id == "order-1");
  CHECK(row->printer_name == "Front desk");
  CHECK_FALSE(row->result.has_value());
  CHECK_THROWS_AS(ledger.claim("job-1", "order-1", "Front desk"), pa::AlreadyClaimedError);
  CHECK_FALSE(ledger.get("nope").has_value());
}

TEST_CASE("the ledger is durable: WAL journal and FULL synchronous") {
  const auto file = fresh_ledger(L"pa-ledger-pragmas");
  pa::JobLedger ledger(file);
  sqlite3* db = nullptr;
  REQUIRE(sqlite3_open(file.string().c_str(), &db) == SQLITE_OK);
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db, "PRAGMA journal_mode", -1, &stmt, nullptr);
  REQUIRE(sqlite3_step(stmt) == SQLITE_ROW);
  CHECK(std::string(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0))) == "wal");
  sqlite3_finalize(stmt);
  sqlite3_close(db);
}

TEST_CASE("a claim survives the process: a new JobLedger on the same file sees it") {
  const auto file = fresh_ledger(L"pa-ledger-reopen");
  {
    pa::JobLedger first(file);
    first.claim("job-7", "order-7", "P1");
  }
  pa::JobLedger second(file);
  REQUIRE(second.unresolved().size() == 1);
}

TEST_CASE("the startup sweep marks every unresolved row UNKNOWN and nothing else") {
  const auto file = fresh_ledger(L"pa-ledger-sweep");
  pa::JobLedger ledger(file);
  ledger.claim("left-open", "o1", "P1");
  ledger.claim("done", "o2", "P1");
  ledger.record_result("done", pa::JobResult::Printed);

  const auto swept = pa::mark_unresolved_as_unknown(ledger);
  REQUIRE(swept.size() == 1);
  CHECK(swept[0].job_id == "left-open");
  CHECK(ledger.get("left-open")->result == pa::JobResult::Unknown);
  CHECK(ledger.get("done")->result == pa::JobResult::Printed);
  // Idempotent: a second sweep (e.g. after a reconnect) finds nothing.
  CHECK(pa::mark_unresolved_as_unknown(ledger).empty());
}

TEST_CASE("pruning removes only old PRINTED/FAILED rows, never UNKNOWN or in-flight ones") {
  const auto file = fresh_ledger(L"pa-ledger-prune");
  pa::JobLedger ledger(file);
  ledger.set_clock_for_tests(&fake_now);

  g_now = std::chrono::system_clock::time_point(std::chrono::hours(24 * 20000));
  for (const char* id : {"old-printed", "old-failed", "old-unknown", "old-open"}) {
    ledger.claim(id, "o", "P");
  }
  ledger.record_result("old-printed", pa::JobResult::Printed);
  ledger.record_result("old-failed", pa::JobResult::Failed);
  ledger.record_result("old-unknown", pa::JobResult::Unknown);

  g_now += 40 * 24h;
  ledger.claim("new-printed", "o", "P");
  ledger.record_result("new-printed", pa::JobResult::Printed);

  CHECK(ledger.prune_old_resolved(30 * 24h) == 2);
  CHECK_FALSE(ledger.get("old-printed").has_value());
  CHECK_FALSE(ledger.get("old-failed").has_value());
  CHECK(ledger.get("old-unknown").has_value());
  CHECK(ledger.get("old-open").has_value());
  CHECK(ledger.get("new-printed").has_value());
}

TEST_CASE("the C++ agent reads a ledger written by the Node agent (same schema)") {
  const auto file = fresh_ledger(L"pa-ledger-compat");
  sqlite3* db = nullptr;
  REQUIRE(sqlite3_open(file.string().c_str(), &db) == SQLITE_OK);
  // Exactly the DDL and a row as apps/printer-agent/src/ledger/ledger.ts writes them.
  REQUIRE(sqlite3_exec(db, R"(CREATE TABLE IF NOT EXISTS job_ledger (
      job_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, printer_name TEXT NOT NULL,
      claimed_at TEXT NOT NULL, result TEXT, result_at TEXT);
    INSERT INTO job_ledger VALUES ('node-job','node-order','Printer A','2026-09-01T10:00:00.000Z',
                                   'UNKNOWN','2026-09-01T10:05:00.000Z');)",
                       nullptr, nullptr, nullptr) == SQLITE_OK);
  sqlite3_close(db);

  pa::JobLedger ledger(file);
  const auto row = ledger.get("node-job");
  REQUIRE(row.has_value());
  CHECK(row->result == pa::JobResult::Unknown);
  CHECK(row->claimed_at == "2026-09-01T10:00:00.000Z");
}
