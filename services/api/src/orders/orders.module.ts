import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OrderNumberService } from "./order-number.service.js";
import { OrderStateMachine } from "./order-state-machine.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

@Module({
  imports: [AuthModule, DocumentsModule, IdempotencyModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderNumberService, OrderStateMachine],
  exports: [OrderNumberService, OrderStateMachine],
})
export class OrdersModule {}
