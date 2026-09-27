#pragma once

#include <windows.h>

#include <chrono>
#include <filesystem>
#include <optional>
#include <stop_token>
#include <string>

#include "app/log.h"
#include "backend/backend_client.h"
#include "backend/status_reporter.h"
#include "ledger/ledger.h"
#include "printing/pdf_printer.h"
#include "printing/print_settings.h"

namespace pa {

/// The API calls the job processor makes. In the agent this is BackendJobApi (the backend
/// client plus the cached access token); tests use a scripted fake.
class JobApi {
 public:
  virtual ~JobApi() = default;
  virtual std::optional<PrintJobSummary> poll(std::chrono::seconds wait) = 0;
  /// A lost claim race surfaces as BackendError with status 409.
  virtual PrintJobSummary claim(const std::string& job_id) = 0;
  virtual void download(const std::string& job_id, const std::filesystem::path& file) = 0;
  virtual void report(const std::string& job_id, ReportedStatus status,
                      const std::string& idempotency_key,
                      const std::optional<std::string>& os_job_id) = 0;
};

/// Printing and watching the spooler. In the agent: print_pdf and monitor_spooler_job.
class JobPrinter {
 public:
  virtual ~JobPrinter() = default;
  /// Throws PrintFailure; its stage says whether paper could have been affected.
  virtual SubmittedPrint print(const std::filesystem::path& document, const PrintJobSummary& job,
                               const PrintSettings& settings) = 0;
  /// nullopt when `stop` interrupted the watch.
  virtual std::optional<JobResult> monitor(const std::string& printer_name, DWORD spool_job_id,
                                           std::stop_token stop) = 0;
};

struct JobProcessorOptions {
  std::filesystem::path tmp_dir;
  std::chrono::seconds poll_wait{20};
  /// Safe print failures only (nothing reached the spooler); the Node agent's numbers.
  int max_print_attempts = 3;
  std::chrono::milliseconds print_retry_delay{2000};  // multiplied by the attempt number
  int max_download_attempts = 3;
  std::chrono::milliseconds download_retry_delay{2000};
  ReportRetryOptions report{};
};

enum class JobOutcome {
  NoJob,        // the long poll came back empty
  LostRace,     // another claimant won the job
  Printed,
  Failed,       // nothing more will print; reported FAILED
  Unknown,      // paper may exist; reported UNKNOWN for a person to resolve
  Interrupted,  // shutdown while the job was printing; the next start resolves it as UNKNOWN
};

struct ProcessResult {
  JobOutcome outcome = JobOutcome::NoJob;
  std::string job_id;
  std::optional<DWORD> spool_job_id;
  std::string error;  // why, for Failed and Unknown
};

/// 24.7 (ported from printers/job-processor.ts processNextJob): at most one job per call.
///
///   long poll -> claim (409 = lost the race, back off quietly)
///   -> ledger.claim(), durably on disk BEFORE anything is printed
///   -> settings, document download (retried), PDF check
///   -> print (a safe failure is retried; an unsafe one never is)
///   -> the document is deleted -> report PRINTING -> watch the spooler
///   -> ledger.record_result() -> report the result
///
/// A failure before the spooler records and reports FAILED; one that may have reached paper
/// records and reports UNKNOWN. The Node agent treated a failed download as UNKNOWN because
/// it could not tell it apart from a print failure; here it is FAILED, since no printer was
/// touched. Poll and claim errors are thrown, so the caller's loop can back off.
ProcessResult process_next_job(JobApi& api, JobPrinter& printer, JobLedger& ledger,
                               Logger& log, const JobProcessorOptions& options,
                               std::stop_token stop);

/// Reports `status` with retry and logs rather than throws: a report that cannot be delivered
/// must not stop the job loop (the API's own print-timeout sweep will catch up).
void report_or_log(JobApi& api, Logger& log, const std::string& job_id, ReportedStatus status,
                   const std::optional<std::string>& os_job_id, const ReportRetryOptions& options,
                   std::stop_token stop);

}  // namespace pa
