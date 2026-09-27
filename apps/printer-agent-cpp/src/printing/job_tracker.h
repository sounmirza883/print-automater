#pragma once

#include <windows.h>

#include <optional>
#include <string>

#include "ledger/ledger.h"

namespace pa {

/// What one poll of the spooler says about OUR job (24.10).
struct SpoolerJobView {
  bool present = false;       // the job is still in the printer's queue
  DWORD status = 0;           // JOB_INFO_1::Status flags (JOB_STATUS_*)
  std::wstring status_text;   // JOB_INFO_1::pStatus, the driver's own words (may be empty)
};

/// 24.10: turns a sequence of spooler views of one job into PRINTED / FAILED / UNKNOWN. Pure
/// (no Win32 calls) so every path is unit-tested; the polling lives in print_monitor.
///
/// Improves on the Node agent's tracker, which had to guess which new queue entry was ours by
/// diffing the queue against a snapshot taken before submitting: here StartDoc handed us the
/// spooler's own job id, and errors come from the spooler's status FLAGS (paper jam, offline,
/// paper out, user intervention, blocked) with the driver's free text only as a backup.
///
/// Verdicts. Duplicate printing is the cardinal rule, so FAILED (which invites a reprint) is
/// only returned when the job cannot print any more, and anything uncertain is UNKNOWN for a
/// person to resolve. This is stricter than the Node agent, which called a job FAILED after any
/// error even though it could still print once the jam was cleared.
///  - the job reports JOB_STATUS_PRINTED/COMPLETE with no error seen  -> PRINTED
///  - the job leaves the queue with no error seen                       -> PRINTED
///    (EndDoc succeeded, so the spooler had the whole document, and it left the queue without
///    ever showing a problem; a job that never showed up at all simply finished before our
///    first poll, which happens on fast and virtual printers)
///  - the job was deleted from the queue (by staff, or the spooler)    -> FAILED
///  - the job leaves the queue after showing an error                   -> UNKNOWN
///  - still in the queue at the deadline                                -> UNKNOWN (it will print
///    once the printer is fixed, so it has not failed)
class PrintJobTracker {
 public:
  /// One poll. nullopt = the poll itself failed (tells us nothing). Returns a verdict once one
  /// is reached, else nullopt to keep polling.
  std::optional<JobResult> feed(const std::optional<SpoolerJobView>& view);

  /// The polling deadline passed without a verdict.
  JobResult on_timeout() const;

  bool saw_error() const { return saw_error_; }

 private:
  bool saw_error_ = false;
  bool deleted_ = false;
};

/// True when the flags or the driver's text describe a problem that needs a person.
bool is_error_state(const SpoolerJobView& view);

}  // namespace pa
