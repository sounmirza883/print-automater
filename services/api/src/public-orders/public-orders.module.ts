import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { PublicOrdersController } from "./public-orders.controller.js";
import { PublicOrdersService } from "./public-orders.service.js";

// 24.1 (QR guest ordering). DocumentsModule/OrdersModule give the exact
// upload and quote/pricing/state-machine machinery the authenticated routes
// use (composed, not duplicated). AuthModule is imported ONLY for
// PasswordService (the SYSTEM user's unusable password hash) -- none of its
// guards is applied to this module's controller.
@Module({
  imports: [AuthModule, DocumentsModule, OrdersModule, IdempotencyModule],
  controllers: [PublicOrdersController],
  providers: [PublicOrdersService],
})
export class PublicOrdersModule {}
