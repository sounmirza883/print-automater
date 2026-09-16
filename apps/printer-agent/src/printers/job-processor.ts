import type pino from "pino";
import { BackendClient, BackendError, type PrintJobSummary } from "../backend/backend-client.js";
import { withJobDocument } from "../documents/document-fetch.js";
import type { JobLedger } from "../ledger/ledger.js";
import type { PrinterDriver } from "./driver/printer-driver.js";

export type ProcessResult =
  | { outcome: "no-job" }
  | { outcome: "lost-race" }
  | { outcome: "printed"; jobId: string; osJobId?: string };

export interface JobProcessorOptions {
  baseUrl: string;
  driver: PrinterDriver;
  ledger: JobLedger;
  logger: pino.Logger;
  waitSeconds?: number;
}

/** §9.9/9.10's own connective tissue: poll (9.7) -> claim (9.7) ->
 * fetch the document (9.8) -> ledger.claim() (9.10) -> submit to the
 * driver (9.9). One call processes at most one job, so the caller
 * decides its own loop/retry shape.
 *
 * §9.10's own Done-when hinges on exactly where the ledger write sits:
 * `ledger.claim()` runs (and, given ledger.ts's own `PRAGMA
 * synchronous = FULL`, is durably fsync'd) *before* `driver.print()`
 * is ever called -- if this process is killed anywhere from that
 * point through the print call returning, the row survives with no
 * `result`, and startup-sweep.ts's own sweep is what turns that into
 * `PRINT_STATUS_UNKNOWN` on the next run rather than a silent
 * resubmit. A `driver.print()` that *throws* (the command never
 * reached the spooler, or definitely errored before it could) is the
 * one case this function can safely resolve on its own -- no paper
 * could plausibly have come out, so it records FAILED immediately
 * instead of leaving an unresolved row for the next restart to treat
 * as merely unknown. A `driver.print()` that *succeeds* leaves the row
 * unresolved on purpose: "submitted to the spooler" is not "printed,"
 * and only 9.11's own monitor -- watching the real OS print queue --
 * has grounds to call this one PRINTED. */
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

  let submission;
  try {
    submission = await withJobDocument(
      options.baseUrl,
      claimed.id,
      accessToken,
      options.logger,
      (filePath) =>
        options.driver.print({
          printerName: claimed.printerName,
          filePath,
          configuration: claimed.printConfiguration,
        }),
    );
  } catch (err) {
    options.ledger.recordResult(claimed.id, "FAILED");
    throw err;
  }

  return { outcome: "printed", jobId: claimed.id, osJobId: submission.osJobId };
}
