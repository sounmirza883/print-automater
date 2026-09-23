import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PricingRulesController } from "./pricing-rules.controller.js";
import { PricingRulesService } from "./pricing-rules.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PricingRulesController],
  providers: [PricingRulesService],
})
export class PricingRulesModule {}
