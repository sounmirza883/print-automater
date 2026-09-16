import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { PaymentProviderModule } from "./payment-provider.module.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

@Module({
  imports: [AuthModule, OrdersModule, PaymentProviderModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, WebhooksService],
})
export class PaymentsModule {}
