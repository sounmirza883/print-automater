import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { QueueMetricsProcessor } from "./queue-metrics.processor.js";
import { QueueMetricsScheduler } from "./queue-metrics.scheduler.js";

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.QUEUE_METRICS },
      { name: QUEUE_NAMES.DOCUMENT_PROCESSING },
      { name: QUEUE_NAMES.ORDER_EXPIRATION },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.PRINTER_OFFLINE_SWEEP },
      { name: QUEUE_NAMES.PRINT_TIMEOUT },
      { name: QUEUE_NAMES.PAYMENT_RECONCILIATION },
      { name: QUEUE_NAMES.DOCUMENT_RETENTION },
    ),
  ],
  providers: [QueueMetricsProcessor, QueueMetricsScheduler],
})
export class QueueMetricsModule {}
