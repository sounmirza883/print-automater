import type pino from "pino";
import type { JobLedger } from "./ledger.js";

/** §9.10's own Done-when: "killing the agent between ledger-write and
 * submission, then restarting, produces PRINT_STATUS_UNKNOWN -- not a
 * second sheet of paper." Every unresolved row this startup finds was
 * claimed by some *previous* run of this process that never got to
 * (or never survived long enough to) record an outcome -- there is no
 * way, from inside this process alone, to tell "the print actually
 * went through and we just crashed before recording it" apart from
 * "the print never reached the spooler at all." Treating both as
 * UNKNOWN and refusing to resubmit is the only choice that can never
 * produce a duplicate; reporting that UNKNOWN state to the backend so
 * a human can resolve it is 9.12/10.3's own later scope, not this
 * function's. */
export function markUnresolvedAsUnknown(ledger: JobLedger, logger: pino.Logger): number {
  const unresolved = ledger.getUnresolved();
  for (const row of unresolved) {
    ledger.recordResult(row.jobId, "UNKNOWN");
    logger.warn(
      { jobId: row.jobId, orderId: row.orderId, printerName: row.printerName },
      "job left unresolved by a previous run -- marked PRINT_STATUS_UNKNOWN, will not be resubmitted",
    );
  }
  return unresolved.length;
}
