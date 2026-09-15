import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

/** How often the sweep ticks -- separate from the configurable §108
 * TTL (how *stale* an order must be before it's expired). No Done-when
 * anywhere pins an exact cadence, so this is a reasonable fixed
 * default rather than another env var to configure. */
const TICK_INTERVAL_MS = 60_000;
const SCHEDULER_ID = "order-expiration-sweep";

/** `upsertJobScheduler` (not the older `add(..., { repeat })`) is
 * idempotent by scheduler id -- restarting the worker re-registers the
 * same repeatable schedule instead of accumulating a second,
 * duplicate one on every restart. */
@Injectable()
export class OrderExpirationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderExpirationScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_EXPIRATION)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Order expiration sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
