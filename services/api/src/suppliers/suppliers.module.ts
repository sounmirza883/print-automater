import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryItemShopResolver } from "../inventory/inventory-item-shop.resolver.js";
import { SupplierProductShopResolver, SupplierShopResolver } from "./supplier-shop.resolvers.js";
import { SuppliersController } from "./suppliers.controller.js";
import { SuppliersService } from "./suppliers.service.js";

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierShopResolver,
    SupplierProductShopResolver,
    InventoryItemShopResolver,
  ],
  exports: [SuppliersService],
})
export class SuppliersModule {}
