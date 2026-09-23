import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { IssuePairingCodeDto } from "./dto/issue-pairing-code.dto.js";
import {
  AgentPairingCodeService,
  type PairingCodeIssueResult,
} from "./agent-pairing-code.service.js";

/** §47/16.3: issuing a pairing code attaches a new printer agent to the
 * shop's fleet -- the same MANAGE_PRINTERS gate as printers.controller.ts,
 * for the same reason. Counter staff can no longer issue pairing codes. */
@Controller("shop/agents")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.SHOP_COUNTER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER, UserRole.PRINTER_MANAGER)
@RequirePermission(Permission.MANAGE_PRINTERS)
export class ShopAgentsController {
  constructor(private readonly pairingCodeService: AgentPairingCodeService) {}

  @Post("pairing-code")
  @ShopScopedField("body", "shopId")
  issuePairingCode(
    @Req() req: RequestWithUser,
    @Body() dto: IssuePairingCodeDto,
  ): Promise<PairingCodeIssueResult> {
    return this.pairingCodeService.issue(dto.shopId, req.user!.id);
  }
}
