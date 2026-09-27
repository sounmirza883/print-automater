#include "agent/job_processor.h"

#include <exception>

#include "app/stop.h"
#include "documents/job_document.h"
#include "printing/print_failure.h"

namespace pa {

namespace {

ReportedStatus reported(JobResult result) {
  switch (result) {
    case JobResult::Printed: return ReportedStatus::Printed;
    case JobResult::Failed: return ReportedStatus::Failed;
    case JobResult::Unknown: return ReportedStatus::Unknown;
  }
  return ReportedStatus::Unknown;
}

JobOutcome outcome_of(JobResult result) {
  switch (result) {
    case JobResult::Printed: return JobOutcome::Printed;
    case JobResult::Failed: return JobOutcome::Failed;
    case JobResult::Unknown: return JobOutcome::Unknown;
  }
  return JobOutcome::Unknown;
}

bool retryable_download_error(const std::exception& error) {
  const auto* refused = dynamic_cast<const BackendError*>(&error);
  return refused == nullptr || refused->retryable() || refused->status() == 0 ||
         refused->status() >= 500;
}

JobDocument download_with_retry(JobApi& api, Logger& log, const PrintJobSummary& job,
                                const JobProcessorOptions& options, std::stop_token stop) {
  for (int attempt = 1;; ++attempt) {
    try {
      return fetch_job_document(options.tmp_dir, job.id, [&](const std::filesystem::path& file) {
        api.download(job.id, file);
      });
    } catch (const std::invalid_argument& error) {
      throw PrintFailure(PrintStage::BeforeSpool, error.what());  // a bad job id: never retried
    } catch (const std::exception& error) {
      if (attempt >= options.max_download_attempts || !retryable_download_error(error)) {
        throw PrintFailure(PrintStage::BeforeSpool,
                           std::string("The document could not be downloaded: ") + error.what());
      }
      log.warn("document download failed; retrying",
               {{"jobId", job.id}, {"attempt", attempt}, {"error", error.what()}});
    }
    if (!sleep_unless_stopped(stop, options.download_retry_delay * attempt)) {
      throw PrintFailure(PrintStage::BeforeSpool, "Stopped before the document was downloaded.");
    }
  }
}

SubmittedPrint print_with_safe_retry(JobPrinter& printer, Logger& log,
                                     const std::filesystem::path& document,
                                     const PrintJobSummary& job, const PrintSettings& settings,
                                     const JobProcessorOptions& options, std::stop_token stop) {
  for (int attempt = 1;; ++attempt) {
    try {
      return printer.print(document, job, settings);
    } catch (const PrintFailure& failure) {
      // Only a failure that never reached the spooler may be tried again: retrying anything
      // else risks a second copy of pages that are already printing.
      if (failure.stage() != PrintStage::BeforeSpool || attempt >= options.max_print_attempts) {
        throw;
      }
      log.warn("print failed before reaching the spooler; retrying",
               {{"jobId", job.id}, {"attempt", attempt}, {"error", failure.what()}});
    }
    if (!sleep_unless_stopped(stop, options.print_retry_delay * attempt)) {
      throw PrintFailure(PrintStage::BeforeSpool, "Stopped before the job was printed.");
    }
  }
}

}  // namespace

void report_or_log(JobApi& api, Logger& log, const std::string& job_id, ReportedStatus status,
                   const std::optional<std::string>& os_job_id, const ReportRetryOptions& options,
                   std::stop_token stop) {
  try {
    const bool sent = report_status_with_retry(
        [&](const std::string& key) { api.report(job_id, status, key, os_job_id); }, job_id, status,
        stop, options,
        [&](const std::exception& error, int attempt, std::chrono::milliseconds wait) {
          log.warn("status report failed; retrying",
                   {{"jobId", job_id},
                    {"status", to_string(status)},
                    {"attempt", attempt},
                    {"retryInMs", wait.count()},
                    {"error", error.what()}});
        });
    if (!sent) {
      log.warn("status report abandoned at shutdown", {{"jobId", job_id}, {"status", to_string(status)}});
    }
  } catch (const std::exception& error) {
    log.error("status report refused", {{"jobId", job_id},
                                        {"status", to_string(status)},
                                        {"error", error.what()}});
  }
}

ProcessResult process_next_job(JobApi& api, JobPrinter& printer, JobLedger& ledger, Logger& log,
                               const JobProcessorOptions& options, std::stop_token stop) {
  const auto offered = api.poll(options.poll_wait);
  if (!offered) return {JobOutcome::NoJob};

  PrintJobSummary job;
  try {
    job = api.claim(offered->id);
  } catch (const BackendError& error) {
    if (error.status() == 409) {
      log.info("lost the claim race for this job", {{"jobId", offered->id}});
      return {JobOutcome::LostRace, offered->id};
    }
    throw;
  }

  ProcessResult result{JobOutcome::Unknown, job.id};
  try {
    ledger.claim(job.id, job.order_id, job.printer_name);
  } catch (const AlreadyClaimedError&) {
    // This machine has handled this job before: printing it again could be the duplicate the
    // ledger exists to prevent. A person decides.
    log.error("job is already in the ledger; not printing it again", {{"jobId", job.id}});
    report_or_log(api, log, job.id, ReportedStatus::Unknown, std::nullopt, options.report, stop);
    result.error = "This job was already handled on this computer.";
    return result;
  }
  log.info("job claimed", {{"jobId", job.id}, {"orderId", job.order_id}, {"printer", job.printer_name}});

  SubmittedPrint submitted;
  try {
    PrintSettings settings;
    try {
      settings = to_print_settings(job.print_configuration);
    } catch (const InvalidPrintConfiguration& error) {
      throw PrintFailure(PrintStage::BeforeSpool, error.what());
    }
    JobDocument document = download_with_retry(api, log, job, options, stop);
    if (!is_pdf_file(document.file())) {
      throw PrintFailure(PrintStage::BeforeSpool, "The document is not a PDF.");
    }
    submitted = print_with_safe_retry(printer, log, document.file(), job, settings, options, stop);
    // `document` is deleted here: the spooler holds its own copy from now on.
  } catch (const std::exception& error) {
    const bool safe = classify_print_failure(std::current_exception()) == FailureSafety::Safe;
    const JobResult recorded = safe ? JobResult::Failed : JobResult::Unknown;
    ledger.record_result(job.id, recorded);
    log.error(safe ? "print failed before reaching the printer"
                   : "print failed after reaching the spooler; paper may exist",
              {{"jobId", job.id}, {"result", to_string(recorded)}, {"error", error.what()}});
    report_or_log(api, log, job.id, reported(recorded), std::nullopt, options.report, stop);
    result.outcome = outcome_of(recorded);
    result.error = error.what();
    return result;
  }

  result.spool_job_id = submitted.spool_job_id;
  const std::string os_job_id = std::to_string(submitted.spool_job_id);
  log.info("job sent to the spooler", {{"jobId", job.id}, {"spoolJobId", submitted.spool_job_id}});
  report_or_log(api, log, job.id, ReportedStatus::Printing, os_job_id, options.report, stop);

  const auto verdict = printer.monitor(job.printer_name, submitted.spool_job_id, stop);
  if (!verdict) {
    // Shutting down mid-print: the row stays unresolved and the next start marks it UNKNOWN.
    log.warn("stopped while the job was printing", {{"jobId", job.id}});
    result.outcome = JobOutcome::Interrupted;
    return result;
  }
  ledger.record_result(job.id, *verdict);
  log.info("job finished", {{"jobId", job.id}, {"result", to_string(*verdict)}});
  report_or_log(api, log, job.id, reported(*verdict), os_job_id, options.report, stop);
  result.outcome = outcome_of(*verdict);
  if (*verdict != JobResult::Printed) {
    result.error = *verdict == JobResult::Failed ? "The job was removed from the printer's queue."
                                                 : "The printer did not confirm the job.";
  }
  return result;
}

}  // namespace pa
