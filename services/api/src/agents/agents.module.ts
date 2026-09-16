import { Module } from "@nestjs/common";
import { ShopAgentsModule } from "../shop-agents/shop-agents.module.js";
import { AgentAuthGuard } from "./agent-auth.guard.js";
import { AgentChallengeService } from "./agent-challenge.service.js";
import { AgentHeartbeatService } from "./agent-heartbeat.service.js";
import { AgentJobsService } from "./agent-jobs.service.js";
import { AgentTokenService } from "./agent-token.service.js";
import { AgentsController } from "./agents.controller.js";
import { AgentsService } from "./agents.service.js";

@Module({
  imports: [ShopAgentsModule],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    AgentChallengeService,
    AgentTokenService,
    AgentHeartbeatService,
    AgentJobsService,
    AgentAuthGuard,
  ],
  exports: [AgentTokenService, AgentJobsService],
})
export class AgentsModule {}
