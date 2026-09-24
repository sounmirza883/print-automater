import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PrintJobStatus } from "@prisma/client";
import {
  AppException,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  QUEUE_NAMES,
} from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";

/** §109/10.5/18.1/19.5. One tick: find every print_job that has sat in
 * QUEUED or CLAIMED past the configured timeout -- an agent that never
 * claimed the job at all, or claimed it and then went silent before
 * reporting PRINTING -- and times it out through PrintJobStateMachine
 * (the sole writer of `print_jobs.status`), then lets
 * `OrderStateMachine.syncFromJobs()` re-derive the order's own status
 * from the result. PRINT_FAILED is already the actionable state
 * 10.1-10.4 built Retry/Change Printer/Cancel around, so staff get the
 * same recovery options whether a job failed live or timed out.
 *
 * 19.5 will extend this to group timed-out jobs by order and call
 * `transitionMany()` once per order (never a per-job loop, which would
 * invert lock order across orders); this phase's own scope only needs
 * the job-machine migration itself, so each timed-out job is still
 * transitioned individually here -- each call already opens its own
 * orders-row-first transaction, so per-job here is still deadlock-safe,
 * just not yet batched. */
@Processor(QUEUE_NAMES.PRINT_TIMEOUT)
export class PrintTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PrintTimeoutProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrintJobStateMachine) private readonly jobStateMachine: PrintJobStateMachine,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ timedOutCount: number; consideredCount: number }> {
    const cutoff = new Date(Date.now() - this.env.PRINT_JOB_TIMEOUT_MINUTES * 60_000);
    const stale = await this.prisma.printJob.findMany({
      where: {
        status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.CLAIMED] },
        supersededAt: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, orderId: true },
    });

    let timedOutCount = 0;
    // 18.27: one persistently failing (poison) job must not block the jobs
    // behind it on every tick, so each job has its own try/catch; failures
    // are remembered and surfaced once AFTER the loop so the tick is still
    // logged as failed and retried.
    const failures: unknown[] = [];
    for (const stuckJob of stale) {
      try {
        // 18.16: the TIMEOUT write and the order sync commit together
        // (inside the job machine). A failed sync rolls the job back to
        // QUEUED/CLAIMED, so the next tick still sees it and retries.
        await this.jobStateMachine.transition(
          stuckJob.id,
          PrintJobEvent.TIMEOUT,
          { id: null },
          { metadata: { reason: "timeout" } },
        );
        timedOutCount += 1;
      } catch (error) {
        // Same reasoning as order-expiration.processor.ts: an
        // ILLEGAL_JOB_TRANSITION means the job moved on (an agent's own
        // report, or a previous/overlapping tick) between the query
        // above and this transition's row lock -- the guarantee
        // working, not a bug. Anything else (a transient sync failure,
        // a DB error) is remembered and rethrown after the loop so the tick is logged and retried.
        if (!(error instanceof AppException && error.errorCode === "ILLEGAL_JOB_TRANSITION")) {
          this.logger.error(
            `Print job ${stuckJob.id} could not be timed out: ${error instanceof Error ? error.message : String(error)}`,
          );
          failures.push(error);
          continue;
        }
        this.logger.debug(
          `Print job ${stuckJob.id} was no longer timeout-eligible by the time it was locked -- skipped.`,
        );
      }
    }

    this.logger.log(`Print timeout sweep: ${timedOutCount}/${stale.length} job(s) timed out.`);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `Print timeout sweep: ${failures.length} of ${stale.length} job(s) failed to time out.`,
      );
    }
    return { timedOutCount, consideredCount: stale.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Print timeout sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
