#pragma once

#include <windows.h>

#include <chrono>
#include <optional>
#include <stop_token>
#include <string>

#include "ledger/ledger.h"
#include "printing/job_tracker.h"

namespace pa {

struct MonitorOptions {
  std::chrono::milliseconds poll{2000};     // the Node agent's interval
  std::chrono::milliseconds timeout{300000};  // and its five-minute deadline
};

/// One look at a spooler job (GetJob, level 1). `present` false once the job has left the
/// queue; nullopt when the spooler could not be asked (the printer could not be opened).
std::optional<SpoolerJobView> query_spooler_job(const std::string& printer_name, DWORD job_id);

/// 24.10: polls the spooler job that print_pdf started until PrintJobTracker reaches a verdict
/// or the deadline passes. nullopt when `stop` (shutdown) interrupts it: the ledger row then
/// stays unresolved and the next start marks it UNKNOWN, never a guess.
std::optional<JobResult> monitor_spooler_job(const std::string& printer_name, DWORD job_id,
                                             std::stop_token stop,
                                             const MonitorOptions& options = {});

}  // namespace pa
