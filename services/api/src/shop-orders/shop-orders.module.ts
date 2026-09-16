import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AgentsModule } from "../agents/agents.module.js";
import { PaymentProviderModule } from "../payments/payment-provider.module.js";
import { OrderShopResolver } from "./order-shop.resolver.js";
import { ShopOrdersController } from "./shop-orders.controller.js";
import { ShopOrdersService } from "./shop-orders.service.js";

// PaymentProviderModule gives rejectOrder() its own RefundService for
// 11.3's automatic refund-on-rejection trigger.
@Module({
  imports: [AuthModule, AgentsModule, PaymentProviderModule],
  controllers: [ShopOrdersController],
  providers: [ShopOrdersService, OrderShopResolver],
})
export class ShopOrdersModule {}
