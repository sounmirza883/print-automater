import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { IssuePairingCodeDto } from "./dto/issue-pairing-code.dto.js";
import {
  AgentPairingCodeService,
  type PairingCodeIssueResult,
} from "./agent-pairing-code.service.js";

@Controller("shop/agents")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_COUNTER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)
export class ShopAgentsController {
  constructor(private readonly pairingCodeService: AgentPairingCodeService) {}

  @Post("pairing-code")
  issuePairingCode(
    @Req() req: RequestWithUser,
    @Body() dto: IssuePairingCodeDto,
  ): Promise<PairingCodeIssueResult> {
    return this.pairingCodeService.issue(dto.shopId, req.user!.id);
  }
}
