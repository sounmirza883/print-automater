import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryItemShopResolver } from "./inventory-item-shop.resolver.js";
import { InventoryService } from "./inventory.service.js";

@Module({
  imports: [AuthModule, IdempotencyModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryItemShopResolver],
  exports: [InventoryService],
})
export class InventoryModule {}
