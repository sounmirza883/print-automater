import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlanDefinitionService } from "./plan-definition.service.js";
import { PlanDefinitionsController } from "./plan-definitions.controller.js";
import { PublicPlansController } from "./public-plans.controller.js";
import { ShopPlanController } from "./shop-plan.controller.js";
import { ShopPlanService } from "./shop-plan.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ShopPlanController, PlanDefinitionsController, PublicPlansController],
  providers: [ShopPlanService, PlanDefinitionService],
  exports: [ShopPlanService],
})
export class ShopPlanModule {}
