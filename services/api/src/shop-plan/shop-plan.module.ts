import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlanDefinitionService } from "./plan-definition.service.js";
import { PlanDefinitionsController } from "./plan-definitions.controller.js";
import { PlanFeatureService } from "./plan-feature.service.js";
import { PlanFeaturesController } from "./plan-features.controller.js";
import { PublicPlansController } from "./public-plans.controller.js";
import { ShopPlanController } from "./shop-plan.controller.js";
import { ShopPlanService } from "./shop-plan.service.js";

@Module({
  imports: [AuthModule],
  controllers: [
    ShopPlanController,
    PlanDefinitionsController,
    PlanFeaturesController,
    PublicPlansController,
  ],
  providers: [ShopPlanService, PlanDefinitionService, PlanFeatureService],
  exports: [ShopPlanService],
})
export class ShopPlanModule {}
