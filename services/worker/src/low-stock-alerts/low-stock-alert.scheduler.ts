import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

const TICK_INTERVAL_MS = 60_000;
const SCHEDULER_ID = "low-stock-alerts";

/** Idempotent by scheduler id (upsertJobScheduler): a worker restart
 * re-registers the same schedule instead of stacking a duplicate. */
@Injectable()
export class LowStockAlertScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LowStockAlertScheduler.name);

  constructor(@InjectQueue(QUEUE_NAMES.LOW_STOCK_ALERTS) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Low-stock alert sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
