import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrderShopResolver } from "../shop-orders/order-shop.resolver.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeliveriesService } from "./deliveries.service.js";

@Module({
  imports: [AuthModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, OrderShopResolver],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
