import type pino from "pino";
import { BackendClient, BackendError, type PrintJobSummary } from "../backend/backend-client.js";
import { reportJobStatusWithRetry, type ReportStatusOptions } from "../backend/status-reporter.js";
import { withJobDocument } from "../documents/document-fetch.js";
import type { JobLedger } from "../ledger/ledger.js";
import { monitorPrintJob, type MonitorOptions } from "./monitor/monitor-print-job.js";
import { queryPrintJobs } from "./monitor/print-queue.js";
import type { MonitorOutcome } from "./monitor/print-job-tracker.js";
import { classifyPrintFailure } from "./driver/failure-classifier.js";
import type { PrintOptions, PrinterDriver, PrintSubmission } from "./driver/printer-driver.js";

const DEFAULT_MAX_SAFE_SUBMIT_ATTEMPTS = 3;
const DEFAULT_SAFE_RETRY_BASE_DELAY_MS = 2_000;

export interface SubmitRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** §110/10.2. Only a "safe" failure (classified by failure-classifier.
 * ts -- the print command never reached the spooler) is eligible for
 * this automatic retry; an "unsafe" one is rethrown on its very first
 * occurrence, never retried here at all, since retrying it risks a
 * second sheet of paper for a job that may already be on its way to
 * one. */
async function submitWithSafeRetry(
  driver: PrinterDriver,
  printOptions: PrintOptions,
  logger: pino.Logger,
  options: SubmitRetryOptions = {},
): Promise<PrintSubmission> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_SAFE_SUBMIT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_SAFE_RETRY_BASE_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await driver.print(printOptions);
    } catch (err) {
      lastError = err;
      if (classifyPrintFailure(err) === "unsafe") {
        throw err;
      }
      logger.warn({ err, attempt, maxAttempts }, "safe print submission failure -- retrying");
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }
  throw lastError;
}

export type ProcessResult =
  | { outcome: "no-job" }
  | { outcome: "lost-race" }
  | { outcome: "printed"; jobId: string; osJobId?: string; printOutcome: MonitorOutcome };

export interface JobProcessorOptions {
  baseUrl: string;
  driver: PrinterDriver;
  ledger: JobLedger;
  logger: pino.Logger;
  waitSeconds?: number;
  monitorOptions?: MonitorOptions;
  reportOptions?: ReportStatusOptions;
  submitRetryOptions?: SubmitRetryOptions;
}

/** §9.9/9.10's own connective tissue: poll (9.7) -> claim (9.7) ->
 * fetch the document (9.8) -> ledger.claim() (9.10) -> submit to the
 * driver (9.9, with 10.2's own safe-failure auto-retry). One call
 * processes at most one job, so the caller decides its own loop/retry
 * shape.
 *
 * §9.10's own Done-when hinges on exactly where the ledger write sits:
 * `ledger.claim()` runs (and, given ledger.ts's own `PRAGMA
 * synchronous = FULL`, is durably fsync'd) *before* `driver.print()`
 * is ever called -- if this process is killed anywhere from that
 * point through the print call returning, the row survives with no
 * `result`, and startup-sweep.ts's own sweep is what turns that into
 * `PRINT_STATUS_UNKNOWN` on the next run rather than a silent
 * resubmit. A submission that fails *safely* (per 10.2's own
 * classifier, even after exhausting its auto-retries) records FAILED
 * -- no paper could plausibly have come out. One that fails *unsafely*
 * records UNKNOWN instead, the same non-guess 9.10's own crash window
 * gets, since auto-retrying it would risk the very duplicate the
 * ledger exists to prevent. A `driver.print()` that *succeeds* is
 * followed immediately by 9.11's own monitor -- the only thing with
 * grounds to call a submission PRINTED is watching it actually leave
 * the real OS print queue, which is what finally resolves the ledger
 * row this function's own claim() left open. */
export async function processNextJob(
  client: BackendClient,
  accessToken: string,
  options: JobProcessorOptions,
): Promise<ProcessResult> {
  const job = await client.pollJobs(accessToken, options.waitSeconds ?? 25);
  if (!job) {
    return { outcome: "no-job" };
  }

  let claimed: PrintJobSummary;
  try {
    claimed = await client.claimJob(accessToken, job.id);
  } catch (err) {
    // §9.7's own Done-when: the loser of a claim race "backs off
    // cleanly" -- a 409 here means another poll (this agent's own
    // retry, or a genuine second claimant) already won it, not a
    // failure this call should propagate.
    if (err instanceof BackendError && err.status === 409) {
      options.logger.info({ jobId: job.id }, "lost the claim race for this job");
      return { outcome: "lost-race" };
    }
    throw err;
  }

  options.ledger.claim(claimed.id, claimed.orderId, claimed.printerName);

  // Captured just before submission, not after -- a fast or virtual
  // printer's job can appear and vanish from the OS queue faster than
  // this call's own round-trip, so the baseline must already be in
  // hand the moment driver.print() is called, not queried afterward.
  const baselineSnapshot = await queryPrintJobs(claimed.printerName, options.logger);
  const baselineJobIds = new Set((baselineSnapshot ?? []).map((job) => job.jobId));

  let submission;
  try {
    submission = await withJobDocument(
      options.baseUrl,
      claimed.id,
      accessToken,
      options.logger,
      (filePath) =>
        submitWithSafeRetry(
          options.driver,
          {
            printerName: claimed.printerName,
            filePath,
            configuration: claimed.printConfiguration,
          },
          options.logger,
          options.submitRetryOptions,
        ),
    );
  } catch (err) {
    // §110/10.2: a *safe* failure (never reached the spooler, even
    // after exhausting its auto-retries) can confidently be recorded
    // FAILED. An *unsafe* one -- the command may have reached the
    // printer -- gets exactly the same treatment 9.10's own crash
    // window gets: UNKNOWN, not a guess either way, because auto-
    // retrying it here would risk the very duplicate this whole ledger
    // exists to prevent.
    const ledgerResult = classifyPrintFailure(err) === "safe" ? "FAILED" : "UNKNOWN";
    options.ledger.recordResult(claimed.id, ledgerResult);
    try {
      await reportJobStatusWithRetry(
        client,
        accessToken,
        claimed.id,
        ledgerResult,
        undefined,
        options.logger,
        options.reportOptions,
      );
    } catch (reportErr) {
      options.logger.error(
        { reportErr },
        "failed to report a print submission failure to the backend",
      );
    }
    throw err;
  }

  // §9.12: tells the backend the job actually started printing --
  // moves the order QUEUED_FOR_PRINT -> PRINTING server-side. Retried
  // with its own backoff (status-reporter.ts) rather than failing this
  // whole call: the print itself already happened (or is happening)
  // regardless of whether this report gets through right away.
  await reportJobStatusWithRetry(
    client,
    accessToken,
    claimed.id,
    "PRINTING",
    submission.osJobId,
    options.logger,
    options.reportOptions,
  );

  const printOutcome = await monitorPrintJob(
    claimed.printerName,
    baselineJobIds,
    options.logger,
    options.monitorOptions,
  );
  options.ledger.recordResult(claimed.id, printOutcome);

  await reportJobStatusWithRetry(
    client,
    accessToken,
    claimed.id,
    printOutcome,
    submission.osJobId,
    options.logger,
    options.reportOptions,
  );

  return {
    outcome: "printed",
    jobId: claimed.id,
    osJobId: submission.osJobId,
    printOutcome,
  };
}
