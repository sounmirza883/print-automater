import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { OrderExpirationProcessor } from "./order-expiration.processor.js";
import { OrderExpirationScheduler } from "./order-expiration.scheduler.js";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ORDER_EXPIRATION })],
  providers: [OrderExpirationProcessor, OrderExpirationScheduler],
})
export class OrderExpirationModule {}
