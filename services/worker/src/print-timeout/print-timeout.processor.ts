import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { OrderStatus, PrintJobStatus } from "@prisma/client";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
  QUEUE_NAMES,
} from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";

/** §109/10.5. One tick: find every order that has sat in
 * `QUEUED_FOR_PRINT` past the configured timeout -- an agent that
 * never claimed the job at all, or claimed it and then went silent
 * before reporting PRINTING -- and fails it through the shared
 * `OrderStateMachine`, exactly like 5.6's own PAYMENT_PENDING sweep.
 * `FAIL_PRINT` (QUEUED_FOR_PRINT -> PRINT_FAILED) is the same event a
 * live agent-reported failure already uses (agent-jobs.service.ts's
 * reportStatus()) -- a timeout is just another way a print attempt
 * can fail, and PRINT_FAILED is already the actionable state 10.1-10.4
 * built Retry/Change Printer/Cancel around, so staff get the exact
 * same recovery options either way. The print_job row itself is marked
 * TIMEOUT rather than FAILED (schema.prisma's PrintJobStatus already
 * anticipated this distinction) so the job-level history still shows
 * *why* it failed, even though the order-level state is identical. */
@Processor(QUEUE_NAMES.PRINT_TIMEOUT)
export class PrintTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PrintTimeoutProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderStateMachine) private readonly stateMachine: OrderStateMachine,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ timedOutCount: number; consideredCount: number }> {
    const cutoff = new Date(Date.now() - this.env.PRINT_JOB_TIMEOUT_MINUTES * 60_000);
    const stale = await this.prisma.order.findMany({
      where: { orderStatus: OrderStatus.QUEUED_FOR_PRINT, updatedAt: { lt: cutoff } },
      select: { id: true },
    });

    let timedOutCount = 0;
    for (const { id } of stale) {
      try {
        await this.stateMachine.transition(
          id,
          OrderEvent.FAIL_PRINT,
          { id: null },
          {
            metadata: { reason: "timeout" },
            sideEffect: async (tx) => {
              await tx.printJob.updateMany({
                where: {
                  orderId: id,
                  status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.CLAIMED] },
                },
                data: { status: PrintJobStatus.TIMEOUT },
              });
            },
          },
        );
        timedOutCount += 1;
      } catch (error) {
        // Same reasoning as order-expiration.processor.ts: a 409 here
        // means the order moved on (an agent's own report, or a
        // previous/overlapping tick) between the query above and this
        // transition's row lock -- the guarantee working, not a bug.
        if (!(error instanceof AppException)) {
          throw error;
        }
        this.logger.debug(
          `Order ${id} was no longer timeout-eligible by the time it was locked -- skipped.`,
        );
      }
    }

    this.logger.log(`Print timeout sweep: ${timedOutCount}/${stale.length} order(s) timed out.`);
    return { timedOutCount, consideredCount: stale.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Print timeout sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
