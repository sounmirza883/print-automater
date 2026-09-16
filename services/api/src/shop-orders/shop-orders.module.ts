import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrderShopResolver } from "./order-shop.resolver.js";
import { ShopOrdersController } from "./shop-orders.controller.js";
import { ShopOrdersService } from "./shop-orders.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ShopOrdersController],
  providers: [ShopOrdersService, OrderShopResolver],
})
export class ShopOrdersModule {}
