import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

// A payment health-check, not a latency-sensitive user-facing sweep
// (unlike 9.4's 90s offline threshold or 10.5's 30s print-timeout tick)
// -- ticking every 5 minutes is plenty responsive for something a human
// resolves out of band once flagged.
const TICK_INTERVAL_MS = 5 * 60_000;
const SCHEDULER_ID = "payment-reconciliation-sweep";

/** Same `upsertJobScheduler` idempotent-by-id pattern as every other
 * repeatable sweep in this codebase (5.6, 9.4, 10.5). */
@Injectable()
export class PaymentReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentReconciliationScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Payment reconciliation sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
