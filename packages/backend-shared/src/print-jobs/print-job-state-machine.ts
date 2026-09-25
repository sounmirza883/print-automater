import { HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { JobFailureReason, Prisma, PrintJobStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { redactMetadata } from "../audit/redact-metadata.js";
import { AppException } from "../errors/app-exception.js";
import { OrderEvent, OrderStateMachine } from "../orders/order-state-machine.js";
import { periodStart } from "../printers/page-limit-period.js";
import { jobPages, type JobConfig } from "./job-pages.js";
import { logJobPagesFallback } from "./job-pages-log.js";
import { consumePaperForJobContained } from "../inventory/consume-paper.js";
import { Permission } from "@print-automated/types";
import { notifyShopStaffContained, type StaffAlert } from "../notifications/staff-notifications.js";

/** 18.1. Every event PrintJobStateMachine accepts. CLAIM/PRINTED keep
 * the exact wire vocabulary the agent already speaks (15.6 froze that
 * contract) -- everything else is a purely server-side transition name,
 * the same "vocabulary, not persisted string" distinction OrderEvent
 * already establishes for orders. */
export const PrintJobEvent = {
  // CREATED|WAITING -> QUEUED: allocatePrinter() (18.4) found a
  // candidate; sets printerId in the same write.
  ALLOCATE: "ALLOCATE",
  // CREATED|WAITING -> WAITING: allocatePrinter() found nothing (18.6);
  // sets/refreshes blockedReason. Legal from WAITING itself too -- a
  // later allocation sweep tick can update *why* it's still blocked.
  BLOCK: "BLOCK",
  // QUEUED -> CLAIMED: an agent's atomic claim (9.7). The orders-row-
  // first lock ordering this machine enforces on every call is what
  // keeps two agents racing the same job serialized -- the second
  // simply finds the row already CLAIMED once its own lock is granted.
  CLAIM: "CLAIM",
  // CLAIMED -> PRINTING: agent reports it started spooling.
  START: "START",
  // CLAIMED|PRINTING -> PRINTED: agent reports success.
  PRINTED: "PRINTED",
  // QUEUED|CLAIMED|PRINTING -> FAILED.
  FAIL: "FAIL",
  // CLAIMED|PRINTING -> UNKNOWN: agent lost track of the outcome (§47).
  LOSE: "LOSE",
  // QUEUED|CLAIMED|PRINTING -> TIMEOUT: the print-timeout sweep (19.5).
  TIMEOUT: "TIMEOUT",
  // UNKNOWN -> PRINTED|FAILED: staff's own resolution (§47/10.3).
  RESOLVE_PRINTED: "RESOLVE_PRINTED",
  RESOLVE_FAILED: "RESOLVE_FAILED",
  // UNKNOWN -> REASSIGNED (18.26): staff's RETRY resolution supersedes the
  // unknown job (supersededAt set) so a replacement can be dispatched; kept
  // as its own event so the audit row (PRINT_JOB_RESOLVE_RETRY) carries the
  // actor and resolution like the other two resolutions.
  RESOLVE_RETRY: "RESOLVE_RETRY",
  // QUEUED -> WAITING (19.4): automatic handoff found no other suitable
  // printer; clears printerId and records why (blockedReason). Never legal
  // from CLAIMED/PRINTING: an agent may already be printing it.
  UNALLOCATE: "UNALLOCATE",
  // QUEUED|CLAIMED|WAITING -> PAUSED, PAUSED -> WAITING (21.1):
  // resuming re-enters the allocation queue rather than assuming the
  // same printer/claim state still applies.
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  // PAUSED -> QUEUED (21.1): resume straight onto a printer the caller already
  // validated (and re-validates under the lock via `guard`), so a resumed job
  // never sits in WAITING with a stale reason. RESUME (-> WAITING) is the
  // "nothing suitable right now" branch and carries a fresh blockedReason.
  RESUME_QUEUE: "RESUME_QUEUE",
  // PAUSED -> PAUSED (21.6): a late PRINTED report says paper for this item may
  // already exist while staff had ALREADY paused the successor. Stamps the hold
  // (blockedReason MANUAL_APPROVAL_REQUIRED) on the job row itself, atomically
  // with its own audit row, so resume can refuse without an acknowledgement.
  HOLD: "HOLD",
  // any non-terminal -> CANCELLED: cascades from an order-level cancel.
  CANCEL: "CANCEL",
  // WAITING|QUEUED|CLAIMED -> REASSIGNED (18.7): the OLD row's own
  // terminal status once staff manually reassigns it to a different
  // printer/operator before it finished -- the NEW row this action
  // creates starts its own lifecycle fresh at CREATED, never reuses
  // this one.
  SUPERSEDE: "SUPERSEDE",
  // TIMEOUT|FAILED|REASSIGNED -> UNKNOWN (19.13): an agent reports PRINTED (or
  // that it lost track) for a job that already left the live path -- timed
  // out, failed, or failed over to another printer. Paper may have come out,
  // so the evidence is recorded as UNKNOWN (staff must resolve it) rather than
  // dropped, which would let a blind Retry print a duplicate.
  LATE_REPORT: "LATE_REPORT",
} as const;
export type PrintJobEvent = (typeof PrintJobEvent)[keyof typeof PrintJobEvent];

/** 18.1: faithful to the plan's own precedence (CREATED/WAITING gate
 * allocation; QUEUED/CLAIMED/PRINTING are the live production path;
 * PRINTED/FAILED/TIMEOUT/CANCELLED/REASSIGNED are terminal; UNKNOWN is
 * the deliberate non-retry state §47 already established; PAUSED is
 * operator-controlled, 21.1). A status with no entry accepts no event
 * at all -- every further attempt against it is illegal, the same
 * "state with no entry is terminal" convention order-state-machine.ts
 * already uses. */
const JOB_TRANSITIONS: Record<PrintJobStatus, Partial<Record<PrintJobEvent, PrintJobStatus>>> = {
  CREATED: {
    [PrintJobEvent.ALLOCATE]: "QUEUED",
    [PrintJobEvent.BLOCK]: "WAITING",
    [PrintJobEvent.CANCEL]: "CANCELLED",
  },
  WAITING: {
    [PrintJobEvent.ALLOCATE]: "QUEUED",
    [PrintJobEvent.BLOCK]: "WAITING",
    [PrintJobEvent.PAUSE]: "PAUSED",
    [PrintJobEvent.CANCEL]: "CANCELLED",
    [PrintJobEvent.SUPERSEDE]: "REASSIGNED",
  },
  QUEUED: {
    [PrintJobEvent.CLAIM]: "CLAIMED",
    // PRINTED/LOSE (not just FAIL) are legal straight from QUEUED too,
    // not only from CLAIMED/PRINTING -- the same resilience the old
    // order-side code's own "always retry START_PRINT first" comment
    // called for: an agent's retried-with-backoff status reports can
    // arrive out of order, so a "PRINTED"/"UNKNOWN" report might be the
    // very first one this job ever sees if an earlier "PRINTING" report
    // was lost in transit.
    [PrintJobEvent.PRINTED]: "PRINTED",
    [PrintJobEvent.FAIL]: "FAILED",
    [PrintJobEvent.LOSE]: "UNKNOWN",
    [PrintJobEvent.TIMEOUT]: "TIMEOUT",
    [PrintJobEvent.UNALLOCATE]: "WAITING",
    [PrintJobEvent.PAUSE]: "PAUSED",
    [PrintJobEvent.CANCEL]: "CANCELLED",
    [PrintJobEvent.SUPERSEDE]: "REASSIGNED",
  },
  CLAIMED: {
    [PrintJobEvent.START]: "PRINTING",
    [PrintJobEvent.PRINTED]: "PRINTED",
    [PrintJobEvent.FAIL]: "FAILED",
    [PrintJobEvent.LOSE]: "UNKNOWN",
    [PrintJobEvent.TIMEOUT]: "TIMEOUT",
    [PrintJobEvent.SUPERSEDE]: "REASSIGNED",
  },
  PRINTING: {
    [PrintJobEvent.PRINTED]: "PRINTED",
    [PrintJobEvent.FAIL]: "FAILED",
    [PrintJobEvent.LOSE]: "UNKNOWN",
  },
  PRINTED: {},
  PAUSED: {
    [PrintJobEvent.RESUME]: "WAITING",
    [PrintJobEvent.RESUME_QUEUE]: "QUEUED",
    [PrintJobEvent.HOLD]: "PAUSED",
    [PrintJobEvent.CANCEL]: "CANCELLED",
  },
  FAILED: { [PrintJobEvent.LATE_REPORT]: "UNKNOWN" },
  UNKNOWN: {
    [PrintJobEvent.RESOLVE_PRINTED]: "PRINTED",
    [PrintJobEvent.RESOLVE_FAILED]: "FAILED",
    [PrintJobEvent.RESOLVE_RETRY]: "REASSIGNED",
  },
  TIMEOUT: { [PrintJobEvent.LATE_REPORT]: "UNKNOWN" },
  CANCELLED: {},
  REASSIGNED: { [PrintJobEvent.LATE_REPORT]: "UNKNOWN" },
};

/** Every (from, event, to) edge of the REAL transition table, so specs (the
 * order-status purity/rank properties) derive from it instead of hand-copying
 * it and silently missing a new edge. */
export function jobTransitionEdges(): Array<{
  from: PrintJobStatus;
  event: PrintJobEvent;
  to: PrintJobStatus;
}> {
  const edges: Array<{ from: PrintJobStatus; event: PrintJobEvent; to: PrintJobStatus }> = [];
  for (const [from, byEvent] of Object.entries(JOB_TRANSITIONS)) {
    for (const [event, to] of Object.entries(byEvent)) {
      edges.push({ from: from as PrintJobStatus, event: event as PrintJobEvent, to });
    }
  }
  return edges;
}

export interface JobTransitionActor {
  /** null for system-driven transitions (print-timeout sweep, an
   * agent's own unauthenticated-by-a-human status report). */
  id: string | null;
}

export interface LockedPrintJobRow {
  id: string;
  orderId: string;
  printerId: string | null;
  status: PrintJobStatus;
  blockedReason: string | null;
  attempt: number;
}

export interface JobTransitionContext {
  metadata?: Record<string, unknown>;
  /** ALLOCATE: the printer this job is being assigned to. UNALLOCATE: null
   * clears it. */
  printerId?: string | null;
  /** BLOCK/UNALLOCATE: why allocation failed (packages/types' BlockedReason).
   * `null` clears it (ALLOCATE out of WAITING: the job is no longer blocked). */
  blockedReason?: string | null;
  /** Agent status reports carry the OS-level job id (9.11). */
  osJobId?: string;
  /** Evaluated under the row lock, before the write -- lets a caller
   * (agent-jobs.service.ts's device-ownership check, specifically)
   * refuse a transition based on data this machine deliberately stays
   * ignorant of (which agent device owns this job's printer), without
   * ever exposing a TOCTOU gap between checking and locking: this runs
   * AFTER the job row is already locked, inside the same transaction. */
  guard?: (tx: Prisma.TransactionClient, job: LockedPrintJobRow) => Promise<void>;
  /** 18.16: by default the order is re-derived (SYNC_JOBS) inside the SAME
   * transaction as the job write, so the two commit or roll back together.
   * `false` opts out: CLAIM does, because claiming never changed the
   * order's status in the pre-18 code and syncing would move every
   * single-job order to ASSIGNED (breaking 18.10's equivalence gate). */
  syncOrder?: boolean;
  /** Clock for the accrual period key (defaults to the real clock); lets
   * tests cross a period boundary deterministically. */
  now?: Date;
  /** 18.18, SUPERSEDE only: create the replacement job for the same order
   * item, on `printerId`, in the SAME transaction (orders row already
   * locked, so `attempt` and the `${orderItemId}:${attempt}` idempotency
   * token cannot collide with a concurrent reassign) -- then the order is
   * synced with the replacement already present. Without this a crash
   * between "supersede" and "create" strands the item with no live job. */
  successor?: { printerId: string };
  /** 18.26: runs inside the transaction after every job write and BEFORE the
   * order sync, with the orders row already locked first (so it cannot invert
   * lock order). Used by RESOLVE_RETRY to dispatch the replacement job
   * atomically with the supersede; a throw rolls the whole transition back. */
  beforeSync?: (tx: Prisma.TransactionClient, results: JobTransitionResult[]) => Promise<void>;
  /** 20.9 TEST SEAM ONLY: runs inside the paper-consumption savepoint before
   * consumption, to prove a failure there cannot roll back the print. Never set
   * in production code. */
  consumptionHook?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** 21.2 (§66): the operator's failure-reason pick, recorded on the job in the
   * same write that moves it to FAILED (RESOLVE_FAILED today). Ignored for any
   * other target status. */
  failureReason?: JobFailureReason | null;
  failureNote?: string | null;
  /** 21.6: blocked reasons that must SURVIVE this write even though `blockedReason`
   * is set (PAUSE keeps a late-print hold instead of clearing it). Evaluated on
   * the locked row. */
  keepBlockedReasons?: readonly string[];
  /** 23.9 TEST SEAM ONLY: runs inside the staff-alert savepoint, to prove a failure while
   * raising an alert cannot fail or roll back the transition. Never set in production code. */
  staffAlertHook?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export interface JobTransitionResult {
  jobId: string;
  orderId: string;
  status: PrintJobStatus;
  /** 18.18: set when `ctx.successor` created a replacement job. */
  successorJobId?: string;
  /** 19.3: set when this transition accrued page usage (job reached PRINTED),
   * so the caller can run post-commit follow-ups (19.4 limit re-evaluation). */
  accruedPrinterId?: string;
  /** 18.16: true only when the order was NOT synced inside this
   * transaction (`ctx.syncOrder === false`, or the order was already
   * closed -- ILLEGAL_ORDER_TRANSITION -- so there is nothing to
   * derive). Otherwise the sync already happened atomically with the job
   * write. `OrderStateMachine.syncFromJobs()` stays available as an
   * idempotent repair primitive. */
  requiresSync: boolean;
}

/** 18.1. The one and only place `print_jobs.status` is ever written
 * (enforced by the second `no-restricted-syntax` rule in the root
 * eslint config, scoped exactly like the order one and excluding only
 * this file). Structural, not conventional: `transition()`/
 * `transitionMany()` take NO caller-supplied transaction -- there is no
 * parameter through which a caller could hand this class an
 * already-open transaction and thereby control (or invert) lock
 * ordering. Every call opens its own `$transaction`, which:
 *   1. locks the `orders` row FIRST, unconditionally, before touching
 *      any `print_jobs` row -- even though this class never itself
 *      writes `orders.order_status`, holding that row's lock for the
 *      duration is what serializes this job write against every OTHER
 *      writer converging on the same order (another agent's claim on a
 *      sibling job, the timeout sweep, a staff retry) on the exact same
 *      resource `OrderStateMachine.applyLocked()` itself locks first,
 *      so two concurrent job-and-order-touching operations on one order
 *      can never deadlock against each other -- both always acquire the
 *      `orders` row before anything else;
 *   2. locks the target `print_jobs` row(s) in ascending `id` order
 *      (a `SELECT ... FOR UPDATE ORDER BY id` -- Postgres locks rows as
 *      the Sort node beneath LockRows emits them, so this really does
 *      acquire locks in id order, not query-plan-dependent order),
 *      which is what keeps `transitionMany()` deadlock-free against
 *      itself even when two calls target overlapping job sets in
 *      different original orders.
 */
@Injectable()
export class PrintJobStateMachine {
  private readonly logger = new Logger(PrintJobStateMachine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStateMachine: OrderStateMachine,
  ) {}

  async transition(
    jobId: string,
    event: PrintJobEvent,
    actor: JobTransitionActor,
    ctx: JobTransitionContext = {},
  ): Promise<JobTransitionResult> {
    const results = await this.applyTransaction([jobId], event, actor, ctx);
    const result = results[0];
    if (!result) {
      throw new NotFoundException("Print job not found.");
    }
    return result;
  }

  /** 19.5's own requirement: "sweep print_jobs grouped by order, one
   * transitionMany per order, never a per-job loop, which would invert
   * lock order." Every id in `jobIds` must belong to the SAME order --
   * validated before any lock is taken, and enforced precisely because
   * a per-job loop of individual `transition()` calls would each open
   * its OWN transaction and lock `orders` once per job instead of once
   * for the whole batch, which is both slower and (across several
   * concurrently-sweeping orders) exactly the kind of inconsistent
   * acquisition pattern that invites a deadlock. */
  async transitionMany(
    jobIds: string[],
    event: PrintJobEvent,
    actor: JobTransitionActor,
    ctx: JobTransitionContext = {},
  ): Promise<JobTransitionResult[]> {
    return this.applyTransaction(jobIds, event, actor, ctx);
  }

  /** 23.7 (PRD 37/111): the staff-facing signals of a job transition, written in the SAME
   * transaction as the transition (so they exist exactly when the change does) but
   * contained in a savepoint (so a notification problem can never roll back a print).
   * Recipients are the members who hold ASSIGN_JOBS in the job's business. Signals:
   *  - JOB_BLOCKED: the job is now WAITING for a NEW reason (allocation found nothing, the
   *    shop turned automatic assignment off, ...). A sweep re-blocking for the SAME reason
   *    is not news, so it does not notify again.
   *  - JOB_HELD_LATE_PRINT: the 19.18 hold (PAUSE or HOLD carrying MANUAL_APPROVAL_REQUIRED
   *    because a late PRINTED report says paper may already exist).
   *  - JOB_FAILED: the agent reported FAIL, or the timeout sweep gave up (TIMEOUT). A staff
   *    resolution (RESOLVE_FAILED) is their own act and does not notify.
   * None of the customer-notification toggles apply: these are operational. */
  private async raiseStaffAlert(
    tx: Prisma.TransactionClient,
    job: LockedPrintJobRow,
    event: PrintJobEvent,
    nextStatus: PrintJobStatus,
    ctx: JobTransitionContext,
  ): Promise<void> {
    // Everything about raising an alert (the context read, building it, the inserts) runs in
    // a savepoint: whatever goes wrong here, the job transition itself must still commit.
    await tx.$executeRawUnsafe("SAVEPOINT job_staff_alert");
    try {
      await ctx.staffAlertHook?.(tx);
      await this.buildAndRaiseStaffAlert(tx, job, event, nextStatus, ctx);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT job_staff_alert");
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT job_staff_alert");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT job_staff_alert");
      this.logger.warn(
        { jobId: job.id, event, nextStatus, err: error },
        "Could not raise a staff alert for a print job transition; the transition itself is unaffected.",
      );
    }
  }

  private async buildAndRaiseStaffAlert(
    tx: Prisma.TransactionClient,
    job: LockedPrintJobRow,
    event: PrintJobEvent,
    nextStatus: PrintJobStatus,
    ctx: JobTransitionContext,
  ): Promise<void> {
    const appliedReason =
      ctx.blockedReason !== undefined &&
      !(job.blockedReason !== null && ctx.keepBlockedReasons?.includes(job.blockedReason))
        ? ctx.blockedReason
        : job.blockedReason;

    let signal: Pick<StaffAlert, "type" | "title" | "body" | "metadata"> | undefined;
    const label = (order: string): string => `order ${order}`;
    if (nextStatus === "WAITING" && appliedReason && appliedReason !== job.blockedReason) {
      signal = {
        type: "JOB_BLOCKED",
        title: "Print job blocked",
        body: `A print job for {order} is waiting: ${appliedReason}.`,
        metadata: { blockedReason: appliedReason, event },
      };
    } else if (
      nextStatus === "PAUSED" &&
      (event === PrintJobEvent.PAUSE || event === PrintJobEvent.HOLD) &&
      appliedReason === "MANUAL_APPROVAL_REQUIRED" &&
      ctx.metadata?.reason === "LATE_PRINTED_ON_SUPERSEDED_JOB"
    ) {
      signal = {
        type: "JOB_HELD_LATE_PRINT",
        title: "Print job held: possible duplicate",
        body: `A print job for {order} was held because an earlier attempt reported paper after it had failed or moved. Check the tray before resuming.`,
        metadata: {
          blockedReason: appliedReason,
          supersededJobId: ctx.metadata?.supersededJobId ?? null,
        },
      };
    } else if (
      (event === PrintJobEvent.FAIL || event === PrintJobEvent.TIMEOUT) &&
      (nextStatus === "FAILED" || nextStatus === "TIMEOUT")
    ) {
      signal = {
        type: "JOB_FAILED",
        title: nextStatus === "TIMEOUT" ? "Print timed out" : "Print failed",
        body: `A print job for {order} ${nextStatus === "TIMEOUT" ? "timed out" : "failed"}.`,
        metadata: { event },
      };
    }
    if (!signal) {
      return;
    }

    const context = await tx.printJob.findUnique({
      where: { id: job.id },
      select: {
        shopId: true,
        printerId: true,
        order: { select: { publicOrderNumber: true } },
        printer: { select: { name: true } },
      },
    });
    if (!context) {
      return;
    }
    await notifyShopStaffContained(tx, {
      shopId: context.shopId,
      permission: Permission.ASSIGN_JOBS,
      type: signal.type,
      title: signal.title,
      body: signal.body.replace("{order}", label(context.order.publicOrderNumber)),
      targetType: "PRINT_JOB",
      targetId: job.id,
      orderId: job.orderId,
      metadata: {
        ...signal.metadata,
        printerId: context.printerId ?? job.printerId,
        printerName: context.printer?.name ?? null,
      },
    });
  }

  /** 19.3. Runs inside the SAME transaction as the transition into PRINTED
   * (PRINTED and RESOLVE_PRINTED both land here), so the count commits or
   * rolls back with the status and a job can only reach PRINTED once: a
   * replay hits ILLEGAL_JOB_TRANSITION before this line. Atomic
   * INSERT .. ON CONFLICT increment, never read-modify-write, so
   * concurrent completions on one printer sum exactly. Accrues regardless
   * of `page_limit_enabled` so enabling a limit later starts from truth.
   * The period is the printer's own, in UTC (periodStart). */
  private async accruePageUsage(
    tx: Prisma.TransactionClient,
    jobId: string,
    printerId: string | null,
    now: Date,
  ): Promise<boolean> {
    if (!printerId) {
      return false;
    }
    const printer = await tx.printer.findUnique({
      where: { id: printerId },
      select: { pageLimitPeriod: true },
    });
    if (!printer) {
      return false;
    }
    const job = await tx.printJob.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        orderItem: {
          select: {
            documentId: true,
            quantity: true,
            printConfiguration: true,
            document: { select: { pageCount: true } },
          },
        },
        order: {
          select: {
            id: true,
            documentId: true,
            printConfiguration: true,
            document: { select: { pageCount: true } },
          },
        },
      },
    });
    const pages = jobPages(
      (job.orderItem?.printConfiguration ?? job.order.printConfiguration) as unknown as JobConfig,
      job.orderItem?.document.pageCount ?? job.order.document.pageCount,
      job.orderItem?.quantity,
      logJobPagesFallback({
        jobId,
        orderId: job.order.id,
        documentId: job.orderItem?.documentId ?? job.order.documentId,
      }),
    ).total;
    const start = periodStart(printer.pageLimitPeriod, now);
    await tx.$executeRaw`
      INSERT INTO printer_page_usage (id, printer_id, period_start, pages_used, created_at, updated_at)
      VALUES (gen_random_uuid()::text, ${printerId}, ${start}, ${pages}, now(), now())
      ON CONFLICT (printer_id, period_start)
      DO UPDATE SET pages_used = printer_page_usage.pages_used + EXCLUDED.pages_used,
                    updated_at = now()
    `;
    return true;
  }

  private async applyTransaction(
    jobIds: string[],
    event: PrintJobEvent,
    actor: JobTransitionActor,
    ctx: JobTransitionContext,
  ): Promise<JobTransitionResult[]> {
    if (jobIds.length === 0) {
      return [];
    }
    const sortedIds = [...new Set(jobIds)].sort();
    let pendingEmail: Parameters<OrderStateMachine["enqueuePendingEmail"]>[0];

    const results = await this.prisma.$transaction(
      async (tx) => {
        // Discover which order these jobs belong to WITHOUT a lock --
        // just enough to know which `orders` row to lock first. The
        // authoritative, lock-protected read of each job's own current
        // status happens below, after step 1.
        const discovery = await tx.printJob.findMany({
          where: { id: { in: sortedIds } },
          select: { id: true, orderId: true },
        });
        if (discovery.length !== sortedIds.length) {
          throw new NotFoundException("One or more print jobs were not found.");
        }
        const orderIds = new Set(discovery.map((job) => job.orderId));
        if (orderIds.size > 1) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "JOBS_SPAN_MULTIPLE_ORDERS",
            "transitionMany() requires every job to belong to the same order.",
            false,
          );
        }
        const [orderId] = orderIds;

        // Step 1, unconditionally, before any print_jobs row: lock the
        // parent order.
        const orderRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE
        `;
        if (orderRows.length === 0) {
          throw new NotFoundException("Order not found.");
        }

        // Step 2: lock the job rows themselves, in ascending id order.
        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            orderId: string;
            printerId: string | null;
            status: PrintJobStatus;
            blockedReason: string | null;
            attempt: number;
          }>
        >`
          SELECT id, order_id AS "orderId", printer_id AS "printerId", status,
                 blocked_reason AS "blockedReason", attempt
          FROM print_jobs
          WHERE id = ANY(${sortedIds}::text[])
          ORDER BY id ASC
          FOR UPDATE
        `;

        const results: JobTransitionResult[] = [];
        for (const job of lockedRows) {
          if (ctx.guard) {
            await ctx.guard(tx, job);
          }

          const nextStatus = JOB_TRANSITIONS[job.status][event];
          if (nextStatus === undefined) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "ILLEGAL_JOB_TRANSITION",
              `Cannot apply ${event} to a print job in ${job.status}.`,
              false,
            );
          }

          await tx.printJob.update({
            where: { id: job.id },
            data: {
              status: nextStatus,
              ...(ctx.printerId !== undefined ? { printerId: ctx.printerId } : {}),
              ...(ctx.blockedReason !== undefined &&
              !(job.blockedReason !== null && ctx.keepBlockedReasons?.includes(job.blockedReason))
                ? { blockedReason: ctx.blockedReason }
                : {}),
              ...(ctx.osJobId !== undefined ? { osJobId: ctx.osJobId } : {}),
              ...(nextStatus === "CLAIMED" ? { claimedAt: ctx.now ?? new Date() } : {}),
              ...(nextStatus === "REASSIGNED" ? { supersededAt: ctx.now ?? new Date() } : {}),
              ...(nextStatus === "FAILED" && ctx.failureReason !== undefined
                ? { failureReason: ctx.failureReason, failureNote: ctx.failureNote ?? null }
                : {}),
              // 21.1: pausedAt is set on entering PAUSED and cleared on leaving it.
              ...(nextStatus === "PAUSED"
                ? { pausedAt: ctx.now ?? new Date() }
                : job.status === "PAUSED"
                  ? { pausedAt: null }
                  : {}),
            },
          });

          await this.raiseStaffAlert(tx, job, event, nextStatus, ctx);

          let accruedPrinterId: string | undefined;
          if (
            nextStatus === "PRINTED" &&
            (await this.accruePageUsage(tx, job.id, job.printerId, ctx.now ?? new Date()))
          ) {
            accruedPrinterId = job.printerId!;
          }
          // 20.4: paper consumption (a no-op unless the shop tracks inventory)
          // in the SAME transaction, after the usage accrual, inside the locks.
          if (nextStatus === "PRINTED") {
            await consumePaperForJobContained(
              tx,
              { jobId: job.id, actorId: actor.id },
              ctx.consumptionHook,
            );
          }

          let successorJobId: string | undefined;
          if (ctx.successor) {
            if (nextStatus !== "REASSIGNED") {
              throw new AppException(
                HttpStatus.CONFLICT,
                "SUCCESSOR_NOT_ALLOWED",
                "A successor job can only be created by SUPERSEDE.",
                false,
              );
            }
            const original = await tx.printJob.findUniqueOrThrow({
              where: { id: job.id },
              select: { shopId: true, orderItemId: true },
            });
            if (!original.orderItemId) {
              throw new AppException(
                HttpStatus.CONFLICT,
                "JOB_NOT_REASSIGNABLE",
                "This job has no order item to re-dispatch against.",
                false,
              );
            }
            const attempt =
              (await tx.printJob.count({ where: { orderItemId: original.orderItemId } })) + 1;
            const created = await tx.printJob.create({
              data: {
                orderId: job.orderId,
                shopId: original.shopId,
                orderItemId: original.orderItemId,
                printerId: ctx.successor.printerId,
                attempt,
                idempotencyToken: `${original.orderItemId}:${attempt}`,
                status: "QUEUED",
              },
            });
            successorJobId = created.id;
          }

          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: `PRINT_JOB_${event}`,
              resourceType: "print_job",
              resourceId: job.id,
              metadata: redactMetadata({
                from: job.status,
                to: nextStatus,
                orderId: job.orderId,
                ...ctx.metadata,
              }) as Prisma.InputJsonValue,
            },
          });

          results.push({
            jobId: job.id,
            orderId: job.orderId,
            status: nextStatus,
            successorJobId,
            accruedPrinterId,
            requiresSync: true,
          });
        }

        if (ctx.beforeSync) {
          await ctx.beforeSync(tx, results);
        }

        // 18.16: sync the order in THIS transaction (orders row already
        // locked above), so a failed sync rolls the job write back and
        // the next sweep/report simply retries both. Only an already-
        // closed order (ILLEGAL_ORDER_TRANSITION) is tolerated -- nothing
        // to derive, and the job write must still stand. Anything else
        // propagates and aborts the whole transaction. (That error is
        // thrown by resolveSyncTarget before any write, so continuing in
        // the same Postgres transaction afterwards is safe.)
        if (ctx.syncOrder !== false) {
          try {
            const applied = await this.orderStateMachine.transitionWithin(
              tx,
              orderId as string,
              OrderEvent.SYNC_JOBS,
              actor,
            );
            pendingEmail = applied.pendingEmail;
            for (const result of results) {
              result.requiresSync = false;
            }
          } catch (error) {
            if (!(
              error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION"
            )) {
              throw error;
            }
          }
        }

        return results;
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    // Only after the combined transaction committed (Redis is not part
    // of it): enqueue the customer notification the order transition
    // produced, if any.
    await this.orderStateMachine.enqueuePendingEmail(pendingEmail);
    return results;
  }
}
