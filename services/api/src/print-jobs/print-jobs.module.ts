import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ShopOrdersModule } from "../shop-orders/shop-orders.module.js";
import { PrintJobShopResolver } from "./print-job-shop.resolver.js";
import { PrintJobsController } from "./print-jobs.controller.js";
import { PrintJobsService } from "./print-jobs.service.js";

@Module({
  imports: [AuthModule, AgentsModule, IdempotencyModule, ShopOrdersModule],
  controllers: [PrintJobsController],
  providers: [PrintJobsService, PrintJobShopResolver],
})
export class PrintJobsModule {}
