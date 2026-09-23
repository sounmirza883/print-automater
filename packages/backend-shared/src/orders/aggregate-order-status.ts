import { OrderStatus, PrintJobStatus } from "@prisma/client";
import { QualityCheckStatus } from "@print-automated/types";

/** 18.2: pure, zero-I/O, zero-Prisma-beyond-the-generated-enums --
 * exhaustively unit-testable without a database, and the sole place
 * "what does this order's job set mean for the order's own status"
 * is decided. Everything that calls this passes a snapshot of the
 * order's own NON-superseded jobs (`supersededAt: null` -- a
 * superseded job is retry/reassignment history, not part of "what's
 * happening now").
 *
 * Precedence is **attention > progress > completion**, exactly the
 * plan's own three named cases:
 *   - 3 jobs, 1 FAILED            => PRINT_FAILED     (attention)
 *   - 2 PRINTED + 1 PRINTING      => PRINTING          (progress beats
 *                                                        completion)
 *   - all jobs PAUSED             => PAUSED            (attention)
 *
 * Monotonicity (18.10's own guard against the flapping risk): once any
 * job in the set is FAILED/TIMEOUT or UNKNOWN, rule 1/2 below match
 * regardless of what every OTHER job in the same set does -- the only
 * way this function ever stops returning PRINT_FAILED/
 * PRINT_STATUS_UNKNOWN for a given order is for that specific job's
 * row to no longer be in the input set at all (i.e. superseded by a
 * retry/reassignment, filtered out by the caller before this function
 * ever sees it). This function itself never treats "superseded" as a
 * concept -- that filtering is the caller's job, exactly like
 * SHOP_ORDER_INCLUDE's own `supersededAt: null` filter (18.5).
 *
 * Totality: always returns a valid OrderStatus, or `null` for "no
 * signal" (an empty job set, or a set that is entirely CANCELLED/
 * REASSIGNED -- nothing left to derive anything from). Never throws. */
export interface AggregateOrderStatusOptions {
  qualityCheck: QualityCheckStatus;
}

const ATTENTION_FAILURE: ReadonlySet<PrintJobStatus> = new Set([
  PrintJobStatus.FAILED,
  PrintJobStatus.TIMEOUT,
]);

// Statuses that still represent "this job is live, still on its way to
// PRINTED" -- excluded from the "every remaining job is PAUSED" check
// and from the "nothing left to derive from" empty-signal check.
const LIVE: ReadonlySet<PrintJobStatus> = new Set([
  PrintJobStatus.CREATED,
  PrintJobStatus.WAITING,
  PrintJobStatus.QUEUED,
  PrintJobStatus.CLAIMED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.PAUSED,
  PrintJobStatus.UNKNOWN,
]);

export function aggregateOrderStatus(
  jobs: ReadonlyArray<{ status: PrintJobStatus; required?: boolean }>,
  options: AggregateOrderStatusOptions,
): OrderStatus | null {
  // Only jobs still "in play" count toward the derived status --
  // CANCELLED and REASSIGNED rows are history, not signal, the same
  // way a superseded row already isn't in this function's input at
  // all (that filter is the caller's, this one is this function's own
  // for the two terminal-but-not-superseded statuses that can still
  // legitimately sit in an otherwise-live set).
  const relevant = jobs.filter(
    (job) => job.status !== PrintJobStatus.CANCELLED && job.status !== PrintJobStatus.REASSIGNED,
  );
  if (relevant.length === 0) {
    return null;
  }

  // 1. Attention: any hard failure anywhere wins outright.
  if (relevant.some((job) => ATTENTION_FAILURE.has(job.status))) {
    return OrderStatus.PRINT_FAILED;
  }

  // 2. Attention: any job whose outcome is genuinely unknown.
  if (relevant.some((job) => job.status === PrintJobStatus.UNKNOWN)) {
    return OrderStatus.PRINT_STATUS_UNKNOWN;
  }

  // 3. Attention: every live job is paused (a single paused job among
  // otherwise-progressing ones does not, by itself, demand attention --
  // the order is still moving).
  const live = relevant.filter((job) => LIVE.has(job.status));
  if (live.length > 0 && live.every((job) => job.status === PrintJobStatus.PAUSED)) {
    return OrderStatus.PAUSED;
  }

  // 4. Progress: anything actively printing beats anything already done.
  if (relevant.some((job) => job.status === PrintJobStatus.PRINTING)) {
    return OrderStatus.PRINTING;
  }

  // 5. Progress: claimed (assigned to an agent) but not yet printing.
  if (relevant.some((job) => job.status === PrintJobStatus.CLAIMED)) {
    return OrderStatus.ASSIGNED;
  }

  // 6. Completion: every required job has printed. QC gates the final
  // hop to PRINTED, exactly like a shop with qualityCheckEnabled:false
  // (options.qualityCheck stays NOT_REQUIRED, `default` branch below)
  // reproduces today's behaviour unchanged.
  const requiredJobs = relevant.filter((job) => job.required !== false);
  const allRequiredPrinted =
    requiredJobs.length > 0 && requiredJobs.every((job) => job.status === PrintJobStatus.PRINTED);
  if (allRequiredPrinted) {
    switch (options.qualityCheck) {
      case QualityCheckStatus.PENDING:
        return OrderStatus.QUALITY_CHECK;
      case QualityCheckStatus.FAILED:
        return OrderStatus.PRINT_FAILED;
      case QualityCheckStatus.PASSED:
      case QualityCheckStatus.NOT_REQUIRED:
      default:
        return OrderStatus.PRINTED;
    }
  }

  // 7. Progress: allocated to a printer, waiting on an agent to claim.
  if (relevant.some((job) => job.status === PrintJobStatus.QUEUED)) {
    return OrderStatus.QUEUED_FOR_PRINT;
  }

  // 8. Progress: exists but not yet (successfully) allocated at all.
  if (
    relevant.some(
      (job) => job.status === PrintJobStatus.CREATED || job.status === PrintJobStatus.WAITING,
    )
  ) {
    return OrderStatus.PREPARING;
  }

  // Every remaining job is PRINTED but some non-required job is not
  // (e.g. an optional finishing item still mid-flight while every
  // required item is already done) -- falls through to PREPARING as
  // the safest "still not fully done" signal rather than guessing.
  return OrderStatus.PREPARING;
}
