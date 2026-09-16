import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

const TICK_INTERVAL_MS = 60_000;
const SCHEDULER_ID = "queue-metrics";

/** `upsertJobScheduler` (not `add(..., { repeat })`) is idempotent by
 * scheduler id -- restarting the worker re-registers the same
 * repeatable schedule instead of accumulating a duplicate one on every
 * restart, the same reasoning every other repeatable sweep in this
 * service already establishes. */
@Injectable()
export class QueueMetricsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueMetricsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.QUEUE_METRICS)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Queue depth metrics scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
