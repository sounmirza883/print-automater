#include "printing/job_tracker.h"

#include <winspool.h>

#include <algorithm>
#include <array>
#include <cwctype>
#include <string_view>

namespace pa {

namespace {

constexpr DWORD kErrorFlags = JOB_STATUS_ERROR | JOB_STATUS_OFFLINE | JOB_STATUS_PAPEROUT |
                              JOB_STATUS_USER_INTERVENTION | JOB_STATUS_BLOCKED_DEVQ;
constexpr DWORD kDoneFlags = JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE;
constexpr DWORD kDeletedFlags = JOB_STATUS_DELETING | JOB_STATUS_DELETED;

// The Node agent's ERROR_INDICATORS, for drivers that only say it in words; "toner" alone
// is narrowed to running out, since "Toner low" is a warning and the page still prints.
constexpr std::array<std::wstring_view, 12> kErrorWords = {
    L"error",        L"jam",           L"offline",      L"out of paper",
    L"no paper",     L"paper out",     L"door open",    L"intervention",
    L"out of memory", L"out of toner", L"no toner",     L"toner empty",
};

}  // namespace

bool is_error_state(const SpoolerJobView& view) {
  if ((view.status & kErrorFlags) != 0) return true;
  std::wstring text = view.status_text;
  std::transform(text.begin(), text.end(), text.begin(),
                 [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
  return std::any_of(kErrorWords.begin(), kErrorWords.end(),
                     [&](std::wstring_view word) { return text.find(word) != std::wstring::npos; });
}

std::optional<JobResult> PrintJobTracker::feed(const std::optional<SpoolerJobView>& view) {
  if (!view) return std::nullopt;  // the poll failed: no information either way

  if (!view->present) {
    if (deleted_) return JobResult::Failed;
    // After a problem, leaving the queue is ambiguous: staff may have cleared the jam and the
    // job printed. FAILED would invite a reprint, so a person decides.
    if (saw_error_) return JobResult::Unknown;
    return JobResult::Printed;
  }

  if (is_error_state(*view)) {
    // Keep polling: staff can clear a jam and the job carries on.
    saw_error_ = true;
  }
  if ((view->status & kDeletedFlags) != 0) deleted_ = true;
  if ((view->status & kDoneFlags) != 0 && !saw_error_ && !deleted_) {
    // Spoolers that keep printed documents in the queue say "done" instead of leaving.
    return JobResult::Printed;
  }
  return std::nullopt;
}

JobResult PrintJobTracker::on_timeout() const {
  // Still queued: once someone fixes the printer it will print, so it has not failed. Only a
  // job already being deleted will not print any more.
  return deleted_ ? JobResult::Failed : JobResult::Unknown;
}

}  // namespace pa
