import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

// A retention sweep, not a latency-sensitive one -- documents become
// eligible on the scale of days (DOCUMENT_RETENTION_DAYS), so ticking
// once an hour is plenty responsive, matching order-expiration's own
// "cadence, not the configurable business TTL, needs no env var"
// precedent.
const TICK_INTERVAL_MS = 60 * 60_000;
const SCHEDULER_ID = "document-retention-sweep";

/** Same `upsertJobScheduler` idempotent-by-id pattern as every other
 * repeatable sweep in this codebase. */
@Injectable()
export class DocumentRetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentRetentionScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.DOCUMENT_RETENTION)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Document retention sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
