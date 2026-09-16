import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { PrinterOfflineSweepProcessor } from "./printer-offline-sweep.processor.js";
import { PrinterOfflineSweepScheduler } from "./printer-offline-sweep.scheduler.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.PRINTER_OFFLINE_SWEEP })],
  providers: [PrinterOfflineSweepProcessor, PrinterOfflineSweepScheduler],
})
export class PrinterOfflineSweepModule {}
