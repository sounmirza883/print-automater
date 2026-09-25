import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  PrismaService,
  QUEUE_NAMES,
  syncLowStockAlerts,
  type LowStockSyncResult,
} from "@print-automated/backend-shared";

/** 20.5/§32: raises a staff-facing in-app alert when an item reaches its
 * minimum and resolves it when stock recovers. The alert rows are surfaced by
 * the API (GET /v1/shop/inventory/alerts and /summary). */
@Processor(QUEUE_NAMES.LOW_STOCK_ALERTS)
export class LowStockAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(LowStockAlertProcessor.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<LowStockSyncResult> {
    const result = await syncLowStockAlerts(this.prisma);
    if (result.raised > 0 || result.resolved > 0) {
      this.logger.log(
        { metric: "inventory.low_stock", ...result },
        `Low-stock sweep: raised ${result.raised}, resolved ${result.resolved}.`,
      );
    }
    return result;
  }
}
