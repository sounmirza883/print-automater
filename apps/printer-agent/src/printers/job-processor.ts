import type pino from "pino";
import { BackendClient, BackendError, type PrintJobSummary } from "../backend/backend-client.js";
import { withJobDocument } from "../documents/document-fetch.js";
import type { PrinterDriver } from "./driver/printer-driver.js";

export type ProcessResult =
  | { outcome: "no-job" }
  | { outcome: "lost-race" }
  | { outcome: "printed"; jobId: string; osJobId?: string };

export interface JobProcessorOptions {
  baseUrl: string;
  driver: PrinterDriver;
  logger: pino.Logger;
  waitSeconds?: number;
}

/** §9.9/9.10's own connective tissue: poll (9.7) -> claim (9.7) ->
 * fetch the document (9.8) -> submit to the driver (9.9). One call
 * processes at most one job, so the caller decides its own loop/retry
 * shape. Deliberately does NOT yet touch the job ledger -- that fsync-
 * before-print sequencing is 9.10's own scope, layered on top of this
 * function rather than folded in here, so this piece stays provable on
 * its own first. */
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

  const submission = await withJobDocument(
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

  return { outcome: "printed", jobId: claimed.id, osJobId: submission.osJobId };
}
