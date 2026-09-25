import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { LowStockAlertProcessor } from "./low-stock-alert.processor.js";
import { LowStockAlertScheduler } from "./low-stock-alert.scheduler.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.LOW_STOCK_ALERTS })],
  providers: [LowStockAlertProcessor, LowStockAlertScheduler],
})
export class LowStockAlertsModule {}
