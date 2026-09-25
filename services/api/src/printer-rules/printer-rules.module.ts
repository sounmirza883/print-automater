import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrinterRuleShopResolver } from "./printer-rule-shop.resolver.js";
import { PrinterRulesController } from "./printer-rules.controller.js";
import { PrinterRulesService } from "./printer-rules.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PrinterRulesController],
  providers: [PrinterRulesService, PrinterRuleShopResolver],
})
export class PrinterRulesModule {}
