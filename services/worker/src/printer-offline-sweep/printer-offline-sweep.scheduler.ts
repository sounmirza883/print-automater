import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";

const TICK_INTERVAL_MS = 30_000;
const SCHEDULER_ID = "printer-offline-sweep";

/** `upsertJobScheduler` (not `add(..., { repeat })`) is idempotent by
 * scheduler id -- restarting the worker re-registers the same
 * repeatable schedule instead of accumulating a duplicate one on
 * every restart, the same reasoning order-expiration's own scheduler
 * already established. */
@Injectable()
export class PrinterOfflineSweepScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrinterOfflineSweepScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PRINTER_OFFLINE_SWEEP)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: TICK_INTERVAL_MS },
      { name: "sweep" },
    );
    this.logger.log(`Printer offline sweep scheduled every ${TICK_INTERVAL_MS}ms.`);
  }
}
