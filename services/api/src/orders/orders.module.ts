import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { InvoicesModule } from "../invoices/invoices.module.js";
import { PaymentProviderModule } from "../payments/payment-provider.module.js";
import { OrderNumberService } from "./order-number.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

// OrderStateMachine itself now lives in backend-shared's global
// OrderStateMachineModule (imported once, in app.module.ts) -- both
// services/api and services/worker (5.6's expiration sweep) need it,
// so it's no longer a local provider of this module.
//
// PaymentProviderModule (not PaymentsModule -- PaymentsModule itself
// imports this module, so importing it back here would be circular)
// gives cancelOrder() its own RefundService for 11.3's own automatic
// refund-on-permitted-cancellation trigger.
@Module({
  imports: [AuthModule, DocumentsModule, IdempotencyModule, PaymentProviderModule, InvoicesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderNumberService],
  // OrdersService is exported too, alongside OrderNumberService -- 6.4's
  // PaymentsModule reuses its getOwnedOrder() rather than duplicating
  // the same ownership check.
  exports: [OrderNumberService, OrdersService],
})
export class OrdersModule {}
