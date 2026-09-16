import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

// A print job an agent never claims should surface far sooner than a
// stale payment does -- order-expiration's own 60s tick is overkill
// here for the opposite reason (this needs to be *more* responsive,
// not less), so this ticks every 30s instead. Still just cadence, not
// the configurable §109 TTL, so no env var per order-expiration's own
// precedent.
const TICK_INTERVAL_MS = 30_000;
const SCHEDULER_ID = "print-timeout-sweep";

/** Same `upsertJobScheduler` idempotent-by-id pattern as 5.6's
 * OrderExpirationScheduler and 9.4's PrinterOfflineSweepScheduler. */
@Injectable()
export class PrintTimeoutScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrintTimeoutScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PRINT_TIMEOUT)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Print timeout sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
