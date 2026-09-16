import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AgentPairingCodeService } from "./agent-pairing-code.service.js";
import { ShopAgentsController } from "./shop-agents.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [ShopAgentsController],
  providers: [AgentPairingCodeService],
  // 9.3's separate `agents` module (agent-facing registration, no
  // staff JWT) redeems codes issued here.
  exports: [AgentPairingCodeService],
})
export class ShopAgentsModule {}
