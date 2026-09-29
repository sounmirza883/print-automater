import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { OrderCreationSource, OrderStatus } from "@prisma/client";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
  QUEUE_NAMES,
} from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";

/** §108/5.6. One tick: find every order that has sat in
 * `PAYMENT_PENDING` past the configured TTL (24.1: or a QR order still in
 * `UPLOADED`, awaiting payment at the counter), and expire each one
 * through the shared `OrderStateMachine` -- never a direct status
 * write (the `no-restricted-syntax` lint rule forbids it here same as
 * in services/api). */
@Processor(QUEUE_NAMES.ORDER_EXPIRATION)
export class OrderExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderExpirationProcessor.name);

  // Explicit @Inject() on every param, not just the type annotation --
  // document-processing.processor.ts's own constructor already found
  // that a class `extends WorkerHost` combined with cross-package
  // injected params loses emitDecoratorMetadata reliability; assume
  // every future @Processor() here needs this too.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderStateMachine) private readonly stateMachine: OrderStateMachine,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ expiredCount: number; consideredCount: number }> {
    const cutoff = new Date(Date.now() - this.env.ORDER_PAYMENT_PENDING_TTL_MINUTES * 60_000);
    const stale = await this.prisma.order.findMany({
      where: {
        updatedAt: { lt: cutoff },
        OR: [
          { orderStatus: OrderStatus.PAYMENT_PENDING },
          // 24.1: a guest's QR order waits in UPLOADED for staff to take
          // payment at the counter (it has no checkout of its own). Unclaimed
          // past the same payment-pending TTL, it is expired like any other
          // unpaid order -- otherwise anyone who knows a shop id (it is in the
          // public QR URL) could pile up permanent needsAttention entries.
          // Only QR: a customer-web or counter order in UPLOADED is untouched.
          { orderStatus: OrderStatus.UPLOADED, creationSource: OrderCreationSource.QR },
        ],
      },
      select: { id: true },
    });

    let expiredCount = 0;
    for (const { id } of stale) {
      try {
        await this.stateMachine.transition(id, OrderEvent.EXPIRE, { id: null });
        expiredCount += 1;
      } catch (error) {
        // §108's own Done-when -- "expires exactly once, not
        // double-processed on the next tick" -- is enforced by
        // OrderStateMachine's row lock, not by anything in this loop:
        // if this order was already moved out of PAYMENT_PENDING
        // between the query above and this transition acquiring its
        // row lock (a previous tick beat this one to it, an
        // overlapping concurrent tick, or the customer's own action),
        // `transition()` throws a typed 409 here. That IS the
        // guarantee working, not a failure to log or retry.
        if (!(error instanceof AppException)) {
          throw error;
        }
        this.logger.debug(
          `Order ${id} was no longer expirable by the time it was locked -- skipped.`,
        );
      }
    }

    this.logger.log(`Order expiration sweep: ${expiredCount}/${stale.length} order(s) expired.`);
    return { expiredCount, consideredCount: stale.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Order-expiration sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
