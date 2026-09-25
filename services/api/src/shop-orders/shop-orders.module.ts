import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AgentsModule } from "../agents/agents.module.js";
import { InvoicesModule } from "../invoices/invoices.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { PaymentProviderModule } from "../payments/payment-provider.module.js";
import { OrderShopResolver } from "./order-shop.resolver.js";
import { ShopOrdersController } from "./shop-orders.controller.js";
import { ShopOrdersService } from "./shop-orders.service.js";

// PaymentProviderModule gives rejectOrder() its own RefundService for
// 11.3's automatic refund-on-rejection trigger. OrdersModule (17.5)
// gives createCounterOrder() OrdersService.createOrder() -- the exact
// same quote/pricing/state-machine machinery the customer-web path
// uses, reused rather than duplicated.
@Module({
  imports: [AuthModule, AgentsModule, PaymentProviderModule, OrdersModule, InvoicesModule],
  controllers: [ShopOrdersController],
  providers: [ShopOrdersService, OrderShopResolver],
  exports: [ShopOrdersService],
})
export class ShopOrdersModule {}
