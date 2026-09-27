#include "printing/print_monitor.h"

#include <winspool.h>

#include <vector>

#include "app/stop.h"
#include "app/win.h"

namespace pa {

std::optional<SpoolerJobView> query_spooler_job(const std::string& printer_name, DWORD job_id) {
  std::wstring name;
  try {
    name = widen(printer_name);
  } catch (const std::exception&) {
    return std::nullopt;
  }
  HANDLE printer = nullptr;
  if (!OpenPrinterW(name.data(), &printer, nullptr)) return std::nullopt;
  struct Closer {
    HANDLE handle;
    ~Closer() { ClosePrinter(handle); }
  } closer{printer};

  DWORD needed = 0;
  if (!GetJobW(printer, job_id, 1, nullptr, 0, &needed)) {
    const DWORD error = GetLastError();
    // The spooler no longer knows the id: the job has left the queue.
    if (error == ERROR_INVALID_PARAMETER) return SpoolerJobView{false, 0, L""};
    if (error != ERROR_INSUFFICIENT_BUFFER) return std::nullopt;
  }
  std::vector<BYTE> buffer(needed);
  if (!GetJobW(printer, job_id, 1, buffer.data(), needed, &needed)) {
    if (GetLastError() == ERROR_INVALID_PARAMETER) return SpoolerJobView{false, 0, L""};
    return std::nullopt;
  }
  const auto* job = reinterpret_cast<const JOB_INFO_1W*>(buffer.data());
  return SpoolerJobView{true, job->Status, job->pStatus != nullptr ? job->pStatus : L""};
}

std::optional<JobResult> monitor_spooler_job(const std::string& printer_name, DWORD job_id,
                                             std::stop_token stop, const MonitorOptions& options) {
  PrintJobTracker tracker;
  const auto deadline = std::chrono::steady_clock::now() + options.timeout;
  while (std::chrono::steady_clock::now() < deadline) {
    if (auto verdict = tracker.feed(query_spooler_job(printer_name, job_id))) return verdict;
    if (!sleep_unless_stopped(stop, options.poll)) return std::nullopt;
  }
  return tracker.on_timeout();
}

}  // namespace pa
