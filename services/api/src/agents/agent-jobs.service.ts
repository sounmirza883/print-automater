import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type Redis from "ioredis";
import { PrintJobStatus } from "@prisma/client";
import type { PrintConfiguration } from "@print-automated/types";
import type { ReportJobStatusInput } from "@print-automated/validation";
import {
  AppException,
  OrderStateMachine,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  reevaluatePrinterJobs,
  REDIS_CLIENT,
  type FailoverTrigger,
} from "@print-automated/backend-shared";

export interface PrintJobSummary {
  id: string;
  orderId: string;
  printerId: string;
  printerName: string;
  status: PrintJobStatus;
  claimedAt: string | null;
  createdAt: string;
  // §9.9: the agent needs the order's own print configuration to build
  // SumatraPDF's settings string -- there is nowhere else for it to
  // get this from, since a job carries no configuration of its own
  // (print_configuration lives on the order, snapshotted at 5.5).
  printConfiguration: PrintConfiguration;
}

function signalKey(deviceId: string): string {
  return `agent-job-signal:${deviceId}`;
}

const REPORTED_STATUS_TO_JOB_EVENT: Record<ReportJobStatusInput["status"], PrintJobEvent> = {
  PRINTING: PrintJobEvent.START,
  PRINTED: PrintJobEvent.PRINTED,
  FAILED: PrintJobEvent.FAIL,
  UNKNOWN: PrintJobEvent.LOSE,
};

/** §9.7. `GET /agents/jobs?wait=N` is a long-poll: check the database
 * for an already-QUEUED job first (covers a job that was queued while
 * this agent wasn't polling at all), then block on a per-device Redis
 * list so a *new* job wakes a waiting poll immediately instead of only
 * at the next timeout. The list entry itself is never trusted as "the"
 * job -- it's a wake-up nudge, so every wake (signalled or timed out)
 * re-reads the database, the only source of truth for what's actually
 * still QUEUED. */
@Injectable()
export class AgentJobsService implements OnModuleDestroy {
  // BRPOP blocks its connection for up to `wait` seconds. Sharing the
  // app-wide REDIS_CLIENT for that would stall every other
  // Redis-dependent request on this process -- rate limiting, agent
  // challenges, order locks -- for the same duration, since ioredis
  // multiplexes commands over one TCP connection by default.
  // `duplicate()` clones the same connection options without
  // re-reading REDIS_URL, giving blocking calls their own connection.
  private readonly blockingRedis: Redis;
  private readonly logger = new Logger(AgentJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly jobStateMachine: PrintJobStateMachine,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.blockingRedis = redis.duplicate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.blockingRedis.quit();
  }

  /** Called from shop-orders.service.ts's acceptOrder() sideEffect,
   * inside the same transaction that creates the QUEUED print_job --
   * a missed notify only costs latency (the next timeout still finds
   * the job via the DB check), never correctness. Trimmed so a long-
   * offline agent accumulating accepted orders doesn't grow this list
   * without bound; the DB check makes any trimmed-away signal harmless. */
  async notify(deviceId: string): Promise<void> {
    const key = signalKey(deviceId);
    await this.redis.multi().lpush(key, "1").ltrim(key, 0, 49).expire(key, 3600).exec();
  }

  /** 19.4: a printer became unsuitable. Delegates to the shared
   * re-evaluation primitive (no-op unless the shop opted in), then wakes the
   * receiving agents AFTER every move has committed. Never throws into the
   * caller's flow: the triggering change (disable, heartbeat, print report)
   * already succeeded and must not fail because a handoff did; the next
   * trigger or the 19.5 sweep retries. */
  async reevaluatePrinter(
    shopId: string,
    printerId: string,
    trigger: FailoverTrigger,
  ): Promise<void> {
    try {
      const result = await reevaluatePrinterJobs(
        {
          prisma: this.prisma,
          jobMachine: this.jobStateMachine,
          onError: (jobId, err) =>
            this.logger.error(
              { jobId, printerId, trigger, err },
              "Failover could not re-evaluate one job; continuing with the rest.",
            ),
        },
        { shopId, printerId, trigger },
      );
      if (result.errors.length > 0) {
        this.logger.error(
          { printerId, trigger, failedJobIds: result.errors.map((e) => e.jobId) },
          "Failover finished with per-job failures.",
        );
      }
      await Promise.all(result.notifyDeviceIds.map((deviceId) => this.notify(deviceId)));
    } catch (error) {
      this.logger.error(
        { printerId, trigger, err: error },
        "Automatic failover re-evaluation failed.",
      );
    }
  }

  /** SOFT CAP (documented, reviewer-confirmed): usage counts COMPLETED pages
   * only, so jobs allocated together can overshoot the limit, and this trigger
   * moves not-yet-claimed jobs away but does not undo overshoot on jobs that
   * are already claimed/printing.
   *
   * 19.4 trigger (b): after a job reached PRINTED and accrued usage, a
   * limit-enabled printer may no longer fit its queued jobs. */
  async onUsageAccrued(printerId: string): Promise<void> {
    // Contain EVERYTHING, including this lookup: the job and its usage have
    // already committed, so no failure here may fail the caller's request.
    try {
      const printer = await this.prisma.printer.findUnique({
        where: { id: printerId },
        select: { shopId: true, pageLimitEnabled: true, pageLimit: true },
      });
      if (printer?.pageLimitEnabled && printer.pageLimit !== null) {
        await this.reevaluatePrinter(printer.shopId, printerId, "PAGE_LIMIT_REACHED");
      }
    } catch (error) {
      this.logger.error({ printerId, err: error }, "Post-accrual limit check failed.");
    }
  }

  async waitForJob(deviceId: string, waitSeconds: number): Promise<PrintJobSummary | null> {
    const immediate = await this.findQueuedJob(deviceId);
    if (immediate) {
      return immediate;
    }

    const popped = await this.blockingRedis.brpop(signalKey(deviceId), waitSeconds);
    if (!popped) {
      return null;
    }
    return this.findQueuedJob(deviceId);
  }

  /** §9.7's own Done-when: two agents racing the same job, exactly one
   * wins. 18.1 moved the actual write behind PrintJobStateMachine (the
   * sole writer of `print_jobs.status`) -- the race-winner GUARANTEE
   * survives unchanged: the machine locks the job row (`SELECT ... FOR
   * UPDATE`, inside a transaction that locked this job's ORDER row
   * first, per its own structural invariant) before checking legality,
   * so the second of two concurrent claims simply blocks until the
   * first commits, then finds the row already CLAIMED and gets a
   * legality error, translated to JOB_ALREADY_CLAIMED below -- the same
   * single-winner outcome the old bare `updateMany` WHERE-clause idiom
   * produced, just serialized through the machine's row lock instead of
   * relying on UPDATE's own atomicity alone.
   *
   * `guard` (evaluated under the job row's own lock, so there is no
   * TOCTOU gap between checking device ownership and committing the
   * claim) is what makes this agent-scoped without the job machine
   * itself ever needing to know what an "agent" or "device" is: an
   * agent can only ever claim a job queued for one of ITS OWN printers,
   * never another shop's (or even the same shop's *other* agent's) job
   * by guessing an id. */
  async claim(jobId: string, deviceId: string): Promise<PrintJobSummary> {
    try {
      await this.jobStateMachine.transition(
        jobId,
        PrintJobEvent.CLAIM,
        { id: null },
        {
          // 18.16: claim deliberately does NOT sync the order -- under
          // the pre-18 explicit events claiming never moved the order's
          // status, and syncing would move every single-job order to
          // ASSIGNED, breaking 18.10's single-job equivalence gate.
          syncOrder: false,
          guard: async (tx, job) => {
            const printer = job.printerId
              ? await tx.printer.findFirst({
                  where: { id: job.printerId, agent: { deviceId } },
                  select: { id: true },
                })
              : null;
            if (!printer) {
              throw new AppException(
                HttpStatus.NOT_FOUND,
                "JOB_NOT_FOUND",
                "No such print job for this agent.",
                false,
              );
            }
          },
        },
      );
    } catch (err) {
      if (err instanceof AppException && err.errorCode === "ILLEGAL_JOB_TRANSITION") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "JOB_ALREADY_CLAIMED",
          "Another agent already claimed this job.",
          false,
        );
      }
      if (err instanceof NotFoundException) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          "JOB_NOT_FOUND",
          "No such print job for this agent.",
          false,
        );
      }
      throw err;
    }

    // 18.1 deliberately does NOT sync the order here -- under the old
    // explicit-event system, claiming a job never moved the order's own
    // status either (only an agent's later PRINTING/PRINTED/FAILED/
    // UNKNOWN *report* did); preserving that exact boundary is what
    // keeps single-job-equivalence.e2e-spec.ts (18.10) green.
    const job = await this.prisma.printJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { printer: true, order: { select: { printConfiguration: true } } },
    });
    return this.toSummary(job);
  }

  /** §9.12. Maps the agent's own narrower report onto both the print
   * job row (via PrintJobStateMachine, 18.1's sole writer of
   * `print_jobs.status`) and, once that write is durable, the order's
   * own derived status (via `OrderStateMachine.syncFromJobs()`, 18.2).
   *
   * 18.1's own JOB_TRANSITIONS table is what replaces the old "always
   * retry START_PRINT first" workaround: QUEUED now has direct legal
   * transitions straight to PRINTED/FAILED/UNKNOWN, not only through
   * CLAIMED/PRINTING, so an agent's retried-with-backoff reports
   * arriving out of order (9.12's own "offline retry" scenario) no
   * longer needs a synthetic intermediate event to stay legal --
   * whichever report actually arrives is legal from wherever the job
   * currently sits. `syncFromJobs` swallows ILLEGAL_ORDER_TRANSITION
   * (the same self-healing "already done" pattern 6.6/8.3 use): a
   * legitimate retry of the same idempotency key never even reaches
   * here (the interceptor replays), so an illegal order transition here
   * means the order simply already reflects an earlier, successful
   * report of this same outcome. */
  async reportStatus(jobId: string, deviceId: string, input: ReportJobStatusInput): Promise<void> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, printer: { agent: { deviceId } } },
    });
    if (!job) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "JOB_NOT_FOUND",
        "No such print job for this agent.",
        false,
      );
    }

    const event = REPORTED_STATUS_TO_JOB_EVENT[input.status];

    // 18.24: the OLD order machine always tried START_PRINT first (swallowing
    // ILLEGAL), so a PRINTED/FAILED/UNKNOWN report that arrived while the job
    // was still QUEUED/CLAIMED still produced PRINT_STARTED before the
    // terminal notification (and LOSE was only legal from PRINTING). The
    // design moves that self-healing here, verbatim: QUEUED -> CLAIMED (no
    // order sync, like a real claim) -> PRINTING (syncs the order, notifying
    // PRINT_STARTED once), then the reported event. Each step is its own
    // atomic transaction; ILLEGAL at any step means "already past it".
    if (input.status !== "PRINTING") {
      await this.selfHealToPrinting(job.id);
    } else {
      await this.selfHealToClaimed(job.id);
    }
    let accruedPrinterId: string | undefined;
    try {
      // 18.16: the job write and the order sync are ONE transaction
      // inside the job machine -- a failed sync rolls the job back.
      const applied = await this.jobStateMachine.transition(
        job.id,
        event,
        { id: null },
        { osJobId: input.osJobId },
      );
      accruedPrinterId = applied.accruedPrinterId;
    } catch (err) {
      // Same self-healing reasoning as the order side: a replayed or
      // out-of-order-but-already-applied report finds the job already
      // sitting at (or past) the reported outcome -- not a real error.
      if (!(err instanceof AppException && err.errorCode === "ILLEGAL_JOB_TRANSITION")) {
        throw err;
      }
      // Idempotent repair: the earlier report's own sync may have been
      // lost; re-deriving is a no-op when the order is already right.
      await this.syncOrderIgnoringIllegal(job.orderId);
      // 19.13: the report was illegal because the job already left the live
      // path. A "PRINTED"/"UNKNOWN" claim there means paper may exist, so it
      // must be recorded, not swallowed.
      if (input.status === "PRINTED" || input.status === "UNKNOWN") {
        await this.recordLateReport(job.id, job.orderId, input);
      }
    }

    // 19.4 trigger (b), strictly AFTER the commit and outside the try above
    // (contained inside, so it can never turn a good report into an error).
    if (accruedPrinterId) {
      await this.onUsageAccrued(accruedPrinterId);
    }

    if (input.status === "PRINTED") {
      this.logger.log(
        { metric: "print.succeeded", jobId: job.id, orderId: job.orderId },
        "Print job succeeded.",
      );
    } else if (input.status === "FAILED") {
      this.logger.warn(
        { metric: "print.failed", jobId: job.id, orderId: job.orderId },
        "Print job failed.",
      );
    } else if (input.status === "UNKNOWN") {
      this.logger.warn(
        { metric: "print.status_unknown", jobId: job.id, orderId: job.orderId },
        "Print job status unknown.",
      );
    }
  }

  /** 19.13 (duplicate printing is the cardinal rule). A late PRINTED/UNKNOWN
   * report on a TIMEOUT/FAILED/REASSIGNED job moves it to UNKNOWN through the
   * job machine (audited as PRINT_JOB_LATE_REPORT, order re-derived inside the
   * same transaction), so staff must resolve it instead of blind-retrying a
   * job whose paper already exists. Any other state (already PRINTED/UNKNOWN,
   * i.e. a replay, or CANCELLED) is legitimately not applicable: logged, never
   * an error to the agent. */
  private async recordLateReport(
    jobId: string,
    orderId: string,
    input: ReportJobStatusInput,
  ): Promise<void> {
    try {
      const applied = await this.jobStateMachine.transition(
        jobId,
        PrintJobEvent.LATE_REPORT,
        { id: null },
        { osJobId: input.osJobId, metadata: { reported: input.status, late: true } },
      );
      this.logger.warn(
        { metric: "print.late_report", jobId, orderId, reported: input.status, to: applied.status },
        "A late agent report arrived for a job that had left the live path; recorded as UNKNOWN for staff to resolve.",
      );
    } catch (err) {
      if (!(err instanceof AppException && err.errorCode === "ILLEGAL_JOB_TRANSITION")) {
        throw err;
      }
      const current = await this.prisma.printJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (
        input.status === "PRINTED" &&
        current &&
        current.status !== PrintJobStatus.PRINTED &&
        current.status !== PrintJobStatus.UNKNOWN
      ) {
        this.logger.warn(
          { metric: "print.report_not_applicable", jobId, orderId, currentStatus: current.status },
          "An agent reported PRINTED for a job in a state that cannot record it.",
        );
      }
    }
  }

  private async tryJobEvent(
    jobId: string,
    event: PrintJobEvent,
    ctx: { syncOrder?: boolean } = {},
  ): Promise<void> {
    try {
      await this.jobStateMachine.transition(jobId, event, { id: null }, ctx);
    } catch (err) {
      if (!(err instanceof AppException && err.errorCode === "ILLEGAL_JOB_TRANSITION")) {
        throw err;
      }
    }
  }

  private async selfHealToClaimed(jobId: string): Promise<void> {
    await this.tryJobEvent(jobId, PrintJobEvent.CLAIM, { syncOrder: false });
  }

  private async selfHealToPrinting(jobId: string): Promise<void> {
    await this.selfHealToClaimed(jobId);
    await this.tryJobEvent(jobId, PrintJobEvent.START);
  }

  private async syncOrderIgnoringIllegal(orderId: string): Promise<void> {
    try {
      await this.orderStateMachine.syncFromJobs(orderId, { id: null });
    } catch (err) {
      if (!(err instanceof AppException && err.errorCode === "ILLEGAL_ORDER_TRANSITION")) {
        throw err;
      }
    }
  }

  /** §17/18/18.8: priority-first, then FIFO within the same priority --
   * a HIGH/URGENT job queued after an already-waiting NORMAL one still
   * gets claimed first on the very next poll, deterministically
   * (`createdAt` alone never decides between two same-priority jobs
   * tied to the microsecond, which is why `id` is a final tie-break). */
  private async findQueuedJob(deviceId: string): Promise<PrintJobSummary | null> {
    const job = await this.prisma.printJob.findFirst({
      where: { status: PrintJobStatus.QUEUED, printer: { agent: { deviceId } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      include: { printer: true, order: { select: { printConfiguration: true } } },
    });
    return job ? this.toSummary(job) : null;
  }

  private toSummary(job: {
    id: string;
    orderId: string;
    // 18.6: printerId is nullable at the schema level now (a blocked,
    // unallocated job has none) -- but every job this method is ever
    // called with (an already-QUEUED job an agent is about to claim, or
    // one it just successfully claimed) is, by construction, already
    // allocated. A null here would mean allocatePrinter()/the job
    // machine let a QUEUED/CLAIMED job through without a printer, which
    // is itself the real bug worth surfacing loudly rather than masking
    // with a silent fallback.
    printerId: string | null;
    status: PrintJobStatus;
    claimedAt: Date | null;
    createdAt: Date;
    printer: { name: string } | null;
    order: { printConfiguration: unknown };
  }): PrintJobSummary {
    if (!job.printerId || !job.printer) {
      throw new Error(`Print job ${job.id} is QUEUED/CLAIMED but has no printer allocated.`);
    }
    return {
      id: job.id,
      orderId: job.orderId,
      printerId: job.printerId,
      printerName: job.printer.name,
      status: job.status,
      claimedAt: job.claimedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      printConfiguration: job.order.printConfiguration as PrintConfiguration,
    };
  }
}
