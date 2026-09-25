import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module.js";
import { AuthModule } from "../auth/auth.module.js";
import {
  PurchaseOrderShopResolver,
  PurchaseOrdersController,
} from "./purchase-orders.controller.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";

@Module({
  imports: [AuthModule, AgentsModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PurchaseOrderShopResolver],
})
export class PurchaseOrdersModule {}
