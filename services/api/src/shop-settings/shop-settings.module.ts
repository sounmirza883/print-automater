import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ShopSettingsController } from "./shop-settings.controller.js";
import { ShopSettingsService } from "./shop-settings.service.js";

@Module({
  imports: [AuthModule, AgentsModule],
  controllers: [ShopSettingsController],
  providers: [ShopSettingsService],
  exports: [ShopSettingsService],
})
export class ShopSettingsModule {}
