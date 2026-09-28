#include <catch2/catch_test_macros.hpp>

#include <windows.h>
#include <winspool.h>

#include "printing/job_tracker.h"
#include "printing/print_monitor.h"

namespace {

pa::SpoolerJobView queued(DWORD status = JOB_STATUS_SPOOLING, std::wstring text = L"") {
  return pa::SpoolerJobView{true, status, std::move(text)};
}
pa::SpoolerJobView gone() {
  return pa::SpoolerJobView{false, 0, L""};
}

}  // namespace

TEST_CASE("a job that leaves the queue cleanly printed") {
  pa::PrintJobTracker tracker;
  CHECK_FALSE(tracker.feed(queued()).has_value());
  CHECK_FALSE(tracker.feed(queued(JOB_STATUS_PRINTING)).has_value());
  CHECK(tracker.feed(gone()) == pa::JobResult::Printed);
}

TEST_CASE("a job that finished before the first poll printed (fast or virtual printers)") {
  pa::PrintJobTracker tracker;
  CHECK(tracker.feed(gone()) == pa::JobResult::Printed);
}

TEST_CASE("a job the spooler marks printed but keeps in the queue printed") {
  pa::PrintJobTracker tracker;
  CHECK(tracker.feed(queued(JOB_STATUS_PRINTED)) == pa::JobResult::Printed);
}

TEST_CASE("a job that leaves the queue after an error is UNKNOWN: it may have printed once cleared") {
  pa::PrintJobTracker tracker;
  CHECK_FALSE(tracker.feed(queued(JOB_STATUS_PAPEROUT)).has_value());
  CHECK(tracker.saw_error());
  CHECK_FALSE(tracker.feed(queued(JOB_STATUS_PRINTING)).has_value());
  CHECK(tracker.feed(gone()) == pa::JobResult::Unknown);
}

TEST_CASE("after an error, even the spooler's printed flag is left to a person") {
  pa::PrintJobTracker tracker;
  tracker.feed(queued(JOB_STATUS_ERROR));
  CHECK_FALSE(tracker.feed(queued(JOB_STATUS_PRINTED)).has_value());
  CHECK(tracker.feed(gone()) == pa::JobResult::Unknown);
}

TEST_CASE("a driver that only reports the problem in words is still caught") {
  pa::PrintJobTracker tracker;
  tracker.feed(queued(JOB_STATUS_PRINTING, L"Paper Jam in tray 2"));
  CHECK(tracker.saw_error());
  CHECK(tracker.feed(gone()) == pa::JobResult::Unknown);
}

TEST_CASE("a job someone deleted from the queue failed, with or without an error first") {
  pa::PrintJobTracker tracker;
  tracker.feed(queued(JOB_STATUS_DELETING));
  CHECK(tracker.feed(gone()) == pa::JobResult::Failed);

  pa::PrintJobTracker jammed_then_cancelled;
  jammed_then_cancelled.feed(queued(JOB_STATUS_PAPEROUT));
  jammed_then_cancelled.feed(queued(JOB_STATUS_PAPEROUT | JOB_STATUS_DELETING));
  CHECK(jammed_then_cancelled.feed(gone()) == pa::JobResult::Failed);
}

TEST_CASE("a failed poll says nothing and never ends tracking") {
  pa::PrintJobTracker tracker;
  CHECK_FALSE(tracker.feed(std::nullopt).has_value());
  CHECK_FALSE(tracker.feed(std::nullopt).has_value());
  CHECK(tracker.on_timeout() == pa::JobResult::Unknown);
}

TEST_CASE("still queued at the deadline is UNKNOWN, even in error: it prints once fixed") {
  pa::PrintJobTracker quiet;
  quiet.feed(queued());
  CHECK(quiet.on_timeout() == pa::JobResult::Unknown);

  pa::PrintJobTracker stuck;
  stuck.feed(queued(JOB_STATUS_OFFLINE));
  CHECK(stuck.on_timeout() == pa::JobResult::Unknown);

  pa::PrintJobTracker being_deleted;
  being_deleted.feed(queued(JOB_STATUS_DELETING));
  CHECK(being_deleted.on_timeout() == pa::JobResult::Failed);
}

TEST_CASE("a normal status is not an error") {
  CHECK_FALSE(pa::is_error_state(queued(JOB_STATUS_PRINTING, L"Printing")));
  CHECK_FALSE(pa::is_error_state(queued(JOB_STATUS_PAUSED)));  // a pause is not a failure
  CHECK(pa::is_error_state(queued(JOB_STATUS_USER_INTERVENTION)));
  CHECK_FALSE(pa::is_error_state(queued(0, L"Toner low")));  // a warning; the page prints
  CHECK(pa::is_error_state(queued(0, L"Out of toner")));
  CHECK(pa::is_error_state(queued(0, L"Paper out")));
}

TEST_CASE("the spooler is watched every 2 seconds for up to 5 minutes, as the Node agent did") {
  const pa::MonitorOptions defaults;
  CHECK(defaults.poll == std::chrono::seconds(2));
  CHECK(defaults.timeout == std::chrono::minutes(5));
}
