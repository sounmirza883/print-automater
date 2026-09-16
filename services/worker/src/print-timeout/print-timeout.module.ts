import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { PrintTimeoutProcessor } from "./print-timeout.processor.js";
import { PrintTimeoutScheduler } from "./print-timeout.scheduler.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.PRINT_TIMEOUT })],
  providers: [PrintTimeoutProcessor, PrintTimeoutScheduler],
})
export class PrintTimeoutModule {}
