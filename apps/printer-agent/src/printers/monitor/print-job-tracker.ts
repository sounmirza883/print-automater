import type { QueueSnapshot } from "./print-queue.js";

export type MonitorOutcome = "PRINTED" | "FAILED" | "UNKNOWN";

/** Substrings of Win32_PrintJob's own `Status`/`JobStatus` free-text
 * values (e.g. "Paper Jam", "Error - Printing", "User Intervention
 * Required", "Out of Paper", "Offline") that indicate a real problem,
 * not normal progress ("Printing", "Spooling", "Paused" alone isn't
 * necessarily an error -- a user-initiated pause is not a failure). */
const ERROR_INDICATORS = [
  "error",
  "jam",
  "offline",
  "out of paper",
  "no paper",
  "door open",
  "user intervention",
  "out of memory",
  "toner",
];

function isErrorStatus(snapshot: QueueSnapshot): boolean {
  const combined = `${snapshot.status} ${snapshot.jobStatus}`.toLowerCase();
  return ERROR_INDICATORS.some((indicator) => combined.includes(indicator));
}

/** §9.11's own state machine, kept pure and separate from the actual
 * WMI polling (print-queue.ts) so it's exhaustively testable without
 * real hardware or a real print spooler -- matching 9.9's own
 * settings-mapping/SumatraPrinterDriver split.
 *
 * SumatraPDF's exit code 0 only means "submitted to the spooler" (§37,
 * §9.9's own driver.print() contract) -- this class is what turns a
 * *sequence* of queue snapshots into an actual PRINTED/FAILED/UNKNOWN
 * verdict: the job we submitted must first be *seen* in the queue
 * (identified by not being in the pre-submission baseline), then
 * either vanish cleanly (PRINTED, or FAILED if it ever showed an error
 * status first) or the polling deadline arrives with it still present
 * or never having appeared at all (UNKNOWN -- see onTimeout()). */
export class PrintJobTracker {
  private trackedJobId: number | null = null;
  private everSawError = false;

  constructor(private readonly baselineJobIds: ReadonlySet<number>) {}

  /** Feed one poll's worth of queue snapshots for this printer.
   * Returns a terminal outcome once reached, or `null` to keep
   * polling. A `null` snapshot (the poll itself failed) is a no-op --
   * it carries no information either way. */
  feed(snapshot: QueueSnapshot[] | null): MonitorOutcome | null {
    if (snapshot === null) {
      return null;
    }

    if (this.trackedJobId === null) {
      const newJob = snapshot.find((job) => !this.baselineJobIds.has(job.jobId));
      if (!newJob) {
        return null; // our job hasn't appeared in the queue yet
      }
      this.trackedJobId = newJob.jobId;
    }

    const tracked = snapshot.find((job) => job.jobId === this.trackedJobId);
    if (!tracked) {
      // The job we locked onto is no longer in the queue at all.
      return this.everSawError ? "FAILED" : "PRINTED";
    }

    if (isErrorStatus(tracked)) {
      this.everSawError = true;
      // Keep polling rather than returning immediately -- staff can
      // clear a jam and the job resumes; only its eventual departure
      // from the queue (still handled above, on a later poll) is
      // terminal, and by then everSawError already makes that FAILED.
    }

    return null;
  }

  /** Called once the polling deadline elapses with no terminal outcome
   * from feed(). Distinct from FAILED: this is "we don't actually
   * know," not "we know it went wrong" -- the job may still be sitting
   * in a slow queue, or (a real, named risk for some drivers) it may
   * have completed so fast it never appeared in any poll at all. */
  onTimeout(): MonitorOutcome {
    if (this.everSawError) {
      return "FAILED";
    }
    return "UNKNOWN";
  }
}
